/**
 * Folder-rule matching helpers — PURE functions only.
 *
 * Kept separate from the Prisma-coupled service so we can unit-test the
 * matching + pattern substitution logic without spinning up a database.
 * The FolderRulesEngine service wraps these with a Prisma fetch and then
 * uses these primitives to compute the final folder path.
 *
 * Pattern syntax: a forward-slash separated path containing `{Token}` slots.
 *   /{Ano}/{Mes}/{Tipo}/{Entidade}
 *   /Inbox/{Ano}/{Mes}
 *   /Faturas/{Entidade}
 *
 * Unknown tokens (e.g. supplier not yet linked) resolve to `_` so the
 * resulting path stays filesystem-safe and the user can spot gaps.
 */

import { DocumentType } from '@prisma/client';

/**
 * Document shape needed by the matcher. Kept narrow on purpose: the engine
 * pulls only the columns that affect rule evaluation.
 */
export interface RuleMatchable {
  type: DocumentType;
  supplier?: string | null;
  supplierNif?: string | null;
  /** Email domain of the uploader / scanned source if available. */
  emailDomain?: string | null;
  /** Free-text search bag — keywords from filename, OCR, QR-AT. */
  keywords?: string[];
  /**
   * AI-suggested SNC/PGC category for the expense — set when the vision
   * path extracted a category and the folder-rules engine is being asked
   * to re-suggest after extraction. Stored on `metadata.extraction` but
   * passed into the matcher so rule authors can write a rule whose
   * keywords include "62.2.1 — Trabalhos especializados" and have the
   * right accounting folder matched automatically.
   */
  suggestedCategory?: string | null;
  /**
   * ISO 3166-1 alpha-2 country code of the SUPPLIER (not the tenant).
   * Drives the `/Estrangeiras/` vs `/Despesas|Fornecedores/` split.
   * Pulled from Party.country or `metadata.extraction.country`.
   */
  supplierCountry?: string | null;
  /**
   * True when the supplier is a recurring one — the party has been flagged
   * `isRecurring=true` by the supplier-resolution worker. Drives the
   * `/Fornecedores/{Nome}/` vs `/Despesas/{Categoria}/` decision.
   */
  supplierIsRecurring?: boolean | null;
  /**
   * Resolved expense category (PT slug) — one of EXPENSE_CATEGORIES.
   * Either set automatically (from `suggestedCategory` via
   * `mapToExpenseCategory`) or by the user during review. Drives the
   * `{Categoria}` token in folder patterns.
   */
  expenseCategory?: string | null;
}

// =============================================================================
// Expense-category mapping (PT, editable)
// =============================================================================
//
// The user explicitly wants the file layout to split expenses by category so
// that IVA (VAT) deductibility rules — which differ per category in PT — can
// be applied later. Refeições and Combustível have LIMITED deduction; the
// `vatDeductibilityHint` field on each entry is what we'll eventually
// surface to the IVA calc; here we just record the hint alongside the
// category so the metadata is ready.
//
// The mapping has TWO inputs:
//   1. `suggestedCategory` from Gemini — may be a free Portuguese phrase
//      ("restaurante"), an SNC code ("62.2.4"), or a full SNC label
//      ("62.2.4 — Honorários").
//   2. A user override — one of EXPENSE_CATEGORIES, set during review.
//
// The `mapToExpenseCategory` helper normalises both into a stable slug from
// EXPENSE_CATEGORIES. New categories only require editing EXPENSE_CATEGORIES
// + CATEGORY_HINTS — no other code change.
export const EXPENSE_CATEGORIES = [
  'Refeições',
  'Combustível',
  'Alojamento',
  'Deslocações',
  'Material de escritório',
  'Serviços/FSE',
  'Comunicações',
  'Rendas',
  'Outras',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * IVA deductibility hint per category. PT rules (very rough — the IVA apuramento
 * is a future feature):
 *   - Refeições → 50 % limited deduction (art. 23.º CIRC)
 *   - Combustível → subject to deduction limits by vehicle use
 *   - Other categories → normally 100 % deductible for taxed activity
 *
 * Stored on `metadata.filing.vatDeductibilityHint` so the IVA calc layer can
 * read it without re-deriving the rule from text.
 */
export interface VatDeductibilityHint {
  /** "limited" | "full" | "exempt" — high-level bucket the apuramento reads. */
  scope: 'limited' | 'full' | 'exempt';
  /**
   * Human-readable reason — surfaced in the document review UI so the user
   * knows WHY the hint is there ("refeições dedução limitada 50%").
   */
  reason: string;
}

export const VAT_DEDUCTIBILITY_HINTS: Record<ExpenseCategory, VatDeductibilityHint> = {
  Refeições: { scope: 'limited', reason: 'Refeições — dedução limitada (art. 23.º CIRC).' },
  Combustível: { scope: 'limited', reason: 'Combustível — dedução limitada por afetação do veículo.' },
  Alojamento: { scope: 'full', reason: 'Alojamento — dedução plena se afecto à atividade.' },
  Deslocações: { scope: 'full', reason: 'Deslocações — dedução plena se afecto à atividade.' },
  'Material de escritório': { scope: 'full', reason: 'Material de escritório — dedução plena.' },
  'Serviços/FSE': { scope: 'full', reason: 'Serviços / FSE — dedução plena.' },
  Comunicações: { scope: 'full', reason: 'Comunicações — dedução plena se afecto à atividade.' },
  Rendas: { scope: 'full', reason: 'Rendas — dedução plena se afecto à atividade.' },
  Outras: { scope: 'full', reason: 'Outras despesas — sem regra específica.' },
};

/**
 * Mapping table: free-phrase / SNC-code / label → expense category slug.
 * Order matters: more specific patterns first so "62.2.4 — Honorários" wins
 * over the generic "62" prefix. Substring match is case-insensitive and
 * diacritic-insensitive (we normalise both sides before comparing).
 */
export const CATEGORY_HINTS: ReadonlyArray<{ match: string; category: ExpenseCategory }> = [
  // Refeições
  { match: 'refei', category: 'Refeições' },
  { match: 'restaurante', category: 'Refeições' },
  { match: 'alimentacao', category: 'Refeições' },
  { match: '62.2.4', category: 'Refeições' },
  // Combustível
  { match: 'combustiv', category: 'Combustível' },
  { match: 'gasoleo', category: 'Combustível' },
  { match: 'gasolina', category: 'Combustível' },
  { match: 'galp', category: 'Combustível' },
  { match: 'repsol', category: 'Combustível' },
  { match: 'bp ', category: 'Combustível' },
  { match: '62.4.2', category: 'Combustível' },
  // Alojamento
  { match: 'alojamento', category: 'Alojamento' },
  { match: 'hotel', category: 'Alojamento' },
  { match: 'hospedagem', category: 'Alojamento' },
  // Deslocações
  { match: 'desloca', category: 'Deslocações' },
  { match: 'viagem', category: 'Deslocações' },
  { match: 'transporte', category: 'Deslocações' },
  { match: 'portagem', category: 'Deslocações' },
  { match: 'estacionamento', category: 'Deslocações' },
  { match: '62.4.3', category: 'Deslocações' },
  // Material de escritório
  { match: 'material de escritorio', category: 'Material de escritório' },
  { match: 'escritorio', category: 'Material de escritório' },
  { match: 'toner', category: 'Material de escritório' },
  { match: 'papelaria', category: 'Material de escritório' },
  // Serviços / FSE
  { match: 'servico', category: 'Serviços/FSE' },
  { match: 'fse', category: 'Serviços/FSE' },
  { match: 'honorario', category: 'Serviços/FSE' },
  { match: 'consultoria', category: 'Serviços/FSE' },
  { match: 'contabilidade', category: 'Serviços/FSE' },
  { match: '62.2.1', category: 'Serviços/FSE' },
  { match: '62.2.4', category: 'Serviços/FSE' }, // Honorários — overlaps with Refeições mapping above; first match wins
  // Comunicações
  { match: 'comunicac', category: 'Comunicações' },
  { match: 'telefone', category: 'Comunicações' },
  { match: 'internet', category: 'Comunicações' },
  { match: 'vodafone', category: 'Comunicações' },
  { match: 'nos comunicac', category: 'Comunicações' },
  { match: 'meo', category: 'Comunicações' },
  // Rendas
  { match: 'renda', category: 'Rendas' },
  { match: 'arrendamento', category: 'Rendas' },
];

/**
 * Normalise a string for case- and diacritic-insensitive comparison.
 * Lowercases, strips combining marks. Used by both the AI mapping and
 * the keyword matcher so "Restaurante" and "restaurante" match the same
 * hint.
 */
export function normalise(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Map an AI-suggested category (SNC code, free phrase, or full label) onto
 * one of EXPENSE_CATEGORIES. Returns `null` when nothing matches — caller
 * decides whether to fall back to "Outras" or leave the field empty.
 */
export function mapToExpenseCategory(suggested: string | null | undefined): ExpenseCategory | null {
  if (!suggested) return null;
  const norm = normalise(suggested);
  if (!norm) return null;

  for (const hint of CATEGORY_HINTS) {
    if (norm.includes(normalise(hint.match))) return hint.category;
  }
  return null;
}

/**
 * Validate that a string is one of the EXPENSE_CATEGORIES. Used by the DTO
 * to reject typos in manual category overrides.
 */
export function isExpenseCategory(value: string | null | undefined): value is ExpenseCategory {
  if (!value) return false;
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Conditions JSON shape stored on FolderRule.conditions. Every field is
 * optional; `keywords` is OR-matched (any hit counts).
 *
 *   { "type": "FATURA_RECEBIDA", "supplier": "EDP", "keywords": ["eletricidade"] }
 */
export interface FolderRuleConditions {
  type?: DocumentType;
  supplier?: string;
  supplierNif?: string;
  emailDomain?: string;
  keywords?: string[];
}

export interface FolderRuleLike {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  conditions: FolderRuleConditions | null;
  folderPattern: string;
}

/**
 * All tokens the engine knows how to substitute. New tokens go here.
 *
 *   {Ano}    — calendar year (UTC, 4-digit)
 *   {Mes}    — calendar month (UTC, 2-digit)
 *   {Tipo}   — DocumentType slug (sanitised)
 *   {Entidade} — supplier or customer name (sanitised)
 *   {Categoria} — expense category slug, one of EXPENSE_CATEGORIES
 *                  (sanitised to ASCII kebab)
 *   {Pais}   — supplier country code (lower-cased, "pt" / "es" / …)
 *   {Origem} — "Nacional" or "Estrangeira"
 */
export interface PatternContext {
  /** Calendar year (4-digit, e.g. 2026). */
  Ano: string;
  /** Calendar month (2-digit, 01..12). */
  Mes: string;
  /** Document type slug in lower-case (matches URL conventions). */
  Tipo: string;
  /** Supplier / customer name, sanitized for path use. */
  Entidade: string;
  /** Expense category, sanitised for path use (kebab-case). Empty → `_`. */
  Categoria: string;
  /** Supplier country code lower-cased; empty → `_`. */
  Pais: string;
  /** "Nacional" | "Estrangeira" — branch label; empty when country unknown. */
  Origem: string;
}

/**
 * Sanitize a string for use inside a filesystem path. Lower-cases, strips
 * diacritics, collapses whitespace to `_`, removes anything that is not
 * alphanumeric / `_` / `-`. Returns `_` for empty input so a missing
 * supplier never produces an empty folder segment like `//`.
 */
export function sanitizeForPath(input: string | null | undefined): string {
  if (!input) return '_';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || '_';
}

/**
 * Sanitise a category slug — same as sanitizeForPath but slashes collapse
 * to `-` instead of `_` so "Serviços/FSE" becomes "servicos-fse" rather than
 * "servicos_fse". Still filesystem-safe everywhere.
 */
export function sanitizeCategoryForPath(input: string | null | undefined): string {
  return sanitizeForPath(input?.replace(/\//g, '-'));
}

/**
 * Does `conditions` match the given document? Empty / null conditions
 * match everything (catch-all rule). The default rule in the seed has
 * `conditions: {}` and is therefore the universal fallback.
 */
export function matchesConditions(
  conditions: FolderRuleConditions | null | undefined,
  doc: RuleMatchable,
): boolean {
  if (!conditions) return true;

  if (conditions.type && doc.type !== conditions.type) return false;

  if (conditions.supplier) {
    if (!doc.supplier) return false;
    if (!doc.supplier.toLowerCase().includes(conditions.supplier.toLowerCase())) {
      return false;
    }
  }

  if (conditions.supplierNif) {
    if (!doc.supplierNif) return false;
    if (doc.supplierNif !== conditions.supplierNif) return false;
  }

  if (conditions.emailDomain) {
    if (!doc.emailDomain) return false;
    if (!doc.emailDomain.toLowerCase().endsWith(`@${conditions.emailDomain.toLowerCase()}`)) {
      return false;
    }
  }

  if (conditions.keywords && conditions.keywords.length > 0) {
    const haystack = (doc.keywords ?? []).map((k) => k.toLowerCase());
    // AI-extracted category acts as an extra keyword — the engine
    // can't tell the difference between "the supplier's name contains
    // 'eletricidade'" and "the AI said this is a 62.4.1 — Eletricidade
    // expense". Both are hints the rule author wants to match.
    if (doc.suggestedCategory) {
      haystack.push(doc.suggestedCategory.toLowerCase());
    }
    if (haystack.length === 0) return false;
    const wanted = conditions.keywords.map((k) => k.toLowerCase());
    const anyHit = wanted.some((w) => haystack.some((h) => h.includes(w)));
    if (!anyHit) return false;
  }

  return true;
}

/**
 * Substitute `{Token}` placeholders in `pattern` using `ctx`. Unknown
 * tokens become `_` so the path is always valid.
 */
export function substitutePattern(pattern: string, ctx: PatternContext): string {
  const ctxForSub: Record<string, string> = {
    Ano: ctx.Ano,
    Mes: ctx.Mes,
    Tipo: sanitizeForPath(ctx.Tipo),
    Entidade: sanitizeForPath(ctx.Entidade),
    Categoria: sanitizeCategoryForPath(ctx.Categoria),
    Pais: sanitizeForPath(ctx.Pais),
    Origem: sanitizeForPath(ctx.Origem),
  };

  return pattern
    .split('/')
    .map((segment) =>
      segment.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, token: string) => {
        if (token in ctxForSub) return ctxForSub[token];
        // Unknown token — preserve by leaving the placeholder visible.
        return `_${token}_`;
      }),
    )
    .join('/');
}

/**
 * Derive the {Origem} branch label from a supplier country code.
 *   - Unknown country → "" (let downstream consumers decide — the folder
 *     decision treats unknown as "nacional" by default).
 *   - "PT" / "pt" → "Nacional"
 *   - everything else → "Estrangeira"
 */
export function origemFromCountry(country: string | null | undefined): string {
  if (!country) return '';
  return country.trim().toUpperCase() === 'PT' ? 'Nacional' : 'Estrangeira';
}

/**
 * Build a PatternContext for the given document / reference date.
 * Pulled out as a helper so tests can pin a fixed date and avoid
 * Date.now() flakiness.
 */
export function buildPatternContext(
  doc: RuleMatchable & { customer?: string | null },
  refDate: Date,
): PatternContext {
  return {
    Ano: String(refDate.getUTCFullYear()),
    Mes: String(refDate.getUTCMonth() + 1).padStart(2, '0'),
    Tipo: doc.type,
    Entidade: doc.supplier ?? doc.customer ?? '',
    Categoria: doc.expenseCategory ?? '',
    Pais: doc.supplierCountry ?? '',
    Origem: origemFromCountry(doc.supplierCountry),
  };
}

/**
 * Decide the default folder path when no FolderRule matches and the caller
 * wants the new category-aware layout (`/Fornecedores/{Nome}/{Ano}/{Mes}/`
 * for recurring suppliers; `/Despesas/{Categoria}/{Ano}/{Mes}/` for
 * occasional expenses; everything under `/Estrangeiras/` when the
 * supplier is foreign).
 *
 * Returns null when the engine cannot decide (no supplier AND no category)
 * — caller falls back to the generic Inbox layout.
 */
export function decideFilingFolder(
  ctx: PatternContext,
  isRecurring: boolean,
): string | null {
  const { Ano, Mes, Entidade, Categoria, Pais, Origem } = ctx;
  if (!Ano || !Mes) return null;

  const yearMonth = `/${Ano}/${Mes}`;
  const entidadeSlug = sanitizeForPath(Entidade);
  const categoriaSlug = sanitizeCategoryForPath(Categoria);

  // Foreign branch always wins when we know the supplier is non-PT.
  // Inside the foreign branch we still mirror the recurring/category split
  // so the user can drill into a specific foreign supplier or category.
  // NB: we use a different segment label ("Fornecedor" / "Despesa" —
  // singular) to avoid the @@unique([tenantId, name]) clash with the
  // national /Fornecedores/ and /Despesas/ root-level folders.
  if (Origem === 'Estrangeira') {
    if (isRecurring && entidadeSlug !== '_') {
      return `/Estrangeiras/Fornecedor/${entidadeSlug}${yearMonth}`;
    }
    if (categoriaSlug !== '_') {
      return `/Estrangeiras/Despesa/${categoriaSlug}${yearMonth}`;
    }
    // Foreign but no supplier/category known — park in a generic foreign bucket.
    return `/Estrangeiras/Geral${yearMonth}`;
  }

  // National branch.
  if (isRecurring && entidadeSlug !== '_') {
    return `/Fornecedores/${entidadeSlug}${yearMonth}`;
  }
  if (categoriaSlug !== '_') {
    return `/Despesas/${categoriaSlug}${yearMonth}`;
  }
  return null;
}
