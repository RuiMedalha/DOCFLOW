import { NotFoundException } from '@nestjs/common';
import { DealStage } from '@prisma/client';
import { DEFAULT_STAGES, PipelinesService } from './pipelines.service';
import { DealsService } from './deals.service';

/**
 * Tests for DealsService — dealBoard + forecast + findOne.
 *
 * Pattern matches contacts/pipelines specs: in-memory doubles for Prisma,
 * stubs for the PipelinesService dependency, and assertions on the data
 * shape that the contract guarantees to callers.
 */

type DealRow = {
  id: string;
  tenantId: string;
  contactId: string;
  title: string;
  value: any; // Prisma Decimal in real life
  stage: DealStage;
  probability: number;
  expectedCloseDate: Date | null;
  pipelineId: string | null;
  createdAt: Date;
};

function makePrisma(dbDeals: DealRow[]) {
  // A side-table of contact names so the include-relation works.
  const dbContacts = new Map<string, { id: string; name: string }>();
  return {
    deal: {
      findMany: jest.fn(async ({ where }: any) => {
        const filtered = dbDeals.filter((d) => {
          if (d.tenantId !== where.tenantId) return false;
          if (where.pipelineId && d.pipelineId !== where.pipelineId) return false;
          if (where.stage?.not && d.stage === where.stage.not) return false;
          if (where.stage?.notIn && where.stage.notIn.includes(d.stage)) return false;
          return true;
        });
        // Attach contact relation when caller asked for include.contact.
        return filtered.map((d) => ({
          ...d,
          contact: dbContacts.get(d.contactId) ?? null,
        }));
      }),
      findFirst: jest.fn(async ({ where: { id, tenantId } }: any) => {
        const d = dbDeals.find((x) => x.id === id && x.tenantId === tenantId);
        if (!d) return null;
        return { ...d, contact: dbContacts.get(d.contactId) ?? null };
      }),
      count: jest.fn(async ({ where }: any) => {
        return dbDeals.filter((d) => {
          if (d.tenantId !== where.tenantId) return false;
          if (where.stage && d.stage !== where.stage) return false;
          return true;
        }).length;
      }),
    },
    _seedContact: (id: string, name: string) =>
      dbContacts.set(id, { id, name }),
  } as any;
}

function makePipelines(rows: Array<{ id: string; stages: unknown }> = []) {
  const map = new Map(rows.map((r) => [r.id, r]));
  return {
    getStagesForPipeline: jest.fn(async (_t: string, id: string) => {
      return (map.get(id)?.stages as any) ?? DEFAULT_STAGES;
    }),
  } as unknown as PipelinesService;
}

const TENANT_ID = 'tenant-1';

describe('DealsService', () => {
  describe('dealBoard()', () => {
    it('returns one column per canonical stage even when empty', async () => {
      const prisma = makePrisma([]);
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.dealBoard(TENANT_ID);
      // 6 canonical stages
      expect(out.columns.length).toBe(DEFAULT_STAGES.length);
      expect(out.totalCount).toBe(0);
      // Every column has count=0 and deals=[].
      for (const col of out.columns) {
        expect(col.count).toBe(0);
        expect(col.deals).toEqual([]);
        expect(col.weightedValue).toBe(0);
      }
    });

    it('groups deals by stage with weighted value', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Big deal',
          value: 1000,
          stage: DealStage.LEAD,
          probability: 20,
          expectedCloseDate: new Date('2026-09-15'),
          pipelineId: null,
          createdAt: new Date('2026-08-01'),
        },
        {
          id: 'd-2',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Mid',
          value: 500,
          stage: DealStage.LEAD,
          probability: 20,
          expectedCloseDate: new Date('2026-09-30'),
          pipelineId: null,
          createdAt: new Date('2026-08-15'),
        },
        {
          id: 'd-3',
          tenantId: TENANT_ID,
          contactId: 'c-2',
          title: 'Won!',
          value: 2500,
          stage: DealStage.WON,
          probability: 100,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date('2026-07-01'),
        },
      ];
      const prisma = makePrisma(deals);
      prisma._seedContact('c-1', 'EDP');
      prisma._seedContact('c-2', 'Galp');
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.dealBoard(TENANT_ID);
      const lead = out.columns.find((c) => c.stage === DealStage.LEAD)!;
      expect(lead.count).toBe(2);
      expect(lead.totalValue).toBe(1500);
      expect(lead.weightedValue).toBe(300); // 200 + 100
      // Sorted by value desc: d-1 first
      expect(lead.deals[0].id).toBe('d-1');
      expect(lead.deals[0].contactName).toBe('EDP');
    });

    it('hides LOST deals by default but includes them with includeLost=true', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-l',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Lost',
          value: 100,
          stage: DealStage.LOST,
          probability: 0,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
      ];
      const prisma = makePrisma(deals);
      const svc = new DealsService(prisma, makePipelines());
      const without = await svc.dealBoard(TENANT_ID);
      expect(without.totalCount).toBe(0);
      const withLost = await svc.dealBoard(TENANT_ID, { includeLost: true });
      expect(withLost.totalCount).toBe(1);
      const lostCol = withLost.columns.find((c) => c.stage === DealStage.LOST)!;
      expect(lostCol.count).toBe(1);
    });
  });

  describe('forecast()', () => {
    it('returns N horizon buckets with weightedValue = value * probability', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'In this month',
          value: 1000,
          stage: DealStage.PROPOSAL,
          probability: 50,
          expectedCloseDate: new Date(), // this month
          pipelineId: null,
          createdAt: new Date(),
        },
      ];
      const prisma = makePrisma(deals);
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.forecast(TENANT_ID);
      expect(out.buckets.length).toBe(6);
      const firstBucket = out.buckets[0];
      expect(firstBucket.count).toBe(1);
      expect(firstBucket.weightedValue).toBe(500);
      expect(out.openValue).toBe(1000);
      expect(out.openWeightedValue).toBe(500);
    });

    it('puts deals without an expectedCloseDate in the unassigned bucket', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'No date',
          value: 800,
          stage: DealStage.QUALIFIED,
          probability: 40,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
      ];
      const prisma = makePrisma(deals);
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.forecast(TENANT_ID);
      expect(out.unassigned.count).toBe(1);
      expect(out.unassigned.weightedValue).toBe(320);
    });

    it('computes a winRate from WON / (WON + LOST)', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Open',
          value: 100,
          stage: DealStage.LEAD,
          probability: 20,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
        {
          id: 'd-won-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Won A',
          value: 100,
          stage: DealStage.WON,
          probability: 100,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
        {
          id: 'd-won-2',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Won B',
          value: 100,
          stage: DealStage.WON,
          probability: 100,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
        {
          id: 'd-lost-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Lost',
          value: 100,
          stage: DealStage.LOST,
          probability: 0,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
      ];
      const prisma = makePrisma(deals);
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.forecast(TENANT_ID);
      // 2 WON + 1 LOST = winRate 2/3
      expect(out.winRate).toBeCloseTo(2 / 3, 2);
    });

    it('clamps horizonMonths to [1, 24]', async () => {
      const prisma = makePrisma([]);
      const svc = new DealsService(prisma, makePipelines());
      const tiny = await svc.forecast(TENANT_ID, { horizonMonths: 0 });
      expect(tiny.buckets.length).toBe(1);
      const big = await svc.forecast(TENANT_ID, { horizonMonths: 999 });
      expect(big.buckets.length).toBe(24);
    });
  });

  describe('findOne()', () => {
    it('returns the deal with contacts and activities included', async () => {
      const deals: DealRow[] = [
        {
          id: 'd-1',
          tenantId: TENANT_ID,
          contactId: 'c-1',
          title: 'Sample',
          value: 100,
          stage: DealStage.LEAD,
          probability: 20,
          expectedCloseDate: null,
          pipelineId: null,
          createdAt: new Date(),
        },
      ];
      // Use a richer findFirst that includes relations
      const prisma: any = {
        deal: {
          findFirst: jest.fn(async () => ({
            ...deals[0],
            value: 100,
            contact: { id: 'c-1', name: 'EDP', nif: null, email: null },
            activities: [],
          })),
        },
      };
      const svc = new DealsService(prisma, makePipelines());
      const out = await svc.findOne(TENANT_ID, 'd-1');
      expect(out.id).toBe('d-1');
      expect(out.contact.name).toBe('EDP');
    });

    it('throws 404 when the deal is missing', async () => {
      const prisma = makePrisma([]);
      const svc = new DealsService(prisma, makePipelines());
      await expect(svc.findOne(TENANT_ID, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});