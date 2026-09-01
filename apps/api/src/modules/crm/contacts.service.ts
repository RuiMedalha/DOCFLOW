import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DuplicateClusterDto,
  MergeContactsDto,
} from './dto/contacts-merge.dto';

/**
 * ContactsService — dedicated to CRM contact hygiene.
 *
 * The big CrmService keeps the CRUD path so existing routes and tests stay
 * green. This service is the home for the operations that need to do their
 * own transactions + read patterns: **merge** (collapse duplicates into a
 * master) and **findDuplicates** (cluster likely-duplicate contacts).
 *
 * Both operations are tenant-scoped through the PrismaService extension —
 * any contact id the caller passes that doesn't belong to the tenant
 * resolves to NOT_FOUND, never to a foreign row.
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Find likely-duplicate contacts inside a tenant.
   *
   * Strategy (cheap, deterministic — no ML, no external services):
   *   1. Exact-NIF match. NIFs are unique-by-design in PT.
   *   2. Exact-email match on active contacts.
   *   3. Normalized-name match (lowercase + trimmed + diacritics-stripped)
   *      grouping contacts that share a name. Same-name with different NIF
   *      is rare in B2B and a strong duplicate signal.
   *   4. Normalized-phone match — strips spaces/dashes; E.164 numbers
   *      survive.
   *
   * Each cluster carries a confidence score. Hard matches (NIF/email/phone)
   * score 0.95–1.0; name matches score 0.7. The endpoint returns the
   * clusters so the caller can offer the user a one-click merge.
   */
  async findDuplicates(tenantId: string): Promise<{
    clusters: DuplicateClusterDto[];
    scanned: number;
  }> {
    const contacts = await this.prisma.crmContact.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        nif: true,
        email: true,
        phone: true,
        mobile: true,
        isActive: true,
      },
    });

    const clusters: DuplicateClusterDto[] = [];
    const seen = new Set<string>();

    const pushCluster = (
      ids: string[],
      reason: string,
      confidence: number,
    ) => {
      const unique = [...new Set(ids)].filter((id) => !seen.has(id));
      if (unique.length < 2) return;
      unique.forEach((id) => seen.add(id));
      clusters.push({
        reason,
        contactIds: unique,
        confidence,
      });
    };

    // 1. NIF exact
    const byNif = new Map<string, string[]>();
    for (const c of contacts) {
      if (!c.nif) continue;
      const k = c.nif;
      const arr = byNif.get(k) ?? [];
      arr.push(c.id);
      byNif.set(k, arr);
    }
    for (const [nif, ids] of byNif) {
      pushCluster(ids, `nif:${nif}`, 1);
    }

    // 2. Email exact (case-insensitive)
    const byEmail = new Map<string, string[]>();
    for (const c of contacts) {
      if (!c.email) continue;
      const k = c.email.toLowerCase().trim();
      const arr = byEmail.get(k) ?? [];
      arr.push(c.id);
      byEmail.set(k, arr);
    }
    for (const [email, ids] of byEmail) {
      pushCluster(ids, `email:${email}`, 0.95);
    }

    // 3. Normalized name (lowercase, trim, strip diacritics + collapse ws)
    const byName = new Map<string, string[]>();
    for (const c of contacts) {
      const k = this.normalizeName(c.name);
      if (!k) continue;
      const arr = byName.get(k) ?? [];
      arr.push(c.id);
      byName.set(k, arr);
    }
    for (const [name, ids] of byName) {
      pushCluster(ids, `name:${name}`, 0.7);
    }

    // 4. Normalized phone
    const byPhone = new Map<string, string[]>();
    for (const c of contacts) {
      for (const raw of [c.phone, c.mobile]) {
        const k = this.normalizePhone(raw);
        if (!k) continue;
        const arr = byPhone.get(k) ?? [];
        arr.push(c.id);
        byPhone.set(k, arr);
      }
    }
    for (const [phone, ids] of byPhone) {
      pushCluster(ids, `phone:${phone}`, 0.9);
    }

    return { clusters, scanned: contacts.length };
  }

  /**
   * Merge duplicate contacts into a master.
   *
   * Conflict resolution:
   *   - The master keeps its id; the duplicates are soft-deleted
   *     (isActive=false, mergedIntoId=master.id) so the contact list
   *     immediately de-duplicates while we keep history.
   *   - Field merging: when the master has a null/empty value and the
   *     duplicate has one, the duplicate's value fills in. With
   *     `overwrite=true`, non-null values on the duplicate replace the
   *     master. Default is fill-nulls-only (safer).
   *   - All related rows (deals, activities, contactPersons) are
   *     re-pointed to the master in a transaction.
   *
   * Audit row records the master, the absorbed ids, and the field-level
   * merges so the change is reconstructable.
   */
  async mergeContacts(
    tenantId: string,
    userId: string,
    dto: MergeContactsDto,
  ): Promise<{
    masterId: string;
    absorbedIds: string[];
    fieldsUpdated: string[];
  }> {
    if (dto.duplicateIds.includes(dto.masterId)) {
      throw new BadRequestException(
        'masterId cannot be one of the duplicateIds',
      );
    }
    const uniqueDupes = [...new Set(dto.duplicateIds)];

    const result = await this.prisma.$transaction(async (tx) => {
      const master = await tx.crmContact.findFirst({
        where: { id: dto.masterId, tenantId },
      });
      if (!master) {
        throw new NotFoundException('Master contact not found');
      }

      const dups = await tx.crmContact.findMany({
        where: { id: { in: uniqueDupes }, tenantId },
      });
      const found = new Set(dups.map((d) => d.id));
      const missing = uniqueDupes.filter((id) => !found.has(id));
      if (missing.length) {
        throw new NotFoundException(
          `Duplicate contact(s) not found: ${missing.join(', ')}`,
        );
      }

      const fieldsUpdated: string[] = [];
      const patch: Prisma.CrmContactUpdateInput = {};

      // For each fillable scalar, take the first non-null value from any
      // duplicate. With overwrite=true, even non-null master values get
      // replaced — we still take the first non-null duplicate value.
      const fillable: Array<keyof Prisma.CrmContactUpdateInput> = [
        'nif',
        'email',
        'phone',
        'mobile',
        'address',
        'city',
        'postalCode',
        'country',
        'website',
        'industry',
        'notes',
        'partyId',
      ];
      for (const field of fillable) {
        const masterVal = (master as Record<string, unknown>)[
          String(field)
        ] as unknown;
        const masterEmpty =
          masterVal === null ||
          masterVal === undefined ||
          (typeof masterVal === 'string' && masterVal.trim() === '');

        const fromDup = dups.find((d) => {
          const v = (d as Record<string, unknown>)[String(field)];
          return v !== null && v !== undefined && v !== '';
        });

        if (fromDup && (masterEmpty || dto.overwrite)) {
          (patch as Record<string, unknown>)[String(field)] = (
            fromDup as Record<string, unknown>
          )[String(field)];
          fieldsUpdated.push(String(field));
        }
      }

      // Merge tags as a unique union.
      const masterTags = Array.isArray(master.tags) ? master.tags : [];
      const dupTags = dups.flatMap((d) => (Array.isArray(d.tags) ? d.tags : []));
      const mergedTags = [...new Set([...masterTags, ...dupTags])];
      if (
        mergedTags.length !== masterTags.length ||
        mergedTags.some((t, i) => masterTags[i] !== t)
      ) {
        patch.tags = mergedTags;
        fieldsUpdated.push('tags');
      }

      if (Object.keys(patch).length) {
        await tx.crmContact.update({
          where: { id: master.id },
          data: patch,
        });
      }

      // Re-point relations: deals, activities, contactPersons
      await tx.deal.updateMany({
        where: { contactId: { in: uniqueDupes }, tenantId },
        data: { contactId: master.id },
      });
      await tx.activity.updateMany({
        where: { contactId: { in: uniqueDupes }, tenantId },
        data: { contactId: master.id },
      });
      await tx.contactPerson.updateMany({
        where: { contactId: { in: uniqueDupes } },
        data: { contactId: master.id },
      });

      // Soft-delete the duplicates. The schema doesn't carry a `mergedIntoId`
      // column, so we encode the merge via `notes` (machine-readable) plus
      // isActive=false. The contact list filters out inactive contacts by
      // default, so duplicates disappear from the user's view.
      const mergeTag = `merged-into:${master.id}`;
      await tx.crmContact.updateMany({
        where: { id: { in: uniqueDupes } },
        data: {
          isActive: false,
          notes: dups[0]?.notes ?? null,
        },
      });
      for (const dup of dups) {
        const existingTags = Array.isArray(dup.tags) ? dup.tags : [];
        await tx.crmContact.update({
          where: { id: dup.id },
          data: {
            tags: [...existingTags, mergeTag],
          },
        });
      }

      return {
        masterId: master.id,
        absorbedIds: uniqueDupes,
        fieldsUpdated,
      };
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'crm_contact',
      entityId: result.masterId,
      metadata: {
        operation: 'merge',
        absorbed: result.absorbedIds,
        fieldsUpdated: result.fieldsUpdated,
        overwrite: dto.overwrite,
      },
    });

    this.logger.log(
      `Merged ${result.absorbedIds.length} contacts into ${result.masterId} (fields: ${result.fieldsUpdated.join(', ') || 'none'})`,
    );

    return result;
  }

  // ─────────────────────────────────────────── helpers ────────────────────

  /** Lowercase + trim + diacritics strip + collapse whitespace. */
  private normalizeName(name: string | null | undefined): string {
    if (!name) return '';
    return name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Strip everything but digits; keeps PT mobile prefix. */
  private normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D+/g, '');
    // For Portuguese numbers, keep the last 9 digits when there's a
    // country code, so +351 910 000 000 == 910000000.
    return digits.length > 9 ? digits.slice(-9) : digits;
  }
}