import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction, DealStage, Prisma } from '@prisma/client';
import { DEFAULT_STAGES, PipelinesService } from './pipelines.service';

/**
 * Tests for PipelinesService — list / find / create / update / delete /
 * resolveProbability / ensureDefaultPipeline / getStagesForPipeline.
 *
 * The service uses `prisma.$transaction` for create / update (so the
 * isDefault toggle is atomic). The mock implements a simple tx wrapper
 * that just runs the callback against the same models.
 */

type PipelineRow = {
  id: string;
  tenantId: string;
  name: string;
  stages: unknown;
  isDefault: boolean;
  createdAt: Date;
};

type DealCountRow = { pipelineId: string; tenantId: string };

function makePrisma() {
  const db = new Map<string, PipelineRow>();
  const dbDeals = new Map<string, DealCountRow>();
  let counter = 0;

  const models = {
    crmPipeline: {
      findFirst: jest.fn(async ({ where }: any) => {
        // Support both id-based and isDefault-based lookups.
        for (const r of db.values()) {
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          if (where.id && r.id !== where.id) continue;
          if (where.isDefault !== undefined && r.isDefault !== where.isDefault)
            continue;
          return r;
        }
        return null;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let rows = [...db.values()].filter((r) => r.tenantId === where.tenantId);
        if (orderBy) {
          rows.sort((a: any, b: any) => {
            if (a.isDefault === b.isDefault) return 0;
            return a.isDefault ? -1 : 1;
          });
        }
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `pipe-${++counter}`;
        const row: PipelineRow = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          stages: data.stages,
          isDefault: !!data.isDefault,
          createdAt: new Date(),
        };
        db.set(id, row);
        return row;
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        const r = db.get(id);
        if (!r) throw new Error('mock: pipeline missing');
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of db.values()) {
          if (
            r.tenantId === where.tenantId &&
            (!where.NOT || where.NOT.id !== r.id)
          ) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
      delete: jest.fn(async ({ where: { id } }: any) => {
        db.delete(id);
        return { id };
      }),
    },
    deal: {
      count: jest.fn(async ({ where }: any) => {
        let n = 0;
        for (const d of dbDeals.values()) {
          if (
            d.tenantId === where.tenantId &&
            d.pipelineId === where.pipelineId
          ) {
            n++;
          }
        }
        return n;
      }),
    },
  };

  return {
    db,
    dbDeals,
    ...models,
    $transaction: jest.fn(async (fn: any) => fn(models)),
  } as any;
}

function makeAudit() {
  return { log: jest.fn() } as any;
}

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

describe('PipelinesService', () => {
  describe('DEFAULT_STAGES', () => {
    it('exposes one won and one lost stage', () => {
      const won = DEFAULT_STAGES.find((s) => s.isWon);
      const lost = DEFAULT_STAGES.find((s) => s.isLost);
      expect(won?.key).toBe(DealStage.WON);
      expect(lost?.key).toBe(DealStage.LOST);
    });
  });

  describe('create()', () => {
    it('persists a pipeline with the canonical defaults filled in', async () => {
      const prisma = makePrisma();
      const audit = makeAudit();
      const svc = new PipelinesService(prisma, audit);
      const out = await svc.create(TENANT_ID, USER_ID, {
        name: 'Sales EU',
        stages: [],
      });
      // Empty input + fillMissingStages ⇒ all canonical stages
      expect(out.stages.length).toBe(DEFAULT_STAGES.length);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: 'crm_pipeline',
        }),
      );
    });

    it('validates stages: empty list (no dto.stages) ⇒ defaults; minimal valid persists', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      const out = await svc.create(TENANT_ID, USER_ID, {
        name: 'Minimal valid',
        stages: [
          { key: DealStage.LEAD, label: 'Lead', defaultProbability: 10, isWon: false, isLost: false },
          { key: DealStage.WON, label: 'Won', defaultProbability: 100, isWon: true, isLost: false },
          { key: DealStage.LOST, label: 'Lost', defaultProbability: 0, isWon: false, isLost: true },
        ],
      });
      // Missing stages (QUALIFIED, PROPOSAL, NEGOTIATION) get filled in.
      expect(out.stages.length).toBe(DEFAULT_STAGES.length);
    });

    it('rejects when no WON stage is provided', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      await expect(
        svc.create(TENANT_ID, USER_ID, {
          name: 'X',
          stages: [
            { key: DealStage.LEAD, label: 'Lead', defaultProbability: 10, isWon: false, isLost: false },
            { key: DealStage.LOST, label: 'Lost', defaultProbability: 0, isWon: false, isLost: true },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicate stage keys', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      await expect(
        svc.create(TENANT_ID, USER_ID, {
          name: 'X',
          stages: [
            { key: DealStage.LEAD, label: 'Lead', defaultProbability: 10, isWon: false, isLost: false },
            { key: DealStage.LEAD, label: 'Lead 2', defaultProbability: 30, isWon: false, isLost: false },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('clears isDefault on previous pipelines when creating a new default', async () => {
      const prisma = makePrisma();
      // Pre-seed one default pipeline; use a unique id pattern so it
      // doesn't collide with the create() counter.
      prisma.db.set('pipe-prev', {
        id: 'pipe-prev',
        tenantId: TENANT_ID,
        name: 'Old default',
        stages: DEFAULT_STAGES,
        isDefault: true,
        createdAt: new Date(),
      });
      const svc = new PipelinesService(prisma, makeAudit());
      await svc.create(TENANT_ID, USER_ID, {
        name: 'New default',
        stages: [],
        isDefault: true,
      });
      expect(prisma.db.get('pipe-prev')!.isDefault).toBe(false);
      // The newly created pipeline carries isDefault=true.
      const created = [...prisma.db.values()].find((p) => p.name === 'New default');
      expect(created?.isDefault).toBe(true);
    });
  });

  describe('update()', () => {
    it('updates the name and stages; writes audit', async () => {
      const prisma = makePrisma();
      prisma.db.set('pipe-1', {
        id: 'pipe-1',
        tenantId: TENANT_ID,
        name: 'Old',
        stages: DEFAULT_STAGES,
        isDefault: false,
        createdAt: new Date(),
      });
      const audit = makeAudit();
      const svc = new PipelinesService(prisma, audit);
      await svc.update(TENANT_ID, USER_ID, 'pipe-1', { name: 'New' });
      expect(prisma.db.get('pipe-1')!.name).toBe('New');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EDIT,
          entityType: 'crm_pipeline',
        }),
      );
    });

    it('throws 404 when pipeline is missing', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      await expect(
        svc.update(TENANT_ID, USER_ID, 'missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete()', () => {
    it('refuses when deals still reference the pipeline', async () => {
      const prisma = makePrisma();
      prisma.db.set('pipe-1', {
        id: 'pipe-1',
        tenantId: TENANT_ID,
        name: 'Old',
        stages: DEFAULT_STAGES,
        isDefault: false,
        createdAt: new Date(),
      });
      prisma.dbDeals.set('d-1', { id: 'd-1', tenantId: TENANT_ID, pipelineId: 'pipe-1' });
      const svc = new PipelinesService(prisma, makeAudit());
      await expect(svc.delete(TENANT_ID, USER_ID, 'pipe-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('deletes when no deals reference it', async () => {
      const prisma = makePrisma();
      prisma.db.set('pipe-1', {
        id: 'pipe-1',
        tenantId: TENANT_ID,
        name: 'Old',
        stages: DEFAULT_STAGES,
        isDefault: false,
        createdAt: new Date(),
      });
      const svc = new PipelinesService(prisma, makeAudit());
      const out = await svc.delete(TENANT_ID, USER_ID, 'pipe-1');
      expect(out).toEqual({ deleted: true, id: 'pipe-1' });
    });
  });

  describe('resolveProbability()', () => {
    it('returns the stage probability from the pipeline when present', () => {
      const svc = new PipelinesService(makePrisma(), makeAudit());
      expect(
        svc.resolveProbability(
          [
            { key: DealStage.LEAD, label: 'Lead', defaultProbability: 25, isWon: false, isLost: false },
          ],
          DealStage.LEAD,
        ),
      ).toBe(25);
    });

    it('falls back to canonical defaults when the stage is missing', () => {
      const svc = new PipelinesService(makePrisma(), makeAudit());
      expect(svc.resolveProbability([], DealStage.QUALIFIED)).toBe(40);
    });

    it('returns 0 for an unknown stage', () => {
      const svc = new PipelinesService(makePrisma(), makeAudit());
      // @ts-expect-error — invalid stage for the test
      expect(svc.resolveProbability(null, 'WHATEVER')).toBe(0);
    });
  });

  describe('ensureDefaultPipeline()', () => {
    it('returns the existing default without creating', async () => {
      const prisma = makePrisma();
      prisma.db.set('pipe-default', {
        id: 'pipe-default',
        tenantId: TENANT_ID,
        name: 'Default',
        stages: DEFAULT_STAGES,
        isDefault: true,
        createdAt: new Date(),
      });
      const svc = new PipelinesService(prisma, makeAudit());
      const id = await svc.ensureDefaultPipeline(TENANT_ID);
      expect(id).toBe('pipe-default');
      // No new row was added
      expect(prisma.db.size).toBe(1);
    });

    it('creates a default pipeline when none exists', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      const id = await svc.ensureDefaultPipeline(TENANT_ID);
      expect(prisma.db.has(id)).toBe(true);
      expect(prisma.db.get(id)!.isDefault).toBe(true);
    });
  });

  describe('getStagesForPipeline()', () => {
    it('returns DEFAULT_STAGES when the row is missing', async () => {
      const prisma = makePrisma();
      const svc = new PipelinesService(prisma, makeAudit());
      const stages = await svc.getStagesForPipeline(TENANT_ID, 'missing');
      expect(stages).toEqual(DEFAULT_STAGES);
    });

    it('returns the stored stages for a found pipeline', async () => {
      const prisma = makePrisma();
      prisma.db.set('pipe-1', {
        id: 'pipe-1',
        tenantId: TENANT_ID,
        name: 'X',
        stages: [
          { key: DealStage.LEAD, label: 'Lead', defaultProbability: 10, isWon: false, isLost: false },
        ],
        isDefault: false,
        createdAt: new Date(),
      });
      const svc = new PipelinesService(prisma, makeAudit());
      const stages = await svc.getStagesForPipeline(TENANT_ID, 'pipe-1');
      expect(stages.length).toBe(1);
    });
  });
});