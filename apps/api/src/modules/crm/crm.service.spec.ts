import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  AuditAction,
  ContactType,
  DealStage,
} from '@prisma/client';
import { CrmService } from './crm.service';

/**
 * In-memory test double for the Prisma models CrmService touches.
 * Mirrors the parties.spec.ts pattern: narrow stubs that exercise the
 * validation flow, audit-write ordering, stage-transition bookkeeping, and
 * import mapping without spinning up a real Prisma client.
 */

type ContactRow = {
  id: string;
  tenantId: string;
  type: ContactType;
  name: string;
  nif: string | null;
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
  partyId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ContactPersonRow = {
  id: string;
  contactId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: Date;
};

type PipelineRow = {
  id: string;
  tenantId: string;
  name: string;
  stages: unknown;
  isDefault: boolean;
  createdAt: Date;
};

type DealRow = {
  id: string;
  tenantId: string;
  contactId: string;
  title: string;
  value: number;
  stage: DealStage;
  probability: number;
  expectedCloseDate: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
  pipelineId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

type ActivityRow = {
  id: string;
  tenantId: string;
  contactId: string | null;
  dealId: string | null;
  type: ActivityType;
  subject: string;
  description: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  assignedToId: string | null;
  createdById: string;
  createdAt: Date;
};

type PartyRow = {
  id: string;
  tenantId: string;
  name: string;
  nif: string | null;
};

type AuditRow = {
  id: string;
  tenantId: string;
  userId: string | null;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

function buildPrismaStub() {
  const dbContacts = new Map<string, ContactRow>();
  const dbPersons = new Map<string, ContactPersonRow>();
  const dbPipelines = new Map<string, PipelineRow>();
  const dbDeals = new Map<string, DealRow>();
  const dbActivities = new Map<string, ActivityRow>();
  const dbParties = new Map<string, PartyRow>();
  const auditLog: AuditRow[] = [];

  let ctr = 0;
  const ctrByPrefix: Record<string, number> = {};
  const nextId = (p: string) => {
    ctrByPrefix[p] = (ctrByPrefix[p] ?? 0) + 1;
    return `${p}-${ctrByPrefix[p]}`;
  };

  function findById<T extends { id: string; tenantId?: string }>(
    collection: Map<string, T>,
    id: string,
    tenantId?: string,
  ): T | null {
    const row = collection.get(id);
    if (!row) return null;
    if (tenantId && 'tenantId' in row && row.tenantId !== tenantId) return null;
    return row;
  }

  const crmContactModel = {
    findFirst: jest.fn(async ({ where, select }: any) => {
      for (const c of dbContacts.values()) {
        const matchId = !where?.id || where.id === c.id;
        const matchTenant = !where?.tenantId || c.tenantId === where.tenantId;
        const matchNif = !where?.nif || c.nif === where.nif;
        const matchEmail = !where?.email || c.email === where.email;
        const notId = !where?.NOT?.id || c.id !== where.NOT.id;
        if (matchId && matchTenant && matchNif && matchEmail && notId) {
          if (select) {
            const out: any = {};
            for (const k of Object.keys(select)) out[k] = (c as any)[k];
            return out;
          }
          return { ...c };
        }
      }
      return null;
    }),
    findMany: jest.fn(async ({ where, take, skip }: any = {}) => {
      let rows = Array.from(dbContacts.values()).filter(
        (c) => !where?.tenantId || c.tenantId === where.tenantId,
      );
      if (where?.isActive !== undefined)
        rows = rows.filter((c) => c.isActive === where.isActive);
      if (where?.type) rows = rows.filter((c) => c.type === where.type);
      if (where?.OR) {
        const ors = where.OR as Array<Record<string, unknown>>;
        rows = rows.filter((c) =>
          ors.some((cond) =>
            Object.entries(cond).every(([k, v]) => {
              if (!v || typeof v !== 'object' || !('contains' in v)) return true;
              const target = String((c as any)[k] ?? '').toLowerCase();
              return target.includes(String(v.contains).toLowerCase());
            }),
          ),
        );
      }
      rows.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      if (typeof skip === 'number') rows = rows.slice(skip);
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((c) => ({ ...c }));
    }),
    count: jest.fn(async ({ where }: any = {}) =>
      Array.from(dbContacts.values()).filter(
        (c) => !where?.tenantId || c.tenantId === where.tenantId,
      ).length,
    ),
    create: jest.fn(async ({ data }: any) => {
      const id = nextId('contact');
      const now = new Date();
      const row: ContactRow = {
        id,
        tenantId: data.tenantId,
        type: data.type ?? ContactType.COMPANY,
        name: data.name,
        nif: data.nif ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        mobile: data.mobile ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country ?? 'Portugal',
        website: data.website ?? null,
        industry: data.industry ?? null,
        notes: data.notes ?? null,
        tags: data.tags ?? [],
        partyId: data.partyId ?? null,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      };
      dbContacts.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbContacts.get(where.id);
      if (!row) throw new Error('contact not found');
      Object.assign(row, data);
      row.updatedAt = new Date();
      return { ...row };
    }),
  };

  const contactPersonModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      return findById(dbPersons, where.id);
    }),
    findMany: jest.fn(async ({ where }: any = {}) => {
      let rows = Array.from(dbPersons.values()).filter(
        (p) => !where?.contactId || p.contactId === where.contactId,
      );
      if (where?.isPrimary !== undefined)
        rows = rows.filter((r) => r.isPrimary === where.isPrimary);
      if (where?.NOT?.id)
        rows = rows.filter((r) => r.id !== where.NOT.id);
      return rows.map((p) => ({ ...p }));
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const p of dbPersons.values()) {
        if (where.contactId && p.contactId !== where.contactId) continue;
        if (where.isPrimary !== undefined && p.isPrimary !== where.isPrimary)
          continue;
        if (where.NOT?.id && p.id === where.NOT.id) continue;
        Object.assign(p, data);
        n += 1;
      }
      return { count: n };
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = nextId('person');
      const row: ContactPersonRow = {
        id,
        contactId: data.contactId,
        name: data.name,
        role: data.role ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        isPrimary: data.isPrimary ?? false,
        createdAt: new Date(),
      };
      dbPersons.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbPersons.get(where.id);
      if (!row) throw new Error('person not found');
      Object.assign(row, data);
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const row = dbPersons.get(where.id);
      if (!row) throw new Error('person not found');
      dbPersons.delete(where.id);
      return { ...row };
    }),
  };

  const crmPipelineModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      for (const p of dbPipelines.values()) {
        if (where?.id && p.id !== where.id) continue;
        if (where?.tenantId && p.tenantId !== where.tenantId) continue;
        if (where?.isDefault !== undefined && p.isDefault !== where.isDefault)
          continue;
        return { ...p };
      }
      return null;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => {
      let rows = Array.from(dbPipelines.values()).filter(
        (p) => !where?.tenantId || p.tenantId === where.tenantId,
      );
      return rows.map((p) => ({ ...p }));
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const p of dbPipelines.values()) {
        if (where?.tenantId && p.tenantId !== where.tenantId) continue;
        if (where?.isDefault !== undefined && p.isDefault !== where.isDefault)
          continue;
        if (where?.NOT?.id && p.id === where.NOT.id) continue;
        Object.assign(p, data);
        n += 1;
      }
      return { count: n };
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = nextId('pipeline');
      const row: PipelineRow = {
        id,
        tenantId: data.tenantId,
        name: data.name,
        stages: data.stages,
        isDefault: data.isDefault ?? false,
        createdAt: new Date(),
      };
      dbPipelines.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbPipelines.get(where.id);
      if (!row) throw new Error('pipeline not found');
      Object.assign(row, data);
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const row = dbPipelines.get(where.id);
      if (!row) throw new Error('pipeline not found');
      dbPipelines.delete(where.id);
      return { ...row };
    }),
  };

  const dealModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      for (const d of dbDeals.values()) {
        if (where?.id && d.id !== where.id) continue;
        if (where?.tenantId && d.tenantId !== where.tenantId) continue;
        return { ...d };
      }
      return null;
    }),
    findMany: jest.fn(async ({ where, take, skip }: any = {}) => {
      let rows = Array.from(dbDeals.values()).filter(
        (d) => !where?.tenantId || d.tenantId === where.tenantId,
      );
      if (where?.stage) rows = rows.filter((d) => d.stage === where.stage);
      if (where?.contactId)
        rows = rows.filter((d) => d.contactId === where.contactId);
      if (where?.pipelineId)
        rows = rows.filter((d) => d.pipelineId === where.pipelineId);
      if (where?.createdById)
        rows = rows.filter((d) => d.createdById === where.createdById);
      if (typeof skip === 'number') rows = rows.slice(skip);
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((d) => ({ ...d }));
    }),
    count: jest.fn(async ({ where }: any = {}) => {
      return Array.from(dbDeals.values()).filter(
        (d) =>
          (!where?.tenantId || d.tenantId === where.tenantId) &&
          (!where?.pipelineId || d.pipelineId === where.pipelineId),
      ).length;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = nextId('deal');
      const now = new Date();
      const row: DealRow = {
        id,
        tenantId: data.tenantId,
        contactId: data.contactId,
        title: data.title,
        value: Number(data.value),
        stage: data.stage ?? DealStage.LEAD,
        probability: data.probability ?? 20,
        expectedCloseDate: data.expectedCloseDate
          ? new Date(data.expectedCloseDate)
          : null,
        wonAt: null,
        lostAt: null,
        pipelineId: data.pipelineId ?? null,
        createdById: data.createdById,
        createdAt: now,
        updatedAt: now,
      };
      dbDeals.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbDeals.get(where.id);
      if (!row) throw new Error('deal not found');
      Object.assign(row, data);
      row.updatedAt = new Date();
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const row = dbDeals.get(where.id);
      if (!row) throw new Error('deal not found');
      dbDeals.delete(where.id);
      return { ...row };
    }),
  };

  const activityModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      for (const a of dbActivities.values()) {
        if (where?.id && a.id !== where.id) continue;
        if (where?.tenantId && a.tenantId !== where.tenantId) continue;
        return { ...a };
      }
      return null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const id = nextId('activity');
      const row: ActivityRow = {
        id,
        tenantId: data.tenantId,
        contactId: data.contactId ?? null,
        dealId: data.dealId ?? null,
        type: data.type,
        subject: data.subject,
        description: data.description ?? null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        completedAt: data.completedAt ?? null,
        assignedToId: data.assignedToId ?? null,
        createdById: data.createdById,
        createdAt: new Date(),
      };
      dbActivities.set(id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = dbActivities.get(where.id);
      if (!row) throw new Error('activity not found');
      Object.assign(row, data);
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const row = dbActivities.get(where.id);
      if (!row) throw new Error('activity not found');
      dbActivities.delete(where.id);
      return { ...row };
    }),
  };

  const partyModel = {
    findFirst: jest.fn(async ({ where }: any) => {
      for (const p of dbParties.values()) {
        if (where?.id && p.id !== where.id) continue;
        if (where?.tenantId && p.tenantId !== where.tenantId) continue;
        return { ...p };
      }
      return null;
    }),
  };

  const auditLogModel = {
    create: jest.fn(async ({ data }: any) => {
      const id = `audit-${auditLog.length + 1}`;
      const row: AuditRow = {
        id,
        tenantId: data.tenantId,
        userId: data.userId ?? null,
        action: data.action,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        metadata: data.metadata ?? null,
      };
      auditLog.push(row);
      return { ...row };
    }),
    findMany: jest.fn(async ({ where, take, skip }: any = {}) => {
      let rows = auditLog.filter(
        (r) => !where?.tenantId || r.tenantId === where.tenantId,
      );
      if (where?.action) rows = rows.filter((r) => r.action === where.action);
      if (where?.entityType)
        rows = rows.filter((r) => r.entityType === where.entityType);
      if (typeof skip === 'number') rows = rows.slice(skip);
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    }),
  };

  return {
    dbContacts,
    dbPersons,
    dbPipelines,
    dbDeals,
    dbActivities,
    dbParties,
    auditLog,
    crmContact: crmContactModel,
    contactPerson: contactPersonModel,
    crmPipeline: crmPipelineModel,
    deal: dealModel,
    activity: activityModel,
    party: partyModel,
    auditLogModel,
  };
}

function buildAuditStub() {
  return { log: jest.fn(async () => undefined) };
}

describe('CrmService', () => {
  let prisma: ReturnType<typeof buildPrismaStub>;
  let audit: ReturnType<typeof buildAuditStub>;
  let svc: CrmService;

  beforeEach(() => {
    prisma = buildPrismaStub();
    audit = buildAuditStub();
    svc = new CrmService(prisma as any, audit as any);
  });

  // ──────────────────────────────────────────── CONTACTS

  describe('createContact()', () => {
    it('creates a contact and writes a CREATE audit row', async () => {
      const out = await svc.createContact(TENANT_ID, USER_ID, {
        type: ContactType.COMPANY,
        name: 'EDP Comercial',
        nif: '500697256',
        email: 'clientes@edp.pt',
        phone: '+351 210 000 000',
        city: 'Lisboa',
      } as any);

      expect(out.id).toMatch(/^contact-/);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          action: AuditAction.CREATE,
          entityType: 'crm_contact',
        }),
      );
    });

    it('rejects a duplicate NIF before touching the database', async () => {
      prisma.dbContacts.set('contact-existing', {
        id: 'contact-existing',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'Other Vendor',
        nif: '500697256',
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);

      await expect(
        svc.createContact(TENANT_ID, USER_ID, {
          type: ContactType.COMPANY,
          name: 'EDP',
          nif: '500697256',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.crmContact.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid NIF with a BadRequest', async () => {
      await expect(
        svc.createContact(TENANT_ID, USER_ID, {
          type: ContactType.COMPANY,
          name: 'Test',
          nif: '000000000',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.crmContact.create).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteContact()', () => {
    it('flips isActive=false and writes a DELETE audit row', async () => {
      prisma.dbContacts.set('contact-1', {
        id: 'contact-1',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'C',
        nif: null,
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);

      const out = await svc.softDeleteContact(TENANT_ID, USER_ID, 'contact-1');
      expect(out.isActive).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.DELETE,
          entityType: 'crm_contact',
        }),
      );
    });

    it('throws 404 when the contact does not exist', async () => {
      await expect(
        svc.softDeleteContact(TENANT_ID, USER_ID, 'contact-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ──────────────────────────────────────────── CONTACT PERSONS

  describe('addContactPerson()', () => {
    beforeEach(() => {
      prisma.dbContacts.set('contact-1', {
        id: 'contact-1',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'C',
        nif: null,
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);
    });

    it('adds a primary person and demotes any prior primary', async () => {
      // Seed an existing primary under a stable, distinct key so the create
      // call (which auto-generates `person-1`) doesn't overwrite it.
      prisma.dbPersons.set('person-existing', {
        id: 'person-existing',
        contactId: 'contact-1',
        name: 'Old Primary',
        role: null,
        email: null,
        phone: null,
        isPrimary: true,
        createdAt: new Date(),
      });

      const newPerson = await svc.addContactPerson(
        TENANT_ID,
        USER_ID,
        'contact-1',
        {
          name: 'New Primary',
          role: 'CEO',
          email: 'new@edp.pt',
          isPrimary: true,
        } as any,
      );

      expect(newPerson.isPrimary).toBe(true);
      // Old primary was demoted.
      expect(prisma.dbPersons.get('person-existing')!.isPrimary).toBe(false);
      // Audit row written.
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'contact_person' }),
      );
    });

    it('throws 404 when the contact does not exist', async () => {
      await expect(
        svc.addContactPerson(TENANT_ID, USER_ID, 'contact-missing', {
          name: 'X',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ──────────────────────────────────────────── PIPELINES

  describe('pipelines', () => {
    it('ensureDefaultPipeline creates the canonical 6-stage pipeline on first call', async () => {
      const id = await svc.ensureDefaultPipeline(TENANT_ID);
      expect(id).toMatch(/^pipeline-/);
      const stored = prisma.dbPipelines.get(id)!;
      expect(stored.isDefault).toBe(true);
      const stages = stored.stages as Array<{ key: DealStage }>;
      expect(stages.map((s) => s.key)).toEqual([
        DealStage.LEAD,
        DealStage.QUALIFIED,
        DealStage.PROPOSAL,
        DealStage.NEGOTIATION,
        DealStage.WON,
        DealStage.LOST,
      ]);
    });

    it('ensureDefaultPipeline returns the existing default on subsequent calls', async () => {
      const id1 = await svc.ensureDefaultPipeline(TENANT_ID);
      const id2 = await svc.ensureDefaultPipeline(TENANT_ID);
      expect(id1).toBe(id2);
    });

    it('createPipeline writes a hash-chained audit row', async () => {
      const out = await svc.createPipeline(TENANT_ID, USER_ID, {
        name: 'Custom Pipeline',
        isDefault: false,
        stages: [
          { key: DealStage.LEAD, label: 'Lead', defaultProbability: 20 },
          { key: DealStage.WON, label: 'Ganho', defaultProbability: 100, isWon: true },
        ],
      } as any);

      expect(out.name).toBe('Custom Pipeline');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'crm_pipeline' }),
      );
    });
  });

  // ──────────────────────────────────────────── DEALS

  describe('createDeal()', () => {
    beforeEach(() => {
      prisma.dbContacts.set('contact-1', {
        id: 'contact-1',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'C',
        nif: null,
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);
    });

    it('creates a deal, ensures the default pipeline, and writes audit', async () => {
      const out = await svc.createDeal(TENANT_ID, USER_ID, {
        contactId: 'contact-1',
        title: 'Contrato anual',
        value: 12500,
        stage: DealStage.LEAD,
        probability: 25,
      } as any);

      expect(out.id).toMatch(/^deal-/);
      expect(out.pipelineId).toBeTruthy();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: 'deal',
        }),
      );
    });

    it('throws 404 when the contact does not exist', async () => {
      await expect(
        svc.createDeal(TENANT_ID, USER_ID, {
          contactId: 'contact-missing',
          title: 'X',
          value: 100,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('moveDealStage()', () => {
    beforeEach(() => {
      prisma.dbContacts.set('contact-1', {
        id: 'contact-1',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'C',
        nif: null,
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);
      prisma.dbDeals.set('deal-1', {
        id: 'deal-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        title: 'T',
        value: 5000,
        stage: DealStage.LEAD,
        probability: 20,
        expectedCloseDate: null,
        wonAt: null,
        lostAt: null,
        pipelineId: null,
        createdById: USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DealRow);
    });

    it('moves a deal to WON and sets wonAt; clears lostAt', async () => {
      // Start with a stale lostAt so we can verify it gets cleared.
      prisma.dbDeals.get('deal-1')!.lostAt = new Date('2020-01-01');

      await svc.moveDealStage(TENANT_ID, USER_ID, 'deal-1', {
        stage: DealStage.WON,
        note: 'Fechado pelo CFO',
      } as any);

      const updated = prisma.dbDeals.get('deal-1')!;
      expect(updated.stage).toBe(DealStage.WON);
      expect(updated.wonAt).toBeTruthy();
      expect(updated.lostAt).toBeNull();
      expect(updated.probability).toBe(100);

      // Audit row for the transition.
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EDIT,
          entityType: 'deal_stage_change',
          metadata: expect.objectContaining({
            fromStage: DealStage.LEAD,
            toStage: DealStage.WON,
          }),
        }),
      );
    });

    it('moves a deal to LOST and sets lostAt; clears wonAt', async () => {
      prisma.dbDeals.get('deal-1')!.wonAt = new Date('2020-01-01');

      await svc.moveDealStage(TENANT_ID, USER_ID, 'deal-1', {
        stage: DealStage.LOST,
      } as any);

      const updated = prisma.dbDeals.get('deal-1')!;
      expect(updated.stage).toBe(DealStage.LOST);
      expect(updated.lostAt).toBeTruthy();
      expect(updated.wonAt).toBeNull();
      expect(updated.probability).toBe(0);
    });

    it('honours caller-supplied probability override', async () => {
      await svc.moveDealStage(TENANT_ID, USER_ID, 'deal-1', {
        stage: DealStage.NEGOTIATION,
        probability: 85,
      } as any);

      expect(prisma.dbDeals.get('deal-1')!.probability).toBe(85);
    });
  });

  describe('pipelineStats()', () => {
    it('aggregates by stage with weighted forecast', async () => {
      prisma.dbDeals.set('d1', {
        id: 'd1',
        tenantId: TENANT_ID,
        contactId: 'c1',
        title: 'A',
        value: 1000,
        stage: DealStage.LEAD,
        probability: 20,
        expectedCloseDate: null,
        wonAt: null,
        lostAt: null,
        pipelineId: null,
        createdById: USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DealRow);
      prisma.dbDeals.set('d2', {
        id: 'd2',
        tenantId: TENANT_ID,
        contactId: 'c1',
        title: 'B',
        value: 2000,
        stage: DealStage.WON,
        probability: 100,
        expectedCloseDate: null,
        wonAt: new Date(),
        lostAt: null,
        pipelineId: null,
        createdById: USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DealRow);

      const stats = await svc.pipelineStats(TENANT_ID);
      expect(stats.byStage[DealStage.LEAD].count).toBe(1);
      expect(stats.byStage[DealStage.LEAD].value).toBeCloseTo(1000, 5);
      expect(stats.byStage[DealStage.LEAD].weightedValue).toBeCloseTo(200, 5);
      expect(stats.totals.wonCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────── ACTIVITIES

  describe('createActivity()', () => {
    beforeEach(() => {
      prisma.dbContacts.set('contact-1', {
        id: 'contact-1',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'C',
        nif: null,
        email: null,
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);
    });

    it('logs an activity and writes audit', async () => {
      const out = await svc.createActivity(TENANT_ID, USER_ID, {
        type: ActivityType.CALL,
        subject: 'Follow-up call',
        contactId: 'contact-1',
        dueDate: '2026-09-15T10:00:00Z',
      } as any);

      expect(out.id).toMatch(/^activity-/);
      expect(out.type).toBe(ActivityType.CALL);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'activity' }),
      );
    });

    it('throws 404 when the contact does not exist', async () => {
      await expect(
        svc.createActivity(TENANT_ID, USER_ID, {
          type: ActivityType.EMAIL,
          subject: 'X',
          contactId: 'contact-missing',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('completeActivity()', () => {
    it('flips completedAt to now', async () => {
      prisma.dbActivities.set('a-1', {
        id: 'a-1',
        tenantId: TENANT_ID,
        contactId: null,
        dealId: null,
        type: ActivityType.TASK,
        subject: 'Send proposal',
        description: null,
        dueDate: null,
        completedAt: null,
        assignedToId: USER_ID,
        createdById: USER_ID,
        createdAt: new Date(),
      } as ActivityRow);

      await svc.completeActivity(TENANT_ID, USER_ID, 'a-1');
      expect(prisma.dbActivities.get('a-1')!.completedAt).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────── IMPORT

  describe('importContacts()', () => {
    it('runs in dry-run mode without persisting', async () => {
      const out = await svc.importContacts(TENANT_ID, USER_ID, {
        source: 'hubspot',
        dryRun: true,
        mergeExisting: false,
        mapping: {
          fields: {
            company: 'name',
            vat_number: 'nif',
            email_address: 'email',
            phone: 'phone',
            city: 'city',
          },
        },
        rows: [
          {
            externalId: 'hs-1',
            fields: {
              company: 'Tasca do Chico',
              vat_number: '500697256', // known-valid PT NIF (mod-11)
              email_address: 'geral@tasca-chico.pt',
              phone: '+351 210 555 111',
              city: 'Porto',
            },
          },
        ],
      } as any);

      expect(out.dryRun).toBe(true);
      expect(out.created).toBe(1);
      expect(prisma.crmContact.create).not.toHaveBeenCalled();

      // Audit row IS written, with dryRun=true in metadata.
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.IMPORT,
          entityType: 'crm_sync',
          metadata: expect.objectContaining({
            source: 'hubspot',
            dryRun: true,
          }),
        }),
      );
    });

    it('persists contacts and writes audit row when not in dry-run', async () => {
      const out = await svc.importContacts(TENANT_ID, USER_ID, {
        source: 'hubspot',
        dryRun: false,
        mergeExisting: false,
        mapping: {
          fields: {
            company: 'name',
            vat_number: 'nif',
            email_address: 'email',
            city: 'city',
          },
        },
        rows: [
          {
            externalId: 'hs-1',
            fields: {
              company: 'Papelaria Central',
              vat_number: '500697256', // known-valid PT NIF
              email_address: 'compras@papelaria-central.pt',
              city: 'Lisboa',
            },
          },
        ],
      } as any);

      expect(out.created).toBe(1);
      expect(prisma.crmContact.create).toHaveBeenCalled();
    });

    it('deduplicates by NIF and skips when not merging', async () => {
      prisma.dbContacts.set('contact-existing', {
        id: 'contact-existing',
        tenantId: TENANT_ID,
        type: ContactType.COMPANY,
        name: 'Existing',
        nif: '500697256',
        email: 'existing@edp.pt',
        phone: null,
        mobile: null,
        address: null,
        city: null,
        postalCode: null,
        country: 'Portugal',
        website: null,
        industry: null,
        notes: null,
        tags: [],
        partyId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ContactRow);

      const out = await svc.importContacts(TENANT_ID, USER_ID, {
        source: 'hubspot',
        dryRun: false,
        mergeExisting: false,
        mapping: {
          fields: {
            company: 'name',
            vat_number: 'nif',
            email_address: 'email',
          },
        },
        rows: [
          {
            externalId: 'hs-1',
            fields: {
              company: 'Other',
              vat_number: '500697256',
              email_address: 'other@edp.pt',
            },
          },
        ],
      } as any);

      expect(out.skipped).toBe(1);
      expect(out.created).toBe(0);
      expect(prisma.crmContact.create).not.toHaveBeenCalled();
    });

    it('skips rows missing the required name field', async () => {
      const out = await svc.importContacts(TENANT_ID, USER_ID, {
        source: 'pipedrive',
        dryRun: false,
        mergeExisting: false,
        mapping: {
          fields: {
            company: 'name',
            vat_number: 'nif',
            email_address: 'email',
          },
        },
        rows: [
          { externalId: 'pd-1', fields: { vat_number: '500697256' } },
        ],
      } as any);

      expect(out.skipped).toBe(1);
      expect(out.results[0].reason).toMatch(/name/);
    });
  });
});
