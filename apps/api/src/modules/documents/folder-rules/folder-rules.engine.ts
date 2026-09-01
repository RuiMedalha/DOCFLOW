import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPatternContext,
  decideFilingFolder,
  FolderRuleLike,
  matchesConditions,
  PatternContext,
  RuleMatchable,
  substitutePattern,
} from './folder-rules.types';

/**
 * FolderRulesEngine — picks the first matching FolderRule for a document
 * and returns the rendered folder path.
 *
 * Order of evaluation:
 *   1. Fetch active rules for the tenant, ordered by priority DESC.
 *   2. First rule whose `conditions` match wins — its `folderPattern`
 *      is rendered with the document's PatternContext.
 *   3. If no rule matches AND the caller supplied enough info
 *      (expense category, supplier country / recurring flag), fall
 *      through to `decideFilingFolder` which produces the category /
 *      supplier / Estrangeira split (see FOREIGN_INVOICE_FLOW.md).
 *   4. Last resort — generic Inbox fallback so the document always lands
 *      somewhere safe.
 *
 * The engine never throws on a malformed condition (returns false) — a
 * misconfigured rule degrades to "doesn't match" instead of breaking the
 * upload path.
 */
@Injectable()
export class FolderRulesEngine {
  private readonly logger = new Logger(FolderRulesEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Suggest a folder for the given document. Returns the rendered path
   * (e.g. `/Fornecedores/edp/2026/08`, `/Despesas/Refeicoes/2026/08`,
   * `/Estrangeiras/Fornecedores/...`). Falls back to the catch-all
   * Inbox pattern if nothing else matches.
   */
  async suggest(
    tenantId: string,
    doc: RuleMatchable & { customer?: string | null },
    refDate: Date = new Date(),
  ): Promise<string> {
    const rules = await this.prisma.folderRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: { priority: 'desc' },
    });

    const ctx = buildPatternContext(doc, refDate);

    // ── Category-aware default (FIRST) ──────────────────────────────
    // The user-approved layout (see FOREIGN_INVOICE_FLOW.md,
    // "AFINAÇÃO do arquivo") splits documents by EXPENSE CATEGORY and
    // NATIONAL/FOREIGN because IVA deductibility rules differ per
    // category. When we have enough info to decide a folder
    // (recurring supplier, foreign country, OR resolved expense
    // category), we run `decideFilingFolder` BEFORE the rule table —
    // otherwise the seed rule `Faturas de fornecedores` (which matches
    // every FATURA_RECEBIDA) wins and everything ends up in
    // /Recebidas/{Entidade}.
    //
    // decideFilingFolder returns null when it can't pick — when that
    // happens, fall through to the rule table.
    const filingPath = decideFilingFolder(ctx, !!doc.supplierIsRecurring);
    if (filingPath) {
      return filingPath;
    }

    const matched = rules.find((r) => matchesConditions(r.conditions as any, doc));
    if (matched) {
      return this.render(
        {
          ...matched,
          conditions: matched.conditions as FolderRuleLike['conditions'],
        },
        ctx,
      );
    }

    this.logger.debug?.(
      `No folder rule matched for tenant=${tenantId} type=${doc.type} supplier=${doc.supplier ?? '-'}`,
    );
    return this.fallback(ctx);
  }

  /**
   * Render a folder path from a specific rule — exposed so the
   * update endpoint can re-suggest after the user changes type/supplier.
   */
  render(rule: FolderRuleLike, ctx: PatternContext): string {
    return substitutePattern(rule.folderPattern, ctx);
  }

  /**
   * Default path used when no rule matches AND we have no category/party
   * info to file by. Mirrors the seed's catch-all pattern
   * `/Inbox/{Ano}/{Mes}/{Tipo}` so the layout is predictable.
   */
  fallback(ctx: PatternContext): string {
    return substitutePattern('/Inbox/{Ano}/{Mes}/{Tipo}', ctx);
  }
}
