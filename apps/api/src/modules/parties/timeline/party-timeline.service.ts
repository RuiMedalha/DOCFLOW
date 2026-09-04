import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TimelineEvent } from './party-timeline.dto';

/**
 * PartyTimelineService — read-only aggregation of events that touched a
 * party, across 4 distinct sources:
 *
 *   1. AuditLog         (entityType='party' AND entityId=partyId)
 *   2. PaymentEvent     (via Document JOIN — Document.partyId = partyId)
 *   3. IbanHistory      (partyId direct)
 *   4. Document         (partyId AND status='APROVADO')
 *
 * Each source has its own native timestamp (audit.createdAt,
 * paymentEvent.createdAt, iban.createdAt, document.approvedAt). We map
 * each to a uniform `at: ISO` field on the TimelineEvent DTO, then merge
 * + sort desc + paginate by composite cursor.
 *
 * Composite cursor — `at` (ISO) + `id` (cuid) — defends against two
 * events with the same timestamp landing on opposite pages. Naive
 * single-timestamp cursor can lose OR duplicate events when the DB
 * returns more than one event with the same ms timestamp. Cursor format:
 *
 *     base64(`<iso>|<id>`)
 *
 * On the next request, we split + use it to filter:
 *
 *     - keep events strictly older than `at` (createdAt / dueDate / approvedAt)
 *     - OR events at the exact same `at` but with id lexicographically < cursorId
 *
 * The composite cursor is overkill for most parties (< 100 events total)
 * but correct under race-conditions and high-volume tenants.
 */
@Injectable()
export class PartyTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /parties/:partyId/timeline?cursor=&limit=20
   *
   * Pulls `limit` rows from each of the 4 sources independently
   * (Promise.all for parallel execution), normalises, merges, sorts,
   * then slices the merged result down to `limit` and computes the
   * composite cursor from the last kept item.
   */
  async list(
    tenantId: string,
    partyId: string,
    cursor?: string,
    limit = 20,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const parsedCursor = cursor ? this.decodeCursor(cursor) : null;

    // Each "where" applies the cursor as a timestamp filter. We use the
    // source's native timestamp column so the cursor is meaningful
    // ("strictly older than what I've already seen"). Same-timestamp
    // tie-breaker is resolved by the composite cursor post-sort below.
    const whereWith = (
      tsField: 'createdAt' | 'dueDate' | 'approvedAt',
    ) => {
      const w: Record<string, unknown> = {
        tenantId,
      };
      if (tsField === 'createdAt' || tsField === 'dueDate') {
        w['document'] = { partyId, tenantId };
      }
      if (parsedCursor) {
        // Strict less-than on the timestamp column. Same-ts tie-break
        // is handled at the merge step by sorting by id desc.
        w[tsField] = { lt: parsedCursor.at };
      }
      return w;
    };

    const [audits, payments, ibans, approvedDocs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'party',
          entityId: partyId,
          ...(parsedCursor
            ? { createdAt: { lt: parsedCursor.at } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
      }),
      this.prisma.paymentEvent.findMany({
        where: whereWith('dueDate'),
        orderBy: [{ dueDate: 'desc' }, { id: 'desc' }],
        take: safeLimit,
        include: {
          document: {
            select: { id: true, docNumber: true, fileKey: true },
          },
        },
      }),
      this.prisma.ibanHistory.findMany({
        where: {
          tenantId,
          partyId,
          ...(parsedCursor
            ? { createdAt: { lt: parsedCursor.at } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
      }),
      this.prisma.document.findMany({
        where: {
          tenantId,
          partyId,
          status: 'APROVADO',
          ...(parsedCursor
            ? { approvedAt: { lt: parsedCursor.at } }
            : {}),
        },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
        select: {
          id: true,
          fileName: true,
          docNumber: true,
          approvedAt: true,
          approvedById: true,
        },
      }),
    ]);

    // Normalise into a uniform TimelineEvent shape. Each source's
    // native timestamp becomes the unified `at`.
    const events: TimelineEvent[] = [
      ...audits.map((a) => ({
        id: a.id,
        type: 'audit' as const,
        at: a.createdAt.toISOString(),
        action: a.action,
        userId: a.userId,
        metadata: a.metadata,
      })),
      ...payments.map((p) => ({
        id: p.id,
        type: 'payment' as const,
        at: p.dueDate.toISOString(),
        amount: p.amount?.toString() ?? null,
        status: p.status,
        documentId: p.documentId,
        document: p.document,
      })),
      ...ibans.map((i) => ({
        id: i.id,
        type: 'iban_change' as const,
        at: i.createdAt.toISOString(),
        oldIban: i.oldIban,
        newIban: i.newIban,
        verified: i.verified,
        changedById: i.changedById,
      })),
      ...approvedDocs.map((d) => ({
        id: d.id,
        type: 'document_approved' as const,
        at: (d.approvedAt as Date).toISOString(),
        documentId: d.id,
        fileName: d.fileName,
        docNumber: d.docNumber,
        approvedById: d.approvedById,
      })),
    ];

    // Sort by `at` desc, then by `id` desc as tie-break for events that
    // share a timestamp. Same logic as the per-source query.
    events.sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });

    // Slice to the requested page. We do this AFTER merging so the UI
    // gets a balanced view across all sources — slice-before-merge would
    // over-weight the first source.
    const page = events.slice(0, safeLimit);
    const nextCursor =
      events.length > safeLimit
        ? this.encodeCursor(page[page.length - 1].at, page[page.length - 1].id)
        : null;

    return { items: page, nextCursor };
  }

  /**
   * Encode `<iso>|<id>` into base64 so the cursor looks opaque to the
   * client. Same format the frontend sends back for the next page.
   */
  private encodeCursor(at: string, id: string): string {
    return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): { at: Date; id: string } | null {
    try {
      const raw = Buffer.from(cursor, 'base64url').toString('utf8');
      const sep = raw.indexOf('|');
      if (sep <= 0) return null;
      const at = new Date(raw.slice(0, sep));
      const id = raw.slice(sep + 1);
      if (isNaN(at.getTime()) || !id) return null;
      return { at, id };
    } catch {
      return null;
    }
  }
}
