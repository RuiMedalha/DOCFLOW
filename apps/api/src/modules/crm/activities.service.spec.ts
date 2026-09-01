import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ActivitiesService } from './activities.service';

/**
 * Tests for ActivitiesService — pending + attach/detach + bulk-complete.
 *
 * Pattern mirrors contacts.spec.ts: in-memory map for Activity rows,
 * fake AuditService, no real Prisma client.
 */

type ActivityRow = {
  id: string;
  tenantId: string;
  contactId: string | null;
  dealId: string | null;
  type: any;
  subject: string;
  dueDate: Date | null;
  completedAt: Date | null;
  assignedToId: string | null;
  createdById: string;
  createdAt: Date;
};

function makePrisma() {
  const db = new Map<string, ActivityRow>();

  return {
    db,
    activity: {
      findMany: jest.fn(async ({ where }: any) => {
        return [...db.values()].filter((r) => {
          if (r.tenantId !== where.tenantId) return false;
          if (where.completedAt === null && r.completedAt !== null) return false;
          if (where.assignedToId && r.assignedToId !== where.assignedToId)
            return false;
          if (where.dueDate) {
            if (where.dueDate.lt && r.dueDate && r.dueDate >= where.dueDate.lt)
              return false;
            if (where.dueDate.not === null && !r.dueDate) return false;
          }
          return true;
        });
      }),
      findFirst: jest.fn(async ({ where: { id, tenantId } }: any) => {
        const r = db.get(id);
        if (r && r.tenantId === tenantId) return r;
        return null;
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        const r = db.get(id);
        if (!r) throw new Error('mock: missing activity');
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of db.values()) {
          if (
            r.tenantId === where.tenantId &&
            where.id.in.includes(r.id) &&
            // Mirror the production filter: only flip rows whose
            // completedAt already matches the where clause (null in our
            // case) — otherwise we'd re-complete already-done items.
            (where.completedAt === undefined ||
              r.completedAt === where.completedAt)
          ) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
    },
    crmContact: {
      findFirst: jest.fn(),
    },
    deal: {
      findFirst: jest.fn(),
    },
  } as any;
}

function makeAudit() {
  return { log: jest.fn() } as any;
}

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

function seed(
  prisma: ReturnType<typeof makePrisma>,
  a: Partial<ActivityRow> & { id: string; tenantId: string; subject: string },
) {
  prisma.db.set(a.id, {
    contactId: null,
    dealId: null,
    dueDate: null,
    completedAt: null,
    assignedToId: null,
    createdById: USER_ID,
    createdAt: new Date(),
    type: 'TASK',
    ...a,
  } as ActivityRow);
}

describe('ActivitiesService', () => {
  describe('pending()', () => {
    it('excludes completed activities', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-1',
        tenantId: TENANT_ID,
        subject: 'Open',
        dueDate: new Date(Date.now() + 86_400_000),
      });
      seed(prisma, {
        id: 'a-2',
        tenantId: TENANT_ID,
        subject: 'Done',
        dueDate: new Date(Date.now() + 86_400_000),
        completedAt: new Date(),
      });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.pending(TENANT_ID);
      expect(out.map((a) => a.id)).toEqual(['a-1']);
    });

    it('only returns overdue when onlyOverdue=true', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-future',
        tenantId: TENANT_ID,
        subject: 'Future',
        dueDate: new Date(Date.now() + 86_400_000 * 7),
      });
      seed(prisma, {
        id: 'a-past',
        tenantId: TENANT_ID,
        subject: 'Past',
        dueDate: new Date(Date.now() - 86_400_000 * 2),
      });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.pending(TENANT_ID, { onlyOverdue: true });
      expect(out.map((a) => a.id)).toEqual(['a-past']);
      expect(out[0].overdue).toBe(true);
      expect(out[0].daysUntilDue).toBeLessThan(0);
    });

    it('filters by assignee when assignedToId is given', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-mine',
        tenantId: TENANT_ID,
        subject: 'Mine',
        assignedToId: 'user-1',
        dueDate: new Date(Date.now() + 86_400_000),
      });
      seed(prisma, {
        id: 'a-yours',
        tenantId: TENANT_ID,
        subject: 'Yours',
        assignedToId: 'user-2',
        dueDate: new Date(Date.now() + 86_400_000),
      });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.pending(TENANT_ID, { assignedToId: 'user-1' });
      expect(out.map((a) => a.id)).toEqual(['a-mine']);
    });
  });

  describe('attachToDeal()', () => {
    it('attaches an activity to a deal and writes audit', async () => {
      const prisma = makePrisma();
      seed(prisma, { id: 'a-1', tenantId: TENANT_ID, subject: 'X' });
      prisma.crmContact.findFirst.mockResolvedValue({ id: 'c-1' });
      prisma.deal.findFirst.mockResolvedValue({ id: 'd-1' });
      const audit = makeAudit();
      const svc = new ActivitiesService(prisma, audit);
      const out = await svc.attachToDeal(TENANT_ID, USER_ID, 'a-1', 'd-1');
      expect(out.attached).toBe(true);
      expect(prisma.db.get('a-1')!.dealId).toBe('d-1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.EDIT }),
      );
    });

    it('is a no-op when the activity is already attached to the deal', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-1',
        tenantId: TENANT_ID,
        subject: 'X',
        dealId: 'd-1',
      });
      prisma.crmContact.findFirst.mockResolvedValue({ id: 'c-1' });
      prisma.deal.findFirst.mockResolvedValue({ id: 'd-1' });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.attachToDeal(TENANT_ID, USER_ID, 'a-1', 'd-1');
      expect(out.attached).toBe(false);
    });

    it('throws 404 when the deal does not exist', async () => {
      const prisma = makePrisma();
      seed(prisma, { id: 'a-1', tenantId: TENANT_ID, subject: 'X' });
      prisma.crmContact.findFirst.mockResolvedValue({ id: 'c-1' });
      prisma.deal.findFirst.mockResolvedValue(null);
      const svc = new ActivitiesService(prisma, makeAudit());
      await expect(
        svc.attachToDeal(TENANT_ID, USER_ID, 'a-1', 'd-ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('detachFromDeal()', () => {
    it('sets dealId to null when previously attached', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-1',
        tenantId: TENANT_ID,
        subject: 'X',
        dealId: 'd-1',
      });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.detachFromDeal(TENANT_ID, USER_ID, 'a-1');
      expect(out.detached).toBe(true);
      expect(prisma.db.get('a-1')!.dealId).toBeNull();
    });

    it('returns detached=false when the activity was not attached', async () => {
      const prisma = makePrisma();
      seed(prisma, { id: 'a-1', tenantId: TENANT_ID, subject: 'X' });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.detachFromDeal(TENANT_ID, USER_ID, 'a-1');
      expect(out.detached).toBe(false);
    });
  });

  describe('bulkComplete()', () => {
    it('rejects an empty list', async () => {
      const prisma = makePrisma();
      const svc = new ActivitiesService(prisma, makeAudit());
      await expect(
        svc.bulkComplete(TENANT_ID, USER_ID, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('flips completedAt for open ids and reports counts', async () => {
      const prisma = makePrisma();
      seed(prisma, {
        id: 'a-1',
        tenantId: TENANT_ID,
        subject: 'A',
        dueDate: new Date(Date.now() + 86_400_000),
      });
      seed(prisma, {
        id: 'a-2',
        tenantId: TENANT_ID,
        subject: 'B',
        dueDate: new Date(Date.now() + 86_400_000),
      });
      seed(prisma, {
        id: 'a-3',
        tenantId: TENANT_ID,
        subject: 'Done',
        dueDate: new Date(Date.now() + 86_400_000),
        completedAt: new Date(),
      });
      const svc = new ActivitiesService(prisma, makeAudit());
      const out = await svc.bulkComplete(TENANT_ID, USER_ID, [
        'a-1',
        'a-2',
        'a-3',
        'a-ghost',
      ]);
      expect(out).toEqual({ requested: 4, completed: 2, missing: 2 });
      expect(prisma.db.get('a-1')!.completedAt).toBeTruthy();
      expect(prisma.db.get('a-2')!.completedAt).toBeTruthy();
    });
  });
});