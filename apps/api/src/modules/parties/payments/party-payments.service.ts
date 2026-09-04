import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * PartyPaymentsService — read-only `GET /parties/:id/payments`.
 *
 * PaymentEvent has no `partyId` direct FK — it points to `Document`,
 * which has `partyId`. The list query JOINs through the document:
 *
 *     prisma.paymentEvent.findMany({
 *       where: {
 *         document: { partyId, tenantId },
 *         tenantId,
 *       },
 *       include: { document: { select: { id, docNumber, fileKey } } }
 *     })
 *
 * Cursor pagination uses the row id (not a timestamp) because two
 * events on the same invoice can have identical `dueDate`s — and even
 * with distinct dates, composite `[dueDate, id]` is overkill for the
 * scale (≤ 50 events per fetch). The UI scrolls by page of 20.
 */
@Injectable()
export class PartyPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /parties/:partyId/payments?cursor=&limit=20
   *
   * The cursor is the LAST returned row's id (cuid). Subsequent pages
   * use `cursor: { id }` + `skip: 1`. We cap `limit` at 50 and clamp
   * bad input to a safe default.
   */
  async list(
    tenantId: string,
    partyId: string,
    cursor?: string,
    limit = 20,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const events = await this.prisma.paymentEvent.findMany({
      where: {
        tenantId,
        document: { partyId, tenantId },
      },
      include: {
        document: {
          select: { id: true, docNumber: true, fileKey: true },
        },
      },
      orderBy: [{ dueDate: 'desc' }, { id: 'desc' }],
      take: safeLimit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const items = events.map((e) => ({
      id: e.id,
      documentId: e.documentId,
      document: e.document,
      dueDate: e.dueDate,
      amount: e.amount?.toString() ?? null,
      status: e.status,
      paidAt: e.paidAt,
      paidAmount: e.paidAmount?.toString() ?? null,
      paymentMethod: e.paymentMethod,
      notes: e.notes,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));

    const nextCursor =
      events.length === safeLimit ? events[events.length - 1].id : null;

    return { items, nextCursor };
  }
}
