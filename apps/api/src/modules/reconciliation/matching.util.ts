/**
 * 3-tier matching engine for reconciliation.
 *
 * Tiers (in order of evaluation):
 *   - STRONG  (score 1.00): bankTx.reference == entity.reference/docNumber
 *                          — caller passes both, we test exact equality
 *                          on a normalised form (trim, case-fold).
 *   - MEDIUM  (score 0.75..0.95): document/order number appears INSIDE
 *                          the bank transaction description (or vice
 *                          versa). Catches the common PT case of "PAG
 *                          FT 2026/1234 FORNECEDOR" → docNumber
 *                          "FT 2026/1234".
 *   - WEAK    (score 0.50..0.90): amount match (±0.01) + date window
 *                          (≤3d → 0.50, ≤7d → 0.40, ≤30d → 0.30) +
 *                          description similarity (≥1 token overlap →
 *                          +0.20). Threshold: total ≥ 0.50 to count.
 *
 * The algorithm is intentionally cheap: O(N×M) over candidates, no
 * external libraries, no ML. Reuse the same matcher for documents,
 * expenses, invoices, and payable items — each entity type just maps
 * its primary key/amount/date fields into the same option shape.
 *
 * Scoring rationale: a STRONG match is unconditional (1.0). A MEDIUM
 * match (number in description) is high-confidence when both sides
 * confirm the doc number. A WEAK match is only useful when amount AND
 * date AND at least a hint of description agree.
 */
export type MatchType = 'STRONG' | 'MEDIUM' | 'WEAK';

export interface MatchCandidate {
  score: number;
  matchType: MatchType;
  reason: string;
}

export interface ScoreMatchInput {
  /** Bank transaction */
  bankRef?: string | null;
  bankDesc: string;
  bankAmount: number; // absolute (caller pre-applies Math.abs)
  bankDate: Date;
  /** Entity (document/expense/invoice/payable) */
  entityRef?: string | null;
  entityAmount: number;
  entityDate?: Date | null;
  entityDesc?: string | null;
  /** Optional explicit order/document number used for MEDIUM tier */
  orderNumber?: string | null;
}

/**
 * Apply the 3-tier matcher. Returns the best candidate (highest score),
 * or `null` when no tier clears its threshold. Strong wins over medium
 * which wins over weak.
 */
export function scoreMatch(opts: ScoreMatchInput): MatchCandidate | null {
  // ─────────────── STRONG: reference equality ───────────────
  if (opts.bankRef && opts.entityRef) {
    const a = normaliseRef(opts.bankRef);
    const b = normaliseRef(opts.entityRef);
    if (a && b && a === b) {
      return {
        score: 1.0,
        matchType: 'STRONG',
        reason: `reference exact match (${opts.bankRef})`,
      };
    }
  }

  // ─────────────── MEDIUM: order/document number in description ─────────
  // Try both directions independently — orderNumber→description AND
  // bankRef→entityDescription. Either one clearing the threshold wins.
  let mediumResult: MatchCandidate | null = null;

  if (opts.orderNumber || opts.entityRef) {
    const orderNumber = opts.orderNumber ?? opts.entityRef ?? null;
    const needle = normaliseRef(orderNumber as string);
    if (needle && needle.length >= 3 && opts.bankDesc) {
      const haystack = normaliseRef(opts.bankDesc);
      if (haystack.includes(needle)) {
        mediumResult = {
          score: 0.85,
          matchType: 'MEDIUM',
          reason: `document number "${orderNumber}" found in bank description`,
        };
      }
    }
  }

  if (!mediumResult && opts.bankRef && opts.entityDesc) {
    const ref = normaliseRef(opts.bankRef);
    const desc = normaliseRef(opts.entityDesc);
    if (ref && ref.length >= 3 && desc.includes(ref)) {
      mediumResult = {
        score: 0.8,
        matchType: 'MEDIUM',
        reason: `bank reference "${opts.bankRef}" found in entity description`,
      };
    }
  }

  if (mediumResult) return mediumResult;

  // ─────────────── WEAK: amount + date + description ──────────
  const amountMatch = Math.abs(opts.bankAmount - opts.entityAmount) < 0.01;
  if (!amountMatch) return null;

  // Base for amount match
  const base = 0.3;
  let dateScore = 0.3; // default: date unknown but amount matches
  let dateBucket: string;
  if (opts.entityDate) {
    const diffDays = Math.abs(
      (opts.bankDate.getTime() - opts.entityDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays <= 3) {
      dateScore = 0.5;
      dateBucket = 'within 3 days';
    } else if (diffDays <= 7) {
      dateScore = 0.4;
      dateBucket = 'within a week';
    } else if (diffDays <= 30) {
      dateScore = 0.3;
      dateBucket = 'within a month';
    } else {
      // >30d gap — too far to trust, drop the candidate.
      return null;
    }
  } else {
    dateBucket = 'no entity date';
  }

  let descScore = 0;
  let descReason = '';
  if (opts.entityDesc) {
    const a = normaliseRef(opts.bankDesc);
    const b = normaliseRef(opts.entityDesc);
    if (a && b) {
      // Substring match either direction is a strong hint.
      if (a.includes(b) || b.includes(a)) {
        descScore = 0.2;
        descReason = 'description overlap';
      } else {
        // Token-overlap fallback (≥1 shared token of length ≥4).
        const tokensA = new Set(a.split(/\s+/).filter((t) => t.length >= 4));
        const tokensB = b.split(/\s+/).filter((t) => t.length >= 4);
        const overlap = tokensB.some((t) => tokensA.has(t));
        if (overlap) {
          descScore = 0.1;
          descReason = 'shared description token';
        }
      }
    }
  }

  const score = base + dateScore + descScore;
  if (score < 0.5) return null;

  return {
    score: Math.min(score, 0.9),
    matchType: 'WEAK',
    reason: `amount match${descReason ? ' + ' + descReason : ''} (${dateBucket})`,
  };
}

/**
 * Pick the highest-scoring candidate from an array. Returns `null` when
 * the input is empty. Used by the service to fold candidates per
 * (bankTx, entity) group before we keep only the best per tx.
 */
export function pickBest(candidates: MatchCandidate[]): MatchCandidate | null {
  if (!candidates.length) return null;
  return candidates.reduce((acc, c) => (c.score > acc.score ? c : acc));
}

/**
 * Normalise a reference for comparison: trim, collapse internal
 * whitespace, fold case. Empty / whitespace-only strings return '' so
 * callers can do `if (a && b && a === b)` safely.
 */
function normaliseRef(s: string): string {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
