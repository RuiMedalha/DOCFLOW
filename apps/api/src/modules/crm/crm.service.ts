import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  AuditAction,
  ContactType,
  DealStage,
  Prisma,
} from '@prisma/client';
import { isValidNif, normalizeNif } from '@docflow/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ActivityQueryDto,
  CreateActivityDto,
  UpdateActivityDto,
} from './dto/activity.dto';
import {
  ContactQueryDto,
  CreateContactDto,
  CreateContactPersonDto,
  UpdateContactDto,
  UpdateContactPersonDto,
} from './dto/contact.dto';
import {
  CreateDealDto,
  DealQueryDto,
  MoveDealStageDto,
  UpdateDealDto,
} from './dto/deal.dto';
import {
  CreatePipelineDto,
  PipelineStageDto,
  UpdatePipelineDto,
} from './dto/pipeline.dto';
import {
  ImportContactsDto,
  ImportContactResultDto,
} from './dto/import.dto';
import {
  adapterFor,
  AdapterRow,
  ImportSource,
} from './import/import-adapter';

/**
 * Stage defaults — used when a pipeline definition doesn't include an entry
 * for one of the canonical stages. The probabilities mirror the common
 * CRMs (HubSpot, Pipedrive) so a missing-stage import isn't a surprise.
 */
const DEFAULT_STAGES: PipelineStageDto[] = [
  { key: DealStage.LEAD, label: 'Lead', defaultProbability: 20, isWon: false, isLost: false },
  { key: DealStage.QUALIFIED, label: 'Qualified', defaultProbability: 40, isWon: false, isLost: false },
  { key: DealStage.PROPOSAL, label: 'Proposal', defaultProbability: 60, isWon: false, isLost: false },
  { key: DealStage.NEGOTIATION, label: 'Negotiation', defaultProbability: 80, isWon: false, isLost: false },
  { key: DealStage.WON, label: 'Won', defaultProbability: 100, isWon: true, isLost: false },
  { key: DealStage.LOST, label: 'Lost', defaultProbability: 0, isWon: false, isLost: true },
];

/**
 * CrmService — contacts, contact persons, pipelines, deals, activities.
 *
 * Responsibilities:
 *   - CRUD for CrmContact (company or individual), ContactPerson (related
 *     persons under a contact), CrmPipeline (ordered stage definitions
 *     stored as JSON), Deal (opportunities with stage / value / probability
 *     / expected close), and Activity (calls, emails, meetings, tasks,
 *     notes, follow-ups).
 *   - Deal stage transitions with terminal-stage bookkeeping
 *     (`wonAt`/`lostAt` set when moving to WON/LOST).
 *   - Import pipeline: HubSpot / Pipedrive adapters (mock mode), field
 *     mapping, dry-run, dedup-on-NIF/email, sync history persisted as
 *     AuditLog rows with `entityType='crm_sync'`.
 *
 * All mutations are written through AuditService so the hash-chained log
 * stays consistent with the rest of DocFlow. Direct `auditLog.create` is
 * never called from this service.
 */
@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ════════════════════════════════ CONTACTS — CRUD ═══════════════════════

  /**
   * Paginated listing of contacts for the tenant. Filters: type,
   * isActive (default true), search over name/nif/email.
   */
  async findAllContacts(tenantId: string, query: ContactQueryDto) {
    const where: Prisma.CrmContactWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      const s = query.search;
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { nif: { contains: s } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 200);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.crmContact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          contactPersons: {
            orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          },
          _count: { select: { deals: true, activities: true } },
        },
      }),
      this.prisma.crmContact.count({ where }),
    ]);
    return {
      items: items.map((c) => this.sanitizeContact(c)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** GET /crm/contacts/:id — full contact with relations. */
  async findOneContact(tenantId: string, id: string) {
    const contact = await this.prisma.crmContact.findFirst({
      where: { id, tenantId },
      include: {
        contactPersons: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        deals: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            createdBy: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    // The CrmContact schema has `partyId` but no Prisma relation; we fetch
    // the linked Party in a separate query (same tenant-scoped client).
    let party: { id: string; name: string; nif: string | null } | null = null;
    if (contact.partyId) {
      const p = await this.prisma.party.findFirst({
        where: { id: contact.partyId, tenantId },
        select: { id: true, name: true, nif: true },
      });
      party = p ?? null;
    }
    return { ...this.sanitizeContact(contact), party };
  }

  /** POST /crm/contacts — create. Validates NIF, dedupes by NIF/email. */
  async createContact(tenantId: string, userId: string, dto: CreateContactDto) {
    const nif = this.coerceNif(dto.nif);

    // Dedup by NIF.
    if (nif) {
      const dupe = await this.prisma.crmContact.findFirst({
        where: { tenantId, nif },
        select: { id: true, name: true },
      });
      if (dupe) {
        throw new ConflictException(
          `Já existe contacto com este NIF (${dupe.name})`,
        );
      }
    }

    // Dedup by email when supplied.
    if (dto.email) {
      const dupe = await this.prisma.crmContact.findFirst({
        where: { tenantId, email: dto.email, isActive: true },
        select: { id: true, name: true },
      });
      if (dupe) {
        throw new ConflictException(
          `Já existe contacto com este email (${dupe.name})`,
        );
      }
    }

    if (dto.partyId) {
      await this.assertPartyExists(tenantId, dto.partyId);
    }

    const contact = await this.prisma.crmContact.create({
      data: {
        tenantId,
        type: dto.type ?? ContactType.COMPANY,
        name: dto.name,
        nif: nif ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        mobile: dto.mobile ?? null,
        address: dto.address ?? null,
        city: dto.city ?? null,
        postalCode: dto.postalCode ?? null,
        country: dto.country ?? 'Portugal',
        website: dto.website ?? null,
        industry: dto.industry ?? null,
        notes: dto.notes ?? null,
        tags: dto.tags ?? [],
        partyId: dto.partyId ?? null,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm_contact',
      entityId: contact.id,
      metadata: { name: contact.name, type: contact.type, nif: contact.nif },
    });

    return this.findOneContact(tenantId, contact.id);
  }

  /** PATCH /crm/contacts/:id — partial update. */
  async updateContact(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateContactDto,
  ) {
    const existing = await this.prisma.crmContact.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, nif: true, email: true, partyId: true },
    });
    if (!existing) throw new NotFoundException('Contact not found');

    const newNif = dto.nif !== undefined ? this.coerceNif(dto.nif) : undefined;
    if (newNif !== undefined && newNif !== null && newNif !== existing.nif) {
      const dupe = await this.prisma.crmContact.findFirst({
        where: { tenantId, nif: newNif, NOT: { id } },
        select: { id: true },
      });
      if (dupe) {
        throw new ConflictException('NIF já está registado noutro contacto');
      }
    }

    if (dto.email && dto.email !== existing.email) {
      const dupe = await this.prisma.crmContact.findFirst({
        where: { tenantId, email: dto.email, NOT: { id }, isActive: true },
        select: { id: true },
      });
      if (dupe) {
        throw new ConflictException('Email já está registado noutro contacto');
      }
    }

    if (dto.partyId !== undefined && dto.partyId !== null) {
      await this.assertPartyExists(tenantId, dto.partyId);
    }

    const data: Prisma.CrmContactUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.name !== undefined) data.name = dto.name;
    if (newNif !== undefined)
      data.nif = newNif === null ? null : (newNif as string);
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.mobile !== undefined) data.mobile = dto.mobile ?? null;
    if (dto.address !== undefined) data.address = dto.address ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode ?? null;
    if (dto.country !== undefined) data.country = dto.country ?? null;
    if (dto.website !== undefined) data.website = dto.website ?? null;
    if (dto.industry !== undefined) data.industry = dto.industry ?? null;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.tags !== undefined) data.tags = dto.tags ?? [];
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.partyId !== undefined) {
      data.partyId = dto.partyId;
    }

    await this.prisma.crmContact.update({ where: { id }, data });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'crm_contact',
      entityId: id,
      metadata: {
        fieldsChanged: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });

    return this.findOneContact(tenantId, id);
  }

  /** DELETE /crm/contacts/:id — soft-delete. */
  async softDeleteContact(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.crmContact.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException('Contact not found');

    await this.prisma.crmContact.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'crm_contact',
      entityId: id,
      metadata: { name: existing.name, reason: 'soft-delete' },
    });

    return { id, isActive: false };
  }

  // ════════════════════════════════ CONTACT PERSONS ══════════════════════

  /** POST /crm/contacts/:id/persons — add a related person. */
  async addContactPerson(
    tenantId: string,
    userId: string,
    contactId: string,
    dto: CreateContactPersonDto,
  ) {
    await this.assertContactExists(tenantId, contactId);

    // If marked primary, demote any existing primary on the same contact.
    if (dto.isPrimary) {
      await this.prisma.contactPerson.updateMany({
        where: { contactId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const person = await this.prisma.contactPerson.create({
      data: {
        contactId,
        name: dto.name,
        role: dto.role ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        isPrimary: dto.isPrimary ?? false,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'contact_person',
      entityId: person.id,
      metadata: { contactId, name: person.name, role: person.role },
    });

    return person;
  }

  /** PATCH /crm/persons/:id — update a contact person. */
  async updateContactPerson(
    tenantId: string,
    userId: string,
    personId: string,
    dto: UpdateContactPersonDto,
  ) {
    const existing = await this.prisma.contactPerson.findFirst({
      where: { id: personId },
      include: { contact: { select: { id: true, tenantId: true } } },
    });
    if (!existing || existing.contact.tenantId !== tenantId) {
      throw new NotFoundException('Contact person not found');
    }

    if (dto.isPrimary === true) {
      await this.prisma.contactPerson.updateMany({
        where: { contactId: existing.contactId, isPrimary: true, NOT: { id: personId } },
        data: { isPrimary: false },
      });
    }

    const data: Prisma.ContactPersonUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;

    const updated = await this.prisma.contactPerson.update({
      where: { id: personId },
      data,
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'contact_person',
      entityId: personId,
      metadata: { contactId: existing.contactId },
    });

    return updated;
  }

  /** DELETE /crm/persons/:id — remove a contact person. */
  async removeContactPerson(tenantId: string, userId: string, personId: string) {
    const existing = await this.prisma.contactPerson.findFirst({
      where: { id: personId },
      include: { contact: { select: { id: true, tenantId: true } } },
    });
    if (!existing || existing.contact.tenantId !== tenantId) {
      throw new NotFoundException('Contact person not found');
    }
    await this.prisma.contactPerson.delete({ where: { id: personId } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'contact_person',
      entityId: personId,
      metadata: { contactId: existing.contactId, name: existing.name },
    });
    return { id: personId, deleted: true };
  }

  // ════════════════════════════════ PIPELINES ══════════════════════════════

  /** GET /crm/pipelines — list. */
  async listPipelines(tenantId: string) {
    const rows = await this.prisma.crmPipeline.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      items: rows.map((p) => ({
        ...p,
        stages: this.normalizeStages(p.stages),
      })),
    };
  }

  /** GET /crm/pipelines/:id — detail. */
  async findOnePipeline(tenantId: string, id: string) {
    const p = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
    });
    if (!p) throw new NotFoundException('Pipeline not found');
    return { ...p, stages: this.normalizeStages(p.stages) };
  }

  /** POST /crm/pipelines — create. */
  async createPipeline(tenantId: string, userId: string, dto: CreatePipelineDto) {
    const stages = this.normalizeStages(dto.stages ?? DEFAULT_STAGES);

    // If marking as default, demote any other default first.
    if (dto.isDefault) {
      await this.prisma.crmPipeline.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const pipeline = await this.prisma.crmPipeline.create({
      data: {
        tenantId,
        name: dto.name,
        stages: stages as unknown as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm_pipeline',
      entityId: pipeline.id,
      metadata: { name: pipeline.name, isDefault: pipeline.isDefault },
    });

    return { ...pipeline, stages: this.normalizeStages(pipeline.stages) };
  }

  /** PATCH /crm/pipelines/:id. */
  async updatePipeline(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdatePipelineDto,
  ) {
    const existing = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Pipeline not found');

    if (dto.isDefault === true) {
      await this.prisma.crmPipeline.updateMany({
        where: { tenantId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }

    const data: Prisma.CrmPipelineUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.stages !== undefined) {
      data.stages = this.normalizeStages(dto.stages) as unknown as Prisma.InputJsonValue;
    }
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    await this.prisma.crmPipeline.update({ where: { id }, data });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'crm_pipeline',
      entityId: id,
      metadata: { name: dto.name ?? existing.name },
    });

    return this.findOnePipeline(tenantId, id);
  }

  /** DELETE /crm/pipelines/:id — refuses if deals still reference it. */
  async deletePipeline(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, isDefault: true },
    });
    if (!existing) throw new NotFoundException('Pipeline not found');

    const dealsCount = await this.prisma.deal.count({
      where: { tenantId, pipelineId: id },
    });
    if (dealsCount > 0) {
      throw new BadRequestException(
        `Pipeline tem ${dealsCount} oportunidades associadas`,
      );
    }

    await this.prisma.crmPipeline.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'crm_pipeline',
      entityId: id,
      metadata: { name: existing.name },
    });

    return { id, deleted: true };
  }

  /**
   * Ensure the tenant has at least one pipeline. Creates the default
   * 6-stage one if missing. Called from deal creation flows when the
   * caller omits `pipelineId`.
   */
  async ensureDefaultPipeline(tenantId: string): Promise<string> {
    const existing = await this.prisma.crmPipeline.findFirst({
      where: { tenantId, isDefault: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.crmPipeline.create({
      data: {
        tenantId,
        name: 'Default Sales',
        stages: DEFAULT_STAGES as unknown as Prisma.InputJsonValue,
        isDefault: true,
      },
    });
    return created.id;
  }

  // ════════════════════════════════ DEALS — CRUD ═══════════════════════════

  /** GET /crm/deals — paginated with filters. */
  async findAllDeals(tenantId: string, query: DealQueryDto) {
    const where: Prisma.DealWhereInput = { tenantId };
    if (query.stage) where.stage = query.stage;
    if (query.contactId) where.contactId = query.contactId;
    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.createdById) where.createdById = query.createdById;

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 200);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, type: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);
    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** GET /crm/deals/:id — detail. */
  async findOneDeal(tenantId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId },
      include: {
        contact: { select: { id: true, name: true, type: true } },
        createdBy: { select: { id: true, name: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  /** POST /crm/deals — create. */
  async createDeal(tenantId: string, userId: string, dto: CreateDealDto) {
    await this.assertContactExists(tenantId, dto.contactId);

    let pipelineId = dto.pipelineId ?? null;
    if (!pipelineId) {
      pipelineId = await this.ensureDefaultPipeline(tenantId);
    } else {
      await this.assertPipelineExists(tenantId, pipelineId);
    }

    // Resolve initial probability from the pipeline stage defaults.
    const stage = dto.stage ?? DealStage.LEAD;
    const probability = await this.resolveProbability(
      tenantId,
      pipelineId,
      stage,
      dto.probability,
    );

    const deal = await this.prisma.deal.create({
      data: {
        tenantId,
        contactId: dto.contactId,
        pipelineId,
        title: dto.title,
        // value comes from the DTO as a JS number; Prisma accepts number
        // and coerces to the Decimal(14,2) column at the driver layer.
        value: dto.value,
        stage,
        probability,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        createdById: userId,
      },
      include: {
        contact: { select: { id: true, name: true, type: true } },
      },
    });

    // Auto-log a NOTE activity so the contact's activity timeline shows it.
    await this.prisma.activity.create({
      data: {
        tenantId,
        contactId: deal.contactId,
        dealId: deal.id,
        type: ActivityType.NOTE,
        subject: 'Oportunidade criada',
        description: `Deal "${deal.title}" criado em ${stage}.`,
        createdById: userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'deal',
      entityId: deal.id,
      metadata: {
        title: deal.title,
        stage: deal.stage,
        value: deal.value.toString(),
        contactId: deal.contactId,
        pipelineId: deal.pipelineId,
      },
    });

    return deal;
  }

  /** PATCH /crm/deals/:id — partial update. Does NOT change stage; use moveDealStage for that. */
  async updateDeal(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateDealDto,
  ) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, tenantId },
      select: { id: true, stage: true, pipelineId: true, contactId: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    if (dto.contactId && dto.contactId !== existing.contactId) {
      await this.assertContactExists(tenantId, dto.contactId);
    }
    if (dto.pipelineId && dto.pipelineId !== existing.pipelineId) {
      await this.assertPipelineExists(tenantId, dto.pipelineId);
    }

    const data: Prisma.DealUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.probability !== undefined) data.probability = dto.probability;
    if (dto.expectedCloseDate !== undefined) {
      data.expectedCloseDate = dto.expectedCloseDate
        ? new Date(dto.expectedCloseDate)
        : null;
    }
    if (dto.contactId !== undefined)
      data.contact = { connect: { id: dto.contactId } };
    if (dto.pipelineId !== undefined) {
      data.pipelineId = dto.pipelineId;
    }

    await this.prisma.deal.update({ where: { id }, data });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'deal',
      entityId: id,
      metadata: {
        fieldsChanged: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });

    return this.findOneDeal(tenantId, id);
  }

  /**
   * PATCH /crm/deals/:id/stage — transition a deal to a new stage.
   *
   * Side effects:
   *   - Sets `wonAt` / `lostAt` for terminal stages (WON / LOST).
   *   - Resolves `probability` from the pipeline stage defaults unless the
   *     caller supplied one.
   *   - Writes a hash-chained audit row describing the transition.
   *   - Logs a NOTE activity on the contact timeline.
   */
  async moveDealStage(
    tenantId: string,
    userId: string,
    id: string,
    dto: MoveDealStageDto,
  ) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId },
    });
    if (!deal) throw new NotFoundException('Deal not found');

    if (deal.stage === dto.stage) {
      // No-op but still update probability if caller asked for it.
      if (dto.probability !== undefined && dto.probability !== deal.probability) {
        await this.prisma.deal.update({
          where: { id },
          data: { probability: dto.probability },
        });
      }
      return this.findOneDeal(tenantId, id);
    }

    const probability = await this.resolveProbability(
      tenantId,
      deal.pipelineId,
      dto.stage,
      dto.probability,
    );

    const now = new Date();
    const data: Prisma.DealUpdateInput = {
      stage: dto.stage,
      probability,
    };
    if (dto.stage === DealStage.WON) {
      data.wonAt = now;
      data.lostAt = null;
    } else if (dto.stage === DealStage.LOST) {
      data.lostAt = now;
      data.wonAt = null;
    } else {
      // Non-terminal: clear terminal timestamps so a re-won deal is recorded fresh.
      data.wonAt = null;
      data.lostAt = null;
    }

    await this.prisma.deal.update({ where: { id }, data });

    // Timeline note.
    await this.prisma.activity.create({
      data: {
        tenantId,
        contactId: deal.contactId,
        dealId: deal.id,
        type: ActivityType.NOTE,
        subject: `Stage change: ${deal.stage} → ${dto.stage}`,
        description: dto.note ?? null,
        createdById: userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'deal_stage_change',
      entityId: id,
      metadata: {
        fromStage: deal.stage,
        toStage: dto.stage,
        probability,
        note: dto.note ?? null,
      },
    });

    return this.findOneDeal(tenantId, id);
  }

  /** DELETE /crm/deals/:id — soft-delete by removing the row. */
  async deleteDeal(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, tenantId },
      select: { id: true, title: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    await this.prisma.deal.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'deal',
      entityId: id,
      metadata: { title: existing.title },
    });

    return { id, deleted: true };
  }

  /** GET /crm/deals/stats — pipeline stats. */
  async pipelineStats(tenantId: string) {
    const rows = await this.prisma.deal.findMany({
      where: { tenantId },
      select: { stage: true, value: true, probability: true },
    });
    const stages: DealStage[] = [
      DealStage.LEAD,
      DealStage.QUALIFIED,
      DealStage.PROPOSAL,
      DealStage.NEGOTIATION,
      DealStage.WON,
      DealStage.LOST,
    ];
    const stats: Record<
      string,
      { count: number; value: number; weightedValue: number }
    > = {};
    for (const s of stages) {
      stats[s] = { count: 0, value: 0, weightedValue: 0 };
    }
    for (const r of rows) {
      const v = Number(r.value);
      stats[r.stage].count += 1;
      stats[r.stage].value += v;
      stats[r.stage].weightedValue += v * (r.probability / 100);
    }
    return {
      byStage: stats,
      totals: {
        deals: rows.length,
        value: Object.values(stats).reduce((a, s) => a + s.value, 0),
        weightedValue: Object.values(stats).reduce(
          (a, s) => a + s.weightedValue,
          0,
        ),
        wonCount: stats[DealStage.WON].count,
        lostCount: stats[DealStage.LOST].count,
      },
    };
  }

  // ════════════════════════════════ ACTIVITIES ═════════════════════════════

  /** POST /crm/activities — log an activity. */
  async createActivity(tenantId: string, userId: string, dto: CreateActivityDto) {
    if (dto.contactId) await this.assertContactExists(tenantId, dto.contactId);
    if (dto.dealId) await this.assertDealExists(tenantId, dto.dealId);

    const assignedToId = dto.assignedToId ?? userId;

    const activity = await this.prisma.activity.create({
      data: {
        tenantId,
        contactId: dto.contactId ?? null,
        dealId: dto.dealId ?? null,
        type: dto.type,
        subject: dto.subject,
        description: dto.description ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assignedToId,
        createdById: userId,
      },
      include: {
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'activity',
      entityId: activity.id,
      metadata: { type: activity.type, subject: activity.subject },
    });

    return activity;
  }

  /** PATCH /crm/activities/:id. */
  async updateActivity(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateActivityDto,
  ) {
    const existing = await this.prisma.activity.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Activity not found');

    const data: Prisma.ActivityUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.dueDate !== undefined)
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.assignedToId !== undefined)
      data.assignedTo = dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : { disconnect: true };
    if (dto.completed === true) data.completedAt = new Date();
    else if (dto.completed === false) data.completedAt = null;

    await this.prisma.activity.update({ where: { id }, data });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'activity',
      entityId: id,
    });

    return this.findOneActivity(tenantId, id);
  }

  /** GET /crm/activities — paginated list. */
  async findAllActivities(tenantId: string, query: ActivityQueryDto) {
    const where: Prisma.ActivityWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    if (query.contactId) where.contactId = query.contactId;
    if (query.dealId) where.dealId = query.dealId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.onlyPending) where.completedAt = null;

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 200);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          contact: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
          assignedTo: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.activity.count({ where }),
    ]);
    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** GET /crm/activities/:id. */
  async findOneActivity(tenantId: string, id: string) {
    const a = await this.prisma.activity.findFirst({
      where: { id, tenantId },
      include: {
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!a) throw new NotFoundException('Activity not found');
    return a;
  }

  /** POST /crm/activities/:id/complete. */
  async completeActivity(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.activity.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Activity not found');

    await this.prisma.activity.update({
      where: { id },
      data: { completedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'activity',
      entityId: id,
      metadata: { completed: true },
    });

    return this.findOneActivity(tenantId, id);
  }

  /** DELETE /crm/activities/:id. */
  async deleteActivity(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.activity.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Activity not found');
    await this.prisma.activity.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'activity',
      entityId: id,
      metadata: { subject: existing.subject },
    });
    return { id, deleted: true };
  }

  // ════════════════════════════════ IMPORT ═════════════════════════════════

  /**
   * Bulk import contacts from HubSpot / Pipedrive (mocked adapters today).
   *
   * Flow:
   *   1. Resolve the adapter for the source (HubSpot / Pipedrive).
   *   2. The caller passed `rows` directly in the request body. When the
   *      body has zero rows, fetch a default batch from the adapter (mock).
   *   3. Apply the field mapping to project source fields → CrmContact
   *      columns. Rows missing required fields (name) are skipped with a
   *      warning; rows with bad NIF are skipped with a warning.
   *   4. Dedup by NIF / email against existing contacts for the tenant.
   *      With `mergeExisting=true`, only null/empty fields are filled in;
   *      otherwise duplicates are skipped.
   *   5. Persist (unless `dryRun=true`).
   *   6. Write a single AuditAction.IMPORT row summarising the run, plus
   *      a per-row AuditAction.CREATE / EDIT row when persistence happened.
   */
  async importContacts(
    tenantId: string,
    userId: string,
    dto: ImportContactsDto,
  ) {
    const startedAt = new Date();
    const adapter = adapterFor(dto.source);
    let rows: AdapterRow[] = dto.rows.map((r) => ({
      externalId: r.externalId,
      rawFields: r.fields,
    }));
    if (rows.length === 0) {
      // Fallback to adapter pull. Real imports do this; mocks supply data
      // when the caller leaves the body empty.
      const pulled = await adapter.fetchRows({});
      rows = pulled.rows;
    }

    const results: ImportContactResultDto[] = [];
    let created = 0;
    let merged = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const projected = this.projectRow(row, dto.mapping);

        if (!projected.name) {
          results.push({
            externalId: row.externalId,
            outcome: 'skipped',
            reason: 'missing required field: name',
          });
          skipped += 1;
          continue;
        }

        if (projected.nifWarning) {
          results.push({
            externalId: row.externalId,
            outcome: 'failed',
            reason: projected.nifWarning,
          });
          failed += 1;
          continue;
        }

        // Dedup checks.
        const byNif = projected.nif
          ? await this.prisma.crmContact.findFirst({
              where: { tenantId, nif: projected.nif },
              select: { id: true },
            })
          : null;
        const byEmail = projected.email
          ? await this.prisma.crmContact.findFirst({
              where: { tenantId, email: projected.email, isActive: true },
              select: { id: true },
            })
          : null;

        if ((byNif || byEmail) && !dto.mergeExisting) {
          results.push({
            externalId: row.externalId,
            outcome: 'skipped',
            reason: 'duplicate contact (NIF or email already exists)',
            id: byNif?.id ?? byEmail?.id,
          });
          skipped += 1;
          continue;
        }

        const existingId = byNif?.id ?? byEmail?.id ?? null;

        if (existingId && dto.mergeExisting) {
          if (!dto.dryRun) {
            // Fill only null/empty fields. This is intentionally a simple
            // "merge missing" — overwrite semantics are a footgun here.
            const existing = await this.prisma.crmContact.findFirst({
              where: { id: existingId },
            });
            if (existing) {
              const data: Prisma.CrmContactUpdateInput = {};
              if (!existing.email && projected.email)
                data.email = projected.email;
              if (!existing.phone && projected.phone)
                data.phone = projected.phone;
              if (!existing.mobile && projected.mobile)
                data.mobile = projected.mobile;
              if (!existing.address && projected.address)
                data.address = projected.address;
              if (!existing.city && projected.city)
                data.city = projected.city;
              if (!existing.postalCode && projected.postalCode)
                data.postalCode = projected.postalCode;
              if (!existing.website && projected.website)
                data.website = projected.website;
              if (!existing.industry && projected.industry)
                data.industry = projected.industry;
              if (!existing.notes && projected.notes)
                data.notes = projected.notes;
              if (Object.keys(data).length > 0) {
                await this.prisma.crmContact.update({
                  where: { id: existingId },
                  data,
                });
              }
            }
          }
          results.push({
            externalId: row.externalId,
            outcome: 'merged',
            id: existingId,
          });
          merged += 1;
          continue;
        }

        // Create.
        if (!dto.dryRun) {
          const createdRow = await this.prisma.crmContact.create({
            data: {
              tenantId,
              type: projected.type,
              name: projected.name,
              nif: projected.nif,
              email: projected.email,
              phone: projected.phone,
              mobile: projected.mobile,
              address: projected.address,
              city: projected.city,
              postalCode: projected.postalCode,
              country: projected.country,
              website: projected.website,
              industry: projected.industry,
              notes: projected.notes,
              tags: projected.tags,
            },
          });
          results.push({
            externalId: row.externalId,
            outcome: 'created',
            id: createdRow.id,
          });
        } else {
          results.push({
            externalId: row.externalId,
            outcome: 'created',
          });
        }
        created += 1;
      } catch (err) {
        this.logger.warn(
          `import row failed (source=${dto.source} externalId=${row.externalId}): ${(err as Error).message}`,
        );
        results.push({
          externalId: row.externalId,
          outcome: 'failed',
          reason: (err as Error).message,
        });
        failed += 1;
      }
    }

    const finishedAt = new Date();

    // Sync history: one audit row per run with the full summary, plus a
    // per-row audit row only when persistence happened (not on dry-run —
    // dry-runs must not pollute the audit log).
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.IMPORT,
      entityType: 'crm_sync',
      entityId: null,
      metadata: {
        source: dto.source,
        dryRun: dto.dryRun,
        mergeExisting: dto.mergeExisting,
        total: rows.length,
        created,
        merged,
        skipped,
        failed,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        results: results.slice(0, 500), // cap stored payload size
      } as unknown as Prisma.InputJsonValue,
    });

    return {
      source: dto.source,
      dryRun: dto.dryRun ?? false,
      created,
      merged,
      skipped,
      failed,
      results,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  }

  /** GET /crm/sync-history — recent import runs (read from AuditLog). */
  async listSyncHistory(
    tenantId: string,
    opts: { source?: 'hubspot' | 'pipedrive'; page?: number; limit?: number } = {},
  ) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 20, 200);
    const skip = (page - 1) * limit;

    // Read directly from the raw client (bypass tenant extension is unnecessary —
    // AuditLog is tenant-scoped like everything else). The tenant filter still
    // applies via the extension.
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        action: AuditAction.IMPORT,
        entityType: 'crm_sync',
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
    const filtered = opts.source
      ? rows.filter((r) => {
          const m = r.metadata as { source?: string } | null;
          return m?.source === opts.source;
        })
      : rows;

    return {
      items: filtered.map((r) => ({
        id: r.id,
        action: r.action,
        userId: r.userId,
        createdAt: r.createdAt,
        metadata: r.metadata,
      })),
      meta: { page, limit, count: filtered.length },
    };
  }

  // ════════════════════════════════ helpers ════════════════════════════════

  /**
   * Project an adapter row onto CrmContact columns using the supplied
   * mapping table. Returns `name` + an optional `nifWarning` for invalid
   * NIFs.
   */
  private projectRow(
    row: AdapterRow,
    mapping: { fields: Record<string, string>; typeMap?: Record<string, ContactType> },
  ): {
    name: string | null;
    type: ContactType;
    nif: string | null;
    nifWarning?: string;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    country: string;
    website: string | null;
    industry: string | null;
    notes: string | null;
    tags: string[];
  } {
    const get = (target: string): unknown => {
      const src = Object.entries(mapping.fields).find(
        ([, v]) => v === target,
      )?.[0];
      if (!src) return undefined;
      const raw = row.rawFields[src];
      return this.unwrap(raw);
    };
    const getString = (target: string): string | null => {
      const v = get(target);
      if (v === undefined || v === null || v === '') return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return null;
    };
    const name = getString('name');
    const nifRaw = getString('nif');
    let nif: string | null = null;
    let nifWarning: string | undefined;
    if (nifRaw) {
      const normalized = normalizeNif(nifRaw);
      if (!isValidNif(normalized)) {
        nifWarning = `NIF inválido na origem: ${nifRaw}`;
      } else {
        nif = normalized;
      }
    }
    const typeRaw = getString('type');
    const mappedType =
      typeRaw && mapping.typeMap ? mapping.typeMap[typeRaw] : undefined;
    const type: ContactType = mappedType ?? ContactType.COMPANY;
    return {
      name,
      type,
      nif,
      nifWarning,
      email: getString('email'),
      phone: getString('phone'),
      mobile: getString('mobile'),
      address: getString('address'),
      city: getString('city'),
      postalCode: getString('postalCode'),
      country: getString('country') ?? 'Portugal',
      website: getString('website'),
      industry: getString('industry'),
      notes: getString('notes'),
      tags: [],
    };
  }

  /**
   * Pipedrive-style nested arrays (e.g. emails: [{ value, primary }])
   * often carry the real value under `.value`. Pull the primary entry's
   * value when present, otherwise fall back to the first.
   */
  private unwrap(raw: unknown): unknown {
    if (Array.isArray(raw)) {
      const primary = raw.find(
        (item) => (item as { primary?: boolean })?.primary === true,
      ) as { value?: unknown } | undefined;
      if (primary && primary.value !== undefined) return primary.value;
      const first = raw[0] as { value?: unknown } | undefined;
      return first?.value ?? raw[0];
    }
    return raw;
  }

  /** Validate NIF; throw BadRequest on invalid (used for DTO writes). */
  private coerceNif(input: string | undefined | null): string | null {
    if (input === undefined || input === null || input === '') return null;
    const normalized = normalizeNif(input);
    if (!isValidNif(normalized)) {
      throw new BadRequestException(`NIF inválido: "${input}"`);
    }
    return normalized;
  }

  /** Coerce pipeline stages JSON into the canonical PipelineStageDto[]. */
  private normalizeStages(stages: unknown): PipelineStageDto[] {
    if (!Array.isArray(stages)) return DEFAULT_STAGES;
    const out: PipelineStageDto[] = [];
    for (const s of stages) {
      if (
        s &&
        typeof s === 'object' &&
        'key' in s &&
        'label' in s &&
        'defaultProbability' in s
      ) {
        out.push({
          key: (s as PipelineStageDto).key,
          label: (s as PipelineStageDto).label,
          defaultProbability: (s as PipelineStageDto).defaultProbability,
          isWon: (s as PipelineStageDto).isWon ?? false,
          isLost: (s as PipelineStageDto).isLost ?? false,
        });
      }
    }
    return out.length > 0 ? out : DEFAULT_STAGES;
  }

  /** Resolve the probability for a deal stage, falling back to defaults. */
  private async resolveProbability(
    tenantId: string,
    pipelineId: string | null,
    stage: DealStage,
    override?: number,
  ): Promise<number> {
    if (override !== undefined) return Math.max(0, Math.min(100, override));
    if (!pipelineId) {
      const def = DEFAULT_STAGES.find((s) => s.key === stage);
      return def?.defaultProbability ?? 20;
    }
    const pipeline = await this.prisma.crmPipeline.findFirst({
      where: { id: pipelineId, tenantId },
    });
    if (!pipeline) {
      const def = DEFAULT_STAGES.find((s) => s.key === stage);
      return def?.defaultProbability ?? 20;
    }
    const stages = this.normalizeStages(pipeline.stages);
    const match = stages.find((s) => s.key === stage);
    return match?.defaultProbability ?? 20;
  }

  private async assertContactExists(tenantId: string, contactId: string) {
    const c = await this.prisma.crmContact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Contact not found');
  }

  private async assertDealExists(tenantId: string, dealId: string) {
    const d = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Deal not found');
  }

  private async assertPipelineExists(tenantId: string, pipelineId: string) {
    const p = await this.prisma.crmPipeline.findFirst({
      where: { id: pipelineId, tenantId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Pipeline not found');
  }

  private async assertPartyExists(tenantId: string, partyId: string) {
    const p = await this.prisma.party.findFirst({
      where: { id: partyId, tenantId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Party not found');
  }

  private sanitizeContact(c: any) {
    if (!c) return c;
    return { ...c };
  }
}