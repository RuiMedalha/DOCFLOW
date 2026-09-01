import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction, ContactType, Prisma } from '@prisma/client';
import { ContactsService } from './contacts.service';

/**
 * Tests for ContactsService — findDuplicates + mergeContacts.
 *
 * Pattern mirrors crm.service.spec.ts: in-memory doubles for the Prisma
 * models, a fake AuditService, and assertions on the validation,
 * dedup, and audit-write paths.
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
  city: string | null;
  tags: string[];
  notes: string | null;
  isActive: boolean;
};

type DealRow = { id: string; tenantId: string; contactId: string };
type ActivityRow = { id: string; tenantId: string; contactId: string | null };
type PersonRow = { id: string; contactId: string };

function makePrisma() {
  const dbContacts = new Map<string, ContactRow>();
  const dbDeals = new Map<string, DealRow>();
  const dbActivities = new Map<string, ActivityRow>();
  const dbPersons = new Map<string, PersonRow>();

  const tx = {
    crmContact: {
      findFirst: jest.fn(async ({ where: { id, tenantId } }: any) => {
        const r = dbContacts.get(id);
        if (r && r.tenantId === tenantId) return r;
        return null;
      }),
      findMany: jest.fn(async ({ where: { id, tenantId } }: any) => {
        return [...dbContacts.values()].filter(
          (c) => c.tenantId === tenantId && id.in.includes(c.id),
        );
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        const r = dbContacts.get(id);
        if (!r) throw new Error(`mock: contact ${id} missing`);
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of dbContacts.values()) {
          const matchesTenant =
            !where.tenantId || r.tenantId === where.tenantId;
          const matchesId =
            !where.id || !where.id.in || where.id.in.includes(r.id);
          if (matchesTenant && matchesId) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
    },
    deal: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of dbDeals.values()) {
          if (
            r.tenantId === where.tenantId &&
            where.contactId.in.includes(r.contactId)
          ) {
            r.contactId = data.contactId;
            count++;
          }
        }
        return { count };
      }),
    },
    activity: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of dbActivities.values()) {
          if (
            r.tenantId === where.tenantId &&
            where.contactId.in.includes(r.contactId)
          ) {
            r.contactId = data.contactId;
            count++;
          }
        }
        return { count };
      }),
    },
    contactPerson: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of dbPersons.values()) {
          if (where.contactId.in.includes(r.contactId)) {
            r.contactId = data.contactId;
            count++;
          }
        }
        return { count };
      }),
    },
  };

  return {
    dbContacts,
    dbDeals,
    dbActivities,
    dbPersons,
    tx,
    crmContact: {
      findMany: jest.fn(async ({ where }: any) => {
        return [...dbContacts.values()].filter((c) => c.tenantId === where.tenantId);
      }),
    },
    deal: { count: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
}

function makeAudit() {
  return { log: jest.fn() } as any;
}

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

function seedContact(
  prisma: ReturnType<typeof makePrisma>,
  c: Partial<ContactRow> & { id: string; tenantId: string; name: string },
) {
  prisma.dbContacts.set(c.id, {
    type: ContactType.COMPANY,
    nif: null,
    email: null,
    phone: null,
    mobile: null,
    city: null,
    tags: [],
    notes: null,
    isActive: true,
    ...c,
  } as ContactRow);
}

describe('ContactsService', () => {
  describe('findDuplicates()', () => {
    it('returns empty clusters for an empty tenant', async () => {
      const prisma = makePrisma();
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      expect(out.scanned).toBe(0);
      expect(out.clusters).toEqual([]);
    });

    it('clusters by exact NIF with confidence 1.0', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'a', tenantId: TENANT_ID, name: 'EDP', nif: '500697256' });
      seedContact(prisma, { id: 'b', tenantId: TENANT_ID, name: 'EDP SA', nif: '500697256' });
      seedContact(prisma, { id: 'c', tenantId: TENANT_ID, name: 'Galp', nif: '500697257' });
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      const nifCluster = out.clusters.find((cl) => cl.reason.startsWith('nif:'));
      expect(nifCluster).toBeDefined();
      expect(nifCluster!.contactIds.sort()).toEqual(['a', 'b']);
      expect(nifCluster!.confidence).toBe(1);
    });

    it('clusters by email case-insensitively with confidence 0.95', async () => {
      const prisma = makePrisma();
      seedContact(prisma, {
        id: 'a',
        tenantId: TENANT_ID,
        name: 'A',
        email: 'Hello@Example.COM',
      });
      seedContact(prisma, {
        id: 'b',
        tenantId: TENANT_ID,
        name: 'B',
        email: 'hello@example.com',
      });
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      const cluster = out.clusters.find((cl) => cl.reason.startsWith('email:'));
      expect(cluster).toBeDefined();
      expect(cluster!.contactIds.sort()).toEqual(['a', 'b']);
      expect(cluster!.confidence).toBe(0.95);
    });

    it('clusters by normalized name (diacritics + case)', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'a', tenantId: TENANT_ID, name: 'Tasca do Chico' });
      seedContact(prisma, { id: 'b', tenantId: TENANT_ID, name: 'TASCA   DO CHICÔ' });
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      const cluster = out.clusters.find((cl) => cl.reason.startsWith('name:'));
      expect(cluster).toBeDefined();
      expect(cluster!.confidence).toBe(0.7);
    });

    it('clusters by phone stripping country code', async () => {
      const prisma = makePrisma();
      seedContact(prisma, {
        id: 'a',
        tenantId: TENANT_ID,
        name: 'A',
        phone: '+351 910 000 000',
      });
      seedContact(prisma, {
        id: 'b',
        tenantId: TENANT_ID,
        name: 'B',
        phone: '910000000',
      });
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      const cluster = out.clusters.find((cl) => cl.reason.startsWith('phone:'));
      expect(cluster).toBeDefined();
      expect(cluster!.contactIds.sort()).toEqual(['a', 'b']);
      expect(cluster!.confidence).toBe(0.9);
    });

    it('does not cluster a single contact', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'a', tenantId: TENANT_ID, name: 'Solo', nif: '500000001' });
      const svc = new ContactsService(prisma, makeAudit());
      const out = await svc.findDuplicates(TENANT_ID);
      expect(out.clusters).toEqual([]);
    });
  });

  describe('mergeContacts()', () => {
    it('rejects when masterId is in duplicateIds', async () => {
      const prisma = makePrisma();
      const svc = new ContactsService(prisma, makeAudit());
      await expect(
        svc.mergeContacts(TENANT_ID, USER_ID, {
          masterId: 'x',
          duplicateIds: ['x', 'y'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 404 when the master is missing', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'dup', tenantId: TENANT_ID, name: 'Dup' });
      const svc = new ContactsService(prisma, makeAudit());
      await expect(
        svc.mergeContacts(TENANT_ID, USER_ID, {
          masterId: 'missing',
          duplicateIds: ['dup'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when a duplicate is missing', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'm', tenantId: TENANT_ID, name: 'Master' });
      const svc = new ContactsService(prisma, makeAudit());
      await expect(
        svc.mergeContacts(TENANT_ID, USER_ID, {
          masterId: 'm',
          duplicateIds: ['ghost'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fills master nulls with duplicate values (default)', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'm', tenantId: TENANT_ID, name: 'Master' });
      seedContact(prisma, {
        id: 'd1',
        tenantId: TENANT_ID,
        name: 'Dup',
        nif: '500697256',
        email: 'd1@x.pt',
      });
      const audit = makeAudit();
      const svc = new ContactsService(prisma, audit);
      const out = await svc.mergeContacts(TENANT_ID, USER_ID, {
        masterId: 'm',
        duplicateIds: ['d1'],
      });
      const m = prisma.dbContacts.get('m')!;
      expect(m.nif).toBe('500697256');
      expect(m.email).toBe('d1@x.pt');
      expect(out.fieldsUpdated.sort()).toEqual(['email', 'nif']);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EDIT,
          entityType: 'crm_contact',
          metadata: expect.objectContaining({ operation: 'merge' }),
        }),
      );
    });

    it('does NOT overwrite master non-null values when overwrite=false', async () => {
      const prisma = makePrisma();
      seedContact(prisma, {
        id: 'm',
        tenantId: TENANT_ID,
        name: 'Master',
        email: 'master@x.pt',
      });
      seedContact(prisma, {
        id: 'd1',
        tenantId: TENANT_ID,
        name: 'Dup',
        email: 'dup@x.pt',
      });
      const svc = new ContactsService(prisma, makeAudit());
      await svc.mergeContacts(TENANT_ID, USER_ID, {
        masterId: 'm',
        duplicateIds: ['d1'],
      });
      const m = prisma.dbContacts.get('m')!;
      expect(m.email).toBe('master@x.pt');
    });

    it('does overwrite when overwrite=true', async () => {
      const prisma = makePrisma();
      seedContact(prisma, {
        id: 'm',
        tenantId: TENANT_ID,
        name: 'Master',
        city: 'Lisboa',
      });
      seedContact(prisma, {
        id: 'd1',
        tenantId: TENANT_ID,
        name: 'Dup',
        city: 'Porto',
      });
      const svc = new ContactsService(prisma, makeAudit());
      await svc.mergeContacts(TENANT_ID, USER_ID, {
        masterId: 'm',
        duplicateIds: ['d1'],
        overwrite: true,
      });
      expect(prisma.dbContacts.get('m')!.city).toBe('Porto');
    });

    it('soft-deletes duplicates and tags them with merged-into', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'm', tenantId: TENANT_ID, name: 'Master' });
      seedContact(prisma, { id: 'd1', tenantId: TENANT_ID, name: 'Dup' });
      const svc = new ContactsService(prisma, makeAudit());
      await svc.mergeContacts(TENANT_ID, USER_ID, {
        masterId: 'm',
        duplicateIds: ['d1'],
      });
      const d1 = prisma.dbContacts.get('d1')!;
      expect(d1.isActive).toBe(false);
      expect(d1.tags).toContain('merged-into:m');
    });

    it('re-points deals, activities, and persons to the master', async () => {
      const prisma = makePrisma();
      seedContact(prisma, { id: 'm', tenantId: TENANT_ID, name: 'Master' });
      seedContact(prisma, { id: 'd1', tenantId: TENANT_ID, name: 'Dup' });
      prisma.dbDeals.set('deal-1', { id: 'deal-1', tenantId: TENANT_ID, contactId: 'd1' });
      prisma.dbActivities.set('act-1', {
        id: 'act-1',
        tenantId: TENANT_ID,
        contactId: 'd1',
      });
      prisma.dbPersons.set('p-1', { id: 'p-1', contactId: 'd1' });
      const svc = new ContactsService(prisma, makeAudit());
      await svc.mergeContacts(TENANT_ID, USER_ID, {
        masterId: 'm',
        duplicateIds: ['d1'],
      });
      expect(prisma.dbDeals.get('deal-1')!.contactId).toBe('m');
      expect(prisma.dbActivities.get('act-1')!.contactId).toBe('m');
      expect(prisma.dbPersons.get('p-1')!.contactId).toBe('m');
    });
  });
});