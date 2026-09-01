import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DealStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreatePipelineDto,
  PipelineStageDto,
  UpdatePipelineDto,
} from './dto/pipeline.dto';

/**
 * Default stage table — mirrors HubSpot/Pipedrive and keeps the deal-board
 * predictable when a tenant hasn't customized their pipeline yet. The
 * `CrmService` has the same list; both stay in sync because the brief
 * expects probability resolution to live with the pipeline itself.
 */
export const DEFAULT_STAGES: PipelineStageDto[] = [
  { key: DealStage.LEAD,        label: 'Lead',        defaultProbability: 20, isWon: false, isLost: false },
  { key: DealStage.QUALIFIED,   label: 'Qualified',   defaultProbability: 40, isWon: false, isLost: false },
  { key: DealStage.PROPOSAL,    label: 'Proposal',    defaultProbability: 60, isWon: false, isLost: false },
  { key: DealStage.NEGOTIATION, label: 'Negotiation', defaultProbability: 80, isWon: false, isLost: false },
  { key: DealStage.WON,         label: 'Won',         defaultProbability: 100, isWon: true,  isLost: false },
  { key: DealStage.LOST,        label: 'Lost',        defaultProbability: 0,   isWon: false, isLost: true  },
];

/**
 * PipelinesService — ordered stages, probability resolution, default pipeline.
 *
 * Owns the pipeline area so the deal-board / forecasting logic in
 * DealsService and the stage moves in CrmService both pull from one
 * source of truth.
 */
@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** GET /crm/pipelines — list ordered by isDefault desc, then name. */
  async list(tenantId: string) {
    const rows = await this.prisma.crmPipeline.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.normalize(r));
  }

  /** GET /crm/pipelines/:id — detail. */
  async findOne(tenantId: string, id: string) {
    const row = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Pipeline not found');
    return this.normalize(row);
  }

  /** POST /crm/pipelines — create with stages; first-stage validation runs here. */
  async create(tenantId: string, userId: string, dto: CreatePipelineDto) {
    const sourceStages = dto.stages ?? [];
    // Empty list = "use all canonical defaults". Otherwise validate.
    const stages =
      sourceStages.length === 0
        ? DEFAULT_STAGES
        : (this.assertValidStages(sourceStages), this.fillMissingStages(sourceStages));
    const wantsDefault = dto.isDefault ?? false;

    const data = await this.prisma.$transaction(async (tx) => {
      if (wantsDefault) {
        await tx.crmPipeline.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.crmPipeline.create({
        data: {
          tenantId,
          name: dto.name,
          stages: stages as unknown as Prisma.InputJsonValue,
          isDefault: wantsDefault,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm_pipeline',
      entityId: data.id,
      metadata: { name: data.name, isDefault: data.isDefault, stages: stages.length },
    });
    return this.normalize(data);
  }

  /** PATCH /crm/pipelines/:id — partial. Replacing stages re-runs validation. */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdatePipelineDto,
  ): Promise<ReturnType<PipelinesService['normalize']>> {
    const existing = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Pipeline not found');

    let stages: PipelineStageDto[] | undefined;
    if (dto.stages && dto.stages.length > 0) {
      this.assertValidStages(dto.stages);
      stages = this.fillMissingStages(dto.stages);
    }

    const data = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.crmPipeline.updateMany({
          where: { tenantId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.crmPipeline.update({
        where: { id },
        data: {
          name: dto.name,
          stages: stages as unknown as Prisma.InputJsonValue,
          isDefault: dto.isDefault,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'crm_pipeline',
      entityId: id,
      metadata: {
        nameChanged: dto.name !== undefined && dto.name !== existing.name,
        stagesChanged: stages !== undefined,
        isDefaultChanged:
          dto.isDefault !== undefined && dto.isDefault !== existing.isDefault,
      },
    });
    return this.normalize(data);
  }

  /** DELETE /crm/pipelines/:id — refuses when deals still reference it. */
  async delete(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.crmPipeline.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Pipeline not found');

    const using = await this.prisma.deal.count({
      where: { tenantId, pipelineId: id },
    });
    if (using > 0) {
      throw new BadRequestException(
        `Pipeline in use by ${using} deal(s); delete or reassign them first.`,
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
    return { deleted: true, id };
  }

  /**
   * Resolve the probability for a given stage inside a pipeline definition.
   * Returns the explicit value when set; falls back to the canonical
   * default for the stage; ultimately falls back to 0 so a deal always
   * has a numeric probability even on unknown stages.
   */
  resolveProbability(
    stages: PipelineStageDto[] | null | undefined,
    stage: DealStage,
  ): number {
    if (stages) {
      const found = stages.find((s) => s.key === stage);
      if (found) return found.defaultProbability;
    }
    const def = DEFAULT_STAGES.find((s) => s.key === stage);
    return def?.defaultProbability ?? 0;
  }

  /**
   * Tenant default pipeline: returns the isDefault=true row when one
   * exists; otherwise creates one from DEFAULT_STAGES. Idempotent.
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
        name: 'Default',
        stages: DEFAULT_STAGES as unknown as Prisma.InputJsonValue,
        isDefault: true,
      },
      select: { id: true },
    });
    this.logger.log(`Created default pipeline for tenant ${tenantId}`);
    return created.id;
  }

  /** Stages accessor for the deal-board view. */
  async getStagesForPipeline(tenantId: string, pipelineId: string): Promise<PipelineStageDto[]> {
    const row = await this.prisma.crmPipeline.findFirst({
      where: { id: pipelineId, tenantId },
      select: { stages: true },
    });
    if (!row) return DEFAULT_STAGES;
    const stages = row.stages as unknown as PipelineStageDto[];
    if (!Array.isArray(stages) || stages.length === 0) return DEFAULT_STAGES;
    return stages;
  }

  // ─────────────────────────────────────────── helpers ────────────────────

  /** Reject obviously broken stage definitions before persistence. */
  private assertValidStages(stages: PipelineStageDto[]): void {
    if (stages.length === 0) {
      throw new BadRequestException('At least one stage required');
    }
    const seen = new Set<DealStage>();
    let hasWon = false;
    let hasLost = false;
    for (const s of stages) {
      if (!s.key) throw new BadRequestException('Stage.key is required');
      if (seen.has(s.key)) {
        throw new BadRequestException(`Duplicate stage key: ${s.key}`);
      }
      seen.add(s.key);
      if (s.defaultProbability < 0 || s.defaultProbability > 100) {
        throw new BadRequestException(
          `Stage ${s.key} probability must be 0..100`,
        );
      }
      if (s.isWon) hasWon = true;
      if (s.isLost) hasLost = true;
    }
    if (!hasWon) {
      throw new BadRequestException('Pipeline must contain a WON stage');
    }
    if (!hasLost) {
      throw new BadRequestException('Pipeline must contain a LOST stage');
    }
  }

  /**
   * Add any missing canonical stages so the deal board always has a place
   * to put a deal. Original stages keep their order; missing ones are
   * appended in canonical order.
   */
  private fillMissingStages(stages: PipelineStageDto[]): PipelineStageDto[] {
    const have = new Set(stages.map((s) => s.key));
    const result = [...stages];
    for (const def of DEFAULT_STAGES) {
      if (!have.has(def.key)) result.push(def);
    }
    return result;
  }

  private normalize(row: {
    id: string;
    tenantId: string;
    name: string;
    stages: unknown;
    isDefault: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      isDefault: row.isDefault,
      stages: (row.stages as PipelineStageDto[]) ?? [],
      createdAt: row.createdAt,
    };
  }
}