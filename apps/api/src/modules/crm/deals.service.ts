import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DealStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PipelineStageDto } from './dto/pipeline.dto';
import { DEFAULT_STAGES, PipelinesService } from './pipelines.service';

/**
 * Deal-board row: a stage with the deals parked there, sorted by value desc
 * so the biggest fish float to the top of the column.
 */
export interface DealBoardColumn {
  stage: DealStage;
  label: string;
  probability: number;
  count: number;
  totalValue: number;
  weightedValue: number;
  deals: Array<{
    id: string;
    title: string;
    contactId: string;
    contactName: string | null;
    value: number;
    probability: number;
    expectedCloseDate: string | null;
    pipelineId: string | null;
    createdAt: string;
  }>;
}

/**
 * Forecast bucket — sum of weighted values per month. `weightedValue` is the
 * amount we expect to win this month given each deal's probability. Deals
 * without an expectedCloseDate land in `unassigned`.
 */
export interface ForecastBucket {
  month: string; // YYYY-MM
  count: number;
  totalValue: number;
  weightedValue: number;
}

/**
 * DealsService — read-heavy views on the Deal table:
 *   - deal board (kanban view, grouped by stage)
 *   - forecast (weighted value per month, with win-rate estimate)
 *
 * The CrmService keeps the write path so the existing API surface stays
 * green. This service layers read models on top.
 */
@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}

  /**
   * GET /crm/deals/board — Kanban-style view.
   *
   * Always returns all canonical stages (even empty ones) so the UI doesn't
   * have to materialize the column set itself. When a pipeline is provided
   * the column ordering follows the pipeline's stage list; otherwise the
   * canonical default order is used.
   */
  async dealBoard(
    tenantId: string,
    opts: { pipelineId?: string; includeLost?: boolean } = {},
  ): Promise<{ columns: DealBoardColumn[]; totalCount: number }> {
    const stages = opts.pipelineId
      ? await this.pipelines.getStagesForPipeline(tenantId, opts.pipelineId)
      : null;

    const order = (stages ?? []) as PipelineStageDto[];

    const where: Prisma.DealWhereInput = { tenantId };
    if (opts.pipelineId) where.pipelineId = opts.pipelineId;
    if (!opts.includeLost) where.stage = { not: DealStage.LOST };

    const deals = await this.prisma.deal.findMany({
      where,
      orderBy: [{ value: 'desc' }, { createdAt: 'desc' }],
      include: {
        contact: { select: { id: true, name: true } },
      },
    });

    const bucket = new Map<DealStage, DealBoardColumn>();
    for (const s of order) {
      bucket.set(s.key, this.emptyColumn(s));
    }
    // Always include the canonical stages so the UI gets a stable set.
    for (const s of DEFAULT_STAGES) {
      // The convention from the brief is to expose all stages; only create
      // if not already present from a custom pipeline.
      if (!bucket.has(s.key)) bucket.set(s.key, this.emptyColumn(s));
    }

    for (const d of deals) {
      const col =
        bucket.get(d.stage) ??
        bucket.set(d.stage, this.emptyColumn({
          key: d.stage,
          label: d.stage,
          defaultProbability: d.probability,
          isWon: d.stage === DealStage.WON,
          isLost: d.stage === DealStage.LOST,
        } as PipelineStageDto)).get(d.stage)!;

      col.count += 1;
      col.totalValue += Number(d.value);
      col.weightedValue += Number(d.value) * (d.probability / 100);
      col.deals.push({
        id: d.id,
        title: d.title,
        contactId: d.contactId,
        contactName: d.contact?.name ?? null,
        value: Number(d.value),
        probability: d.probability,
        expectedCloseDate: d.expectedCloseDate
          ? d.expectedCloseDate.toISOString()
          : null,
        pipelineId: d.pipelineId,
        createdAt: d.createdAt.toISOString(),
      });
    }

    // Stable column order: pipeline order if available, else canonical.
    const orderedColumns = order.length
      ? order.map((s) => bucket.get(s.key)!).filter(Boolean)
      : Array.from(bucket.values());

    return { columns: orderedColumns, totalCount: deals.length };
  }

  /**
   * GET /crm/deals/forecast — monthly weighted-value forecast.
   *
   * For each month from now to `horizonMonths`, sum the weighted value of
   * open deals whose expectedCloseDate falls in that month. Open deals
   * missing an expectedCloseDate land in `unassigned` so the totals still
   * reconcile with the pipeline stats.
   */
  async forecast(
    tenantId: string,
    opts: { horizonMonths?: number; pipelineId?: string } = {},
  ): Promise<{
    horizonMonths: number;
    buckets: ForecastBucket[];
    unassigned: ForecastBucket;
    openValue: number;
    openWeightedValue: number;
    winRate: number;
  }> {
    const horizon = Math.max(1, Math.min(opts.horizonMonths ?? 6, 24));
    const where: Prisma.DealWhereInput = {
      tenantId,
      stage: { notIn: [DealStage.WON, DealStage.LOST] },
    };
    if (opts.pipelineId) where.pipelineId = opts.pipelineId;

    const openDeals = await this.prisma.deal.findMany({
      where,
      select: {
        value: true,
        probability: true,
        expectedCloseDate: true,
      },
    });

    const [wonCount, lostCount] = await Promise.all([
      this.prisma.deal.count({ where: { tenantId, stage: DealStage.WON } }),
      this.prisma.deal.count({ where: { tenantId, stage: DealStage.LOST } }),
    ]);
    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? wonCount / totalClosed : 0;

    const now = new Date();
    const buckets: ForecastBucket[] = [];
    const bucketMap = new Map<string, ForecastBucket>();
    for (let i = 0; i < horizon; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = this.monthKey(d);
      const b: ForecastBucket = {
        month: key,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
      };
      buckets.push(b);
      bucketMap.set(key, b);
    }
    const unassigned: ForecastBucket = {
      month: 'unassigned',
      count: 0,
      totalValue: 0,
      weightedValue: 0,
    };

    let openValue = 0;
    let openWeightedValue = 0;

    for (const d of openDeals) {
      const v = Number(d.value);
      const w = v * (d.probability / 100);
      openValue += v;
      openWeightedValue += w;
      if (!d.expectedCloseDate) {
        unassigned.count += 1;
        unassigned.totalValue += v;
        unassigned.weightedValue += w;
        continue;
      }
      const key = this.monthKey(d.expectedCloseDate);
      const b = bucketMap.get(key);
      if (b) {
        b.count += 1;
        b.totalValue += v;
        b.weightedValue += w;
      } else {
        // Past-dated or beyond horizon — keep but don't drop.
        unassigned.count += 1;
        unassigned.totalValue += v;
        unassigned.weightedValue += w;
      }
    }

    return {
      horizonMonths: horizon,
      buckets,
      unassigned,
      openValue,
      openWeightedValue,
      winRate: Number(winRate.toFixed(4)),
    };
  }

  /** GET /crm/deals/:id with full context (used as a "detail" lookup). */
  async findOne(tenantId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId },
      include: {
        contact: { select: { id: true, name: true, nif: true, email: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            createdBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return {
      ...deal,
      value: Number(deal.value),
    };
  }

  // ─────────────────────────────────────────── helpers ────────────────────

  private emptyColumn(stage: PipelineStageDto): DealBoardColumn {
    return {
      stage: stage.key,
      label: stage.label,
      probability: stage.defaultProbability,
      count: 0,
      totalValue: 0,
      weightedValue: 0,
      deals: [],
    };
  }

  private monthKey(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
  }
}