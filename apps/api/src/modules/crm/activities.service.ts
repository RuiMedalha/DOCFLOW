import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ActivityQueryDto,
  CreateActivityDto,
  UpdateActivityDto,
} from './dto/activity.dto';

/**
 * ActivitiesService — activity log queries that benefit from being separate
 * from the big CrmService:
 *   - attach an activity to a deal (bulk move)
 *   - detach (link to contact only)
 *   - pending/overdue detection
 *
 * CrmService keeps the canonical CRUD (create / list / findOne / update /
 * complete / delete) so the existing endpoints and tests stay intact.
 */
@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /crm/activities/pending — activities that are still open
   * (completedAt is null) optionally filtered to those already overdue.
   */
  async pending(
    tenantId: string,
    opts: { onlyOverdue?: boolean; assignedToId?: string; limit?: number } = {},
  ) {
    const where: Prisma.ActivityWhereInput = {
      tenantId,
      completedAt: null,
    };
    if (opts.assignedToId) where.assignedToId = opts.assignedToId;
    if (opts.onlyOverdue) {
      where.dueDate = { lt: new Date() };
    } else {
      // Show only activities with a due date when not "overdue-only"; open
      // activities without a due date are noise in a "pending" view.
      where.dueDate = { not: null };
    }

    const activities = await this.prisma.activity.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: Math.min(opts.limit ?? 100, 500),
      include: {
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true, stage: true } },
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    return activities.map((a) => ({
      ...a,
      overdue: a.dueDate ? a.dueDate.getTime() < Date.now() : false,
      daysUntilDue: a.dueDate
        ? Math.ceil((a.dueDate.getTime() - Date.now()) / 86_400_000)
        : null,
    }));
  }

  /**
   * Attach an existing activity to a deal. Validates both belong to the
   * tenant. Idempotent: re-attaching to the same deal is a no-op.
   */
  async attachToDeal(
    tenantId: string,
    userId: string,
    activityId: string,
    dealId: string,
  ) {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, tenantId },
      select: { id: true, dealId: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId },
      select: { id: true },
    });
    if (!deal) throw new NotFoundException('Deal not found');

    if (activity.dealId === dealId) {
      return { activityId, dealId, attached: false };
    }

    await this.prisma.activity.update({
      where: { id: activityId },
      data: { dealId },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'activity',
      entityId: activityId,
      metadata: { operation: 'attachToDeal', dealId, previousDealId: activity.dealId },
    });

    return { activityId, dealId, attached: true };
  }

  /**
   * Detach an activity from its deal (sets dealId=null). The contact link
   * is preserved so the activity still shows under the contact timeline.
   */
  async detachFromDeal(
    tenantId: string,
    userId: string,
    activityId: string,
  ) {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, tenantId },
      select: { id: true, dealId: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    if (!activity.dealId) {
      return { activityId, detached: false };
    }
    const previousDealId = activity.dealId;

    await this.prisma.activity.update({
      where: { id: activityId },
      data: { dealId: null },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'activity',
      entityId: activityId,
      metadata: { operation: 'detachFromDeal', previousDealId },
    });

    return { activityId, detached: true };
  }

  /**
   * Bulk-complete a list of activity ids (e.g. "I finished my calls").
   * Rejects when the list is empty; returns counts so the UI can show
   * "X of Y completed" when some rows vanish.
   */
  async bulkComplete(
    tenantId: string,
    userId: string,
    activityIds: string[],
  ): Promise<{ requested: number; completed: number; missing: number }> {
    if (!activityIds.length) {
      throw new BadRequestException('activityIds must not be empty');
    }
    const unique = [...new Set(activityIds)];
    const result = await this.prisma.activity.updateMany({
      where: { id: { in: unique }, tenantId, completedAt: null },
      data: { completedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'activity_bulk',
      entityId: userId,
      metadata: { operation: 'bulkComplete', requested: unique.length, completed: result.count },
    });
    return {
      requested: unique.length,
      completed: result.count,
      missing: unique.length - result.count,
    };
  }

  // ─────────────────────────────────────────── helpers ────────────────────

  /** Re-exported for backwards compatibility with CrmService.createActivity callers. */
  async assertContactExists(tenantId: string, contactId: string): Promise<void> {
    const c = await this.prisma.crmContact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Contact not found');
  }

  async assertDealExists(tenantId: string, dealId: string): Promise<void> {
    const d = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Deal not found');
  }
}