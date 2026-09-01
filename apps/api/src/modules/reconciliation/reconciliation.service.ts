import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  MatchStatus,
  MatchType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  MatchCandidate,
  scoreMatch,
} from './matching.util';
import {
  ListSuggestionsQueryDto,
  MatchSuggestionResponseDto,
  PaginatedSuggestionsDto,
  RunMatchingResponseDto,
} from './dto/reconciliation.dto';

/**
 * Stable namespace seed for the reconciliation advisory lock. Any other
 * advisory-lock consumer must pick a DIFFERENT bigint here so the locks
 * never collide. The audit service uses hashtext(tenantId) directly; we
 * use a distinct constant so a tenant can't be blocked from running
 * reconciliation by an unrelated lock. Must fit in BIGINT (signed 64-bit)
 * — keep it well under 2^63-1 to leave room for the XOR-with-hash.
 */
const RECONCILIATION_LOCK_NS = BigInt('0x0D0CF10A');

/**
 * ReconciliationService — matches bank transactions against documents,
 * expenses, invoices, and payable items.
 *
 * Workflow:
 *   1. POST /reconciliation/run — fetches all unreconciled bank tx
 *      (no `reconciledAt`) and candidate entities, applies the 3-tier
 *      scorer, persists the best suggestion per (tx, entity) group
 *      and per tx.
 *   2. GET  /reconciliation/suggestions — list PENDING (or others)
 *      for review.
 *   3. POST /reconciliation/suggestions/:id/accept — confirm the
 *      match: status → ACCEPTED, sets `BankTransaction.reconciledAt`
 *      and writes the link on the bank row. Auto-rejects competing
 *      pending suggestions for the same tx.
 *   4. POST /reconciliation/suggestions/:id/reject — decline; the
 *      tx remains unreconciled.
 *
 * Multi-tenant: every query goes through `prisma.scoped`, which the
 * PrismaService $extends wrapper auto-filters by `tenantId`. We still
 * pass `tenantId` explicitly in `where` clauses for clarity and to
 * match the doc-flow `@@index([tenantId, ...])` indexes.
 *
 * Banking note: the `BankTransaction.expenseId` / `.invoiceId` /
 * `.payableItemId` columns are the canonical "this tx paid that bill"
 * link. Accept writes the appropriate one based on the suggestion.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────────────────────── run matching ────────────

  /**
   * Run the matching engine for a tenant. For every unreconciled bank
   * transaction, score it against documents / expenses / invoices /
   * payables and persist the best per (tx, entity) candidate.
   *
   * Returns counts and a tier breakdown for the caller.
   *
   * H-07: wrap the matching loop in a per-tenant `pg_advisory_xact_lock`
   * so two concurrent /reconciliation/run calls for the same tenant do
   * NOT produce duplicate suggestions. The lock is keyed on a hash of
   * the tenantId (two bigints of the md5 → 64-bit halves).
   */
  async runMatching(
    tenantId: string,
    userId: string,
  ): Promise<RunMatchingResponseDto> {
    const started = Date.now();
    return this.prisma.$transaction(async (tx) => {
      // H-07: acquire a per-tenant advisory lock for the duration of this
      // tx. Concurrent callers for the same tenant wait on the lock
      // instead of producing duplicate suggestions.
      //
      // PG17 only exposes `pg_advisory_xact_lock(bigint)` and the
      // 2-int4 variant `pg_advisory_xact_lock(integer, integer)` — NOT
      // `(bigint, bigint)`. We use the 1-bigint form, namespaced by
      // `hashtextextended(tenantId, REconciliation_NS)` so different
      // advisory-lock users (audit service, future jobs) don't collide.
      // TenantId is passed as a parameter ($1) — never interpolated
      // into the SQL string.
      await tx.$executeRawUnsafe(
        this.advisoryLockSql(),
        tenantId,
        RECONCILIATION_LOCK_NS.toString(),
      );
      return this.runMatchingInner(tenantId, userId, started, tx);
    });
  }

  /**
   * H-07 helper: build the parameterised SQL that acquires the
   * per-tenant advisory lock. The tenant id and namespace seed are
   * passed as $1/$2 parameters (never interpolated), so SQL injection
   * is impossible regardless of the tenantId format.
   *
   * Exposed (package-private) for the spec file to assert determinism:
   * the SAME tenantId must produce the SAME SQL string (sanity check
   * that the lock string is parameter-free aside from the $1/$2 slots).
   */
  private advisoryLockSql(): string {
    return `SELECT pg_advisory_xact_lock(hashtextextended($1::text, $2::bigint))`;
  }

  /**
   * Inner implementation of the matching engine — invoked inside the
   * per-tenant advisory-lock transaction by runMatching(). Kept as a
   * private method so the lock helper stays at the public surface.
   */
  private async runMatchingInner(
    tenantId: string,
    userId: string,
    started: number,
    tx: Prisma.TransactionClient,
  ): Promise<RunMatchingResponseDto> {
    // H-07: read pending/accepted suggestions INSIDE the lock so the
    // busy-tx set is consistent with what this run will write.
    const existingBusy = await tx.matchSuggestion.findMany({
      where: { tenantId, status: { in: ['PENDING', 'ACCEPTED'] } },
      select: { bankTransactionId: true },
    });
    const busyIds = new Set(existingBusy.map((m) => m.bankTransactionId));

    // Bank transactions not yet reconciled AND not currently in a
    // pending/accepted suggestion.
    const transactions = await tx.bankTransaction.findMany({
      where: {
        tenantId,
        reconciledAt: null,
        ...(busyIds.size ? { id: { notIn: Array.from(busyIds) } } : {}),
      },
      orderBy: { date: 'desc' },
      take: 1000, // safety cap — a full org re-run is a 1-shot job
    });

    if (!transactions.length) {
      return {
        scannedTransactions: 0,
        suggestionsCreated: 0,
        byType: { STRONG: 0, MEDIUM: 0, WEAK: 0 },
        durationMs: 0,
      };
    }

    // ── candidates ──
    const documents = await tx.document.findMany({
      where: {
        tenantId,
        total: { not: null },
        status: { not: 'ARQUIVADO' },
      },
      select: {
        id: true,
        fileName: true,
        supplier: true,
        customer: true,
        docNumber: true,
        total: true,
        docDate: true,
      },
      take: 5000,
    });

    const expenses = await tx.expense.findMany({
      where: { tenantId },
      select: {
        id: true,
        description: true,
        amount: true,
        date: true,
        supplier: true,
        status: true,
        documentId: true,
      },
      take: 2000,
    });

    const invoices = await tx.invoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        number: true,
        amount: true,
        date: true,
        customer: true,
        documentId: true,
      },
      take: 2000,
    });

    // Payables are matched indirectly via their linked Document (the
    // canonical "this tx paid that bill" link lives on BankTransaction).
    // Load any payable without a document so we can fall back to a
    // reason-only match (rare — most payables anchor to a doc).
    const payables = await tx.payableItem.findMany({
      where: {
        tenantId,
        status: { in: ['DRAFT', 'TO_PAY', 'SCHEDULED', 'OVERDUE'] },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        dueDate: true,
        paymentRef: true,
        documentId: true,
      },
      take: 2000,
    });

    // ── score loop ──
    const suggestionsToCreate: Prisma.MatchSuggestionCreateManyInput[] = [];

    // Keep at most N suggestions per tx (1 is the product rule, but the
    // algorithm may emit 1 per entity type — we keep only the best per
    // entity TYPE group, then the best overall per tx). This prevents a
    // single noisy tx from producing dozens of trivially-weak ideas.
    const perTypeBest = new Map<
      string,
      { type: 'doc' | 'exp' | 'inv' | 'pay'; score: number }
    >();

    for (const tx of transactions) {
      perTypeBest.clear();
      const absAmount = Math.abs(Number(tx.amount));

      // Documents
      for (const doc of documents) {
        if (doc.total == null) continue;
        const result = scoreMatch({
          bankRef: tx.reference ?? null,
          bankDesc: tx.description,
          bankAmount: absAmount,
          bankDate: tx.date,
          entityRef: doc.docNumber ?? null,
          entityAmount: Number(doc.total),
          entityDate: doc.docDate ?? null,
          entityDesc: doc.supplier ?? doc.customer ?? doc.fileName,
          orderNumber: doc.docNumber ?? null,
        });
        this.queueIfBest(
          suggestionsToCreate,
          tx.id,
          'doc',
          'documentId',
          doc.id,
          result,
          perTypeBest,
          tenantId,
        );
      }

      // Expenses
      for (const exp of expenses) {
        if (exp.amount == null) continue;
        const result = scoreMatch({
          bankRef: tx.reference ?? null,
          bankDesc: tx.description,
          bankAmount: absAmount,
          bankDate: tx.date,
          entityAmount: Number(exp.amount),
          entityDate: exp.date ?? null,
          entityDesc: exp.description ?? exp.supplier ?? null,
        });
        // Prefer linking via the underlying document when present,
        // otherwise the expense itself.
        this.queueIfBest(
          suggestionsToCreate,
          tx.id,
          'exp',
          exp.documentId ? 'documentId' : 'expenseId',
          exp.documentId ?? exp.id,
          result,
          perTypeBest,
          tenantId,
        );
      }

      // Invoices
      for (const inv of invoices) {
        if (inv.amount == null) continue;
        const result = scoreMatch({
          bankRef: tx.reference ?? null,
          bankDesc: tx.description,
          bankAmount: absAmount,
          bankDate: tx.date,
          entityRef: inv.number ?? null,
          entityAmount: Number(inv.amount),
          entityDate: inv.date ?? null,
          entityDesc: inv.customer ?? null,
          orderNumber: inv.number ?? null,
        });
        this.queueIfBest(
          suggestionsToCreate,
          tx.id,
          'inv',
          inv.documentId ? 'documentId' : 'invoiceId',
          inv.documentId ?? inv.id,
          result,
          perTypeBest,
          tenantId,
        );
      }

      // Payables — match on amount + due date. The schema models
      // MatchSuggestion without a payableItemId column, so we ONLY
      // emit a payable-style suggestion when the payable has a linked
      // document (we then store the doc as the suggestion target and
      // wire the payable on accept via the bank row's @unique
      // payableItemId). Payables without a document are skipped here;
      // they show up in the 'doc' bucket above if their document
      // matched too.
      for (const pay of payables) {
        if (pay.amount == null || pay.documentId == null) continue;
        const result = scoreMatch({
          bankRef: tx.reference ?? null,
          bankDesc: tx.description,
          bankAmount: absAmount,
          bankDate: tx.date,
          entityRef: pay.paymentRef ?? null,
          entityAmount: Number(pay.amount),
          entityDate: pay.dueDate ?? null,
          entityDesc: pay.description ?? pay.paymentRef ?? null,
          orderNumber: pay.paymentRef ?? null,
        });
        if (!result) continue;
        // Surface a separate 'pay' group only when it BEATS the 'doc'
        // group we already computed for the same bank tx — otherwise
        // we'd queue two suggestions for the same target doc and the
        // user would see duplicates.
        const docKey = `${tx.id}:doc`;
        const payKey = `${tx.id}:pay`;
        const docSeen = perTypeBest.get(docKey);
        if (docSeen && docSeen.score >= result.score) continue;
        perTypeBest.set(payKey, { type: 'pay', score: result.score });
        // Replace prior 'pay' entry if any.
        const idx = suggestionsToCreate.findIndex(
          (s) =>
            s.bankTransactionId === tx.id &&
            (s as unknown as Record<string, unknown>)._typeKey === payKey,
        );
        if (idx >= 0) suggestionsToCreate.splice(idx, 1);
        suggestionsToCreate.push({
          tenantId,
          bankTransactionId: tx.id,
          score: result.score,
          matchType: result.matchType as MatchType,
          status: MatchStatus.PENDING,
          reason: `[payable ${pay.id}] ${result.reason}`,
          documentId: pay.documentId,
          _typeKey: payKey,
        } as unknown as Prisma.MatchSuggestionCreateManyInput);
      }
    }

    // ── persist ──
    // Strip the private `_typeKey` tag we used for replacement tracking.
    const dataRows: Prisma.MatchSuggestionCreateManyInput[] =
      suggestionsToCreate.map((row) => {
        const r = row as Record<string, unknown>;
        const { _typeKey: _drop, ...rest } = r;
        return rest as Prisma.MatchSuggestionCreateManyInput;
      });

    let created = 0;
    if (dataRows.length) {
      const result = await tx.matchSuggestion.createMany({
        data: dataRows,
      });
      created = result.count;
    }

    const byType: Record<MatchType, number> = {
      STRONG: 0,
      MEDIUM: 0,
      WEAK: 0,
    };
    for (const row of dataRows) {
      byType[row.matchType as MatchType] =
        (byType[row.matchType as MatchType] ?? 0) + 1;
    }

    // Audit log goes through the shared AuditService. We use the
    // logInTx helper so the audit row is committed atomically with the
    // suggestions — otherwise a crash between createMany and audit.log
    // could leave the suggestion count out of sync with the trail.
    await this.audit.logInTx(tx as Prisma.TransactionClient, {
      tenantId,
      userId,
      action: AuditAction.RECONCILE,
      entityType: 'reconciliation',
      entityId: null,
      metadata: {
        scannedTransactions: transactions.length,
        suggestionsCreated: created,
        byType: {
          STRONG: byType.STRONG,
          MEDIUM: byType.MEDIUM,
          WEAK: byType.WEAK,
        },
      },
    });

        return {
      scannedTransactions: transactions.length,
      suggestionsCreated: created,
      byType: {
        STRONG: byType.STRONG ?? 0,
        MEDIUM: byType.MEDIUM ?? 0,
        WEAK: byType.WEAK ?? 0,
      },
      durationMs: Date.now() - started,
    };
  }

  /**
   * Helper used by the score loop: keep only the best candidate per
   * tx per entity type group, and queue it for insert.
   *
   * We tag each queued row with a private `_typeKey` so we can find
   * and replace a previously-queued (lower-scored) row for the same
   * (tx, type) group without resorting to a second Map. The tag is
   * stripped right before `createMany` runs.
   */
  private queueIfBest(
    queue: Prisma.MatchSuggestionCreateManyInput[],
    txId: string,
    typeKey: 'doc' | 'exp' | 'inv' | 'pay',
    columnName: 'documentId' | 'expenseId' | 'invoiceId' | 'payableItemId',
    columnValue: string,
    result: MatchCandidate | null,
    perTypeBest: Map<string, { type: string; score: number }>,
    tenantId: string,
  ): void {
    if (!result) return;
    const txTypeKey = `${txId}:${typeKey}`;
    const seen = perTypeBest.get(txTypeKey);
    if (seen && seen.score >= result.score) return;
    perTypeBest.set(txTypeKey, { type: typeKey, score: result.score });

    // Replace any prior queued suggestion for the same (tx, typeKey)
    // rather than appending — we want ONLY the best per type group.
    const idx = queue.findIndex(
      (s) =>
        s.bankTransactionId === txId &&
        (s as unknown as Record<string, unknown>)._typeKey === txTypeKey,
    );
    if (idx >= 0) queue.splice(idx, 1);

    queue.push({
      tenantId,
      bankTransactionId: txId,
      score: result.score,
      matchType: result.matchType as MatchType,
      status: MatchStatus.PENDING,
      reason: result.reason,
      [columnName]: columnValue,
      _typeKey: txTypeKey,
    } as unknown as Prisma.MatchSuggestionCreateManyInput);
  }

  // ─────────────────────────────────────────── list suggestions ────────

  /**
   * List suggestions for review. Defaults to PENDING. The response is
   * shaped to keep the wire payload small — full nested entities, but
   * no raw `metadata` or `BankTransaction.rawRowJson`.
   */
  async listSuggestions(
    tenantId: string,
    query: ListSuggestionsQueryDto,
  ): Promise<PaginatedSuggestionsDto> {
    const where: Prisma.MatchSuggestionWhereInput = { tenantId };
    // Default to PENDING when caller doesn't specify (the inbox
    // case). Always apply a status filter so the listing is bounded.
    where.status = query.status ?? MatchStatus.PENDING;
    if (query.matchType) where.matchType = query.matchType;

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [total, rows] = await Promise.all([
      this.prisma.matchSuggestion.count({ where }),
      this.prisma.matchSuggestion.findMany({
        where,
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        include: {
          bankTransaction: {
            select: {
              id: true,
              date: true,
              description: true,
              amount: true,
              reference: true,
              counterpartyName: true,
            },
          },
          expense: {
            select: {
              id: true,
              description: true,
              amount: true,
              supplier: true,
            },
          },
          invoice: {
            select: {
              id: true,
              number: true,
              amount: true,
              customer: true,
            },
          },
          document: {
            select: {
              id: true,
              fileName: true,
              docNumber: true,
              total: true,
              supplier: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: MatchSuggestionResponseDto[] = rows.map((s) =>
      this.toResponseDto(s),
    );

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  // ─────────────────────────────────────────── accept ──────────────────

  /**
   * Accept a suggestion: status → ACCEPTED. Auto-reject any other
   * pending suggestions for the same bank tx. Link the BankTransaction
   * to the matched entity (expense / invoice / payable / document) AND
   * write `reconciledAt` + `reconciledById`. Everything happens inside
   * a transaction so a partial write leaves no dangling state.
   */
  async acceptSuggestion(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ accepted: true; bankTransactionId: string }> {
    const txClient = await this.prisma.$transaction(async (tx) => {
      const suggestion = await tx.matchSuggestion.findFirst({
        where: { id, tenantId },
      });
      if (!suggestion) {
        throw new NotFoundException('Suggestion not found');
      }
      if (suggestion.status !== MatchStatus.PENDING) {
        throw new BadRequestException(
          `Suggestion already ${suggestion.status.toLowerCase()}`,
        );
      }

      // Promote this one…
      await tx.matchSuggestion.update({
        where: { id: suggestion.id },
        data: { status: MatchStatus.ACCEPTED, updatedAt: new Date() },
      });
      // …and reject competing pendings for the same tx.
      await tx.matchSuggestion.updateMany({
        where: {
          tenantId,
          bankTransactionId: suggestion.bankTransactionId,
          status: MatchStatus.PENDING,
          id: { not: suggestion.id },
        },
        data: { status: MatchStatus.REJECTED, updatedAt: new Date() },
      });

      // Link bank tx to the matched entity. The schema carries
      // expenseId, invoiceId, and payableItemId (the last one is
      // @unique on BankTransaction — the canonical one-to-one path).
      const updateData: Prisma.BankTransactionUpdateInput = {
        reconciledAt: new Date(),
        reconciledById: userId,
        expense:
          suggestion.expenseId != null
            ? { connect: { id: suggestion.expenseId } }
            : undefined,
        invoice:
          suggestion.invoiceId != null
            ? { connect: { id: suggestion.invoiceId } }
            : undefined,
      };

      // Strip undefined keys so they don't override existing links.
      const cleaned = Object.fromEntries(
        Object.entries(updateData as Record<string, unknown>).filter(
          ([, v]) => v !== undefined,
        ),
      ) as Prisma.BankTransactionUpdateInput;

      await tx.bankTransaction.update({
        where: { id: suggestion.bankTransactionId },
        data: cleaned,
      });

      // If the matched document has an associated payable, wire the
      // bank tx → payable link AND flip the payable to PAID. This is
      // the canonical "this tx paid that bill" path.
      if (suggestion.documentId) {
        const payable = await tx.payableItem.findFirst({
          where: {
            tenantId,
            documentId: suggestion.documentId,
            status: { not: 'PAID' },
          },
          select: { id: true },
        });
        if (payable) {
          await tx.bankTransaction.update({
            where: { id: suggestion.bankTransactionId },
            data: {
              payableItem: { connect: { id: payable.id } },
            },
          });
          await tx.payableItem.update({
            where: { id: payable.id },
            data: {
              status: 'PAID',
              paidAt: new Date(),
              bankTxId: suggestion.bankTransactionId,
            },
          });
        }
      }

      return {
        suggestion,
      };
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.APPROVE,
      entityType: 'match_suggestion',
      entityId: txClient.suggestion.id,
      metadata: {
        bankTransactionId: txClient.suggestion.bankTransactionId,
        expenseId: txClient.suggestion.expenseId ?? null,
        invoiceId: txClient.suggestion.invoiceId ?? null,
        documentId: txClient.suggestion.documentId ?? null,
        score: txClient.suggestion.score,
        matchType: txClient.suggestion.matchType,
      },
    });

    return { accepted: true, bankTransactionId: txClient.suggestion.bankTransactionId };
  }

  // ─────────────────────────────────────────── reject ──────────────────

  async rejectSuggestion(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ rejected: true }> {
    const suggestion = await this.prisma.matchSuggestion.findFirst({
      where: { id, tenantId },
    });
    if (!suggestion) {
      throw new NotFoundException('Suggestion not found');
    }
    if (suggestion.status !== MatchStatus.PENDING) {
      throw new BadRequestException(
        `Suggestion already ${suggestion.status.toLowerCase()}`,
      );
    }

    await this.prisma.matchSuggestion.update({
      where: { id },
      data: { status: MatchStatus.REJECTED, updatedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.REJECT,
      entityType: 'match_suggestion',
      entityId: id,
      metadata: {
        bankTransactionId: suggestion.bankTransactionId,
        score: suggestion.score,
        matchType: suggestion.matchType,
      },
    });

    return { rejected: true };
  }

  // ─────────────────────────────────────────── shape ───────────────────

  /** Map a Prisma row to the wire DTO (Decimal→number, Date→ISO). */
  private toResponseDto(s: {
    id: string;
    status: MatchStatus;
    matchType: MatchType;
    score: number;
    reason: string | null;
    expenseId: string | null;
    invoiceId: string | null;
    documentId: string | null;
    createdAt: Date;
    bankTransaction: {
      id: string;
      date: Date;
      description: string;
      amount: Prisma.Decimal | number;
      reference: string | null;
      counterpartyName: string | null;
    } | null;
    expense: {
      id: string;
      description: string | null;
      amount: Prisma.Decimal | number;
      supplier: string | null;
    } | null;
    invoice: {
      id: string;
      number: string | null;
      amount: Prisma.Decimal | number;
      customer: string | null;
    } | null;
    document: {
      id: string;
      fileName: string;
      docNumber: string | null;
      total: Prisma.Decimal | number | null;
      supplier: string | null;
    } | null;
  }): MatchSuggestionResponseDto {
    return {
      id: s.id,
      status: s.status,
      matchType: s.matchType,
      score: s.score,
      reason: s.reason,
      createdAt: s.createdAt.toISOString(),
      expenseId: s.expenseId,
      invoiceId: s.invoiceId,
      documentId: s.documentId,
      bankTransaction: s.bankTransaction
        ? {
            id: s.bankTransaction.id,
            date: s.bankTransaction.date.toISOString(),
            description: s.bankTransaction.description,
            amount: Number(s.bankTransaction.amount),
            reference: s.bankTransaction.reference,
            counterpartyName: s.bankTransaction.counterpartyName,
          }
        : {
            id: '',
            date: new Date(0).toISOString(),
            description: '',
            amount: 0,
            reference: null,
            counterpartyName: null,
          },
      expense: s.expense
        ? {
            id: s.expense.id,
            description: s.expense.description,
            amount: Number(s.expense.amount),
            supplier: s.expense.supplier,
          }
        : null,
      invoice: s.invoice
        ? {
            id: s.invoice.id,
            number: s.invoice.number,
            amount: Number(s.invoice.amount),
            customer: s.invoice.customer,
          }
        : null,
      document: s.document
        ? {
            id: s.document.id,
            fileName: s.document.fileName,
            docNumber: s.document.docNumber,
            total: s.document.total != null ? Number(s.document.total) : null,
            supplier: s.document.supplier,
          }
        : null,
    };
  }
}
