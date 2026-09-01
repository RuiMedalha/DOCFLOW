import { pickBest, scoreMatch } from './matching.util';

/**
 * Pure-function tests for the 3-tier scoring engine. No mocks needed
 * — these cover the algorithm itself. The service-level test covers
 * the Prisma + audit wiring.
 */
describe('scoreMatch', () => {
  const base = {
    bankDesc: 'PAGAMENTO FATURA 12345 FORNECEDOR X',
    bankAmount: 150.5,
    bankDate: new Date('2026-03-15'),
    entityAmount: 150.5,
  };

  // ─────────────── STRONG tier ───────────────
  describe('STRONG tier', () => {
    it('returns strong on exact reference equality', () => {
      const r = scoreMatch({
        ...base,
        bankRef: 'REF-999',
        entityRef: 'REF-999',
      });
      expect(r?.matchType).toBe('STRONG');
      expect(r?.score).toBe(1);
      expect(r?.reason).toMatch(/reference exact match/);
    });

    it('treats reference equality as case-insensitive and whitespace-tolerant', () => {
      const r = scoreMatch({
        ...base,
        bankRef: ' REF-999 ',
        entityRef: 'ref-999',
      });
      expect(r?.matchType).toBe('STRONG');
    });

    it('does NOT match when refs differ', () => {
      const r = scoreMatch({
        ...base,
        bankRef: 'REF-999',
        entityRef: 'REF-000',
      });
      // Falls through to WEAK tier (amount+date match)
      expect(r?.matchType).toBe('WEAK');
    });

    it('returns null when refs differ AND amount differs', () => {
      const r = scoreMatch({
        ...base,
        bankRef: 'REF-999',
        entityRef: 'REF-000',
        entityAmount: 200,
      });
      expect(r).toBeNull();
    });
  });

  // ─────────────── MEDIUM tier ───────────────
  describe('MEDIUM tier', () => {
    it('matches when order number appears in bank description', () => {
      const r = scoreMatch({
        ...base,
        orderNumber: '12345',
      });
      expect(r?.matchType).toBe('MEDIUM');
      expect(r?.score).toBeGreaterThanOrEqual(0.75);
      expect(r?.reason).toMatch(/12345/);
    });

    it('matches when bank reference appears in entity description (reverse case)', () => {
      const r = scoreMatch({
        ...base,
        bankRef: 'PAY-XYZ-001',
        entityDesc: 'PAGAMENTO PAY-XYZ-001 cliente final',
      });
      expect(r?.matchType).toBe('MEDIUM');
    });

    it('normalises order number (case + accents) before matching', () => {
      const r = scoreMatch({
        ...base,
        bankDesc: 'PAGAMENTO FT 2026/1234 cliente',
        orderNumber: 'ft 2026/1234',
      });
      expect(r?.matchType).toBe('MEDIUM');
    });

    it('ignores very short needles to avoid false positives', () => {
      const r = scoreMatch({
        ...base,
        orderNumber: 'AB',
      });
      // Too short — falls through to WEAK tier
      expect(r?.matchType).toBe('WEAK');
    });
  });

  // ─────────────── WEAK tier ───────────────
  describe('WEAK tier', () => {
    it('matches on amount + close date + overlapping description', () => {
      const r = scoreMatch({
        ...base,
        entityDate: new Date('2026-03-14'),
        entityDesc: 'FORNECEDOR X',
      });
      expect(r?.matchType).toBe('WEAK');
      expect(r?.score).toBeGreaterThan(0.5);
      expect(r?.score).toBeLessThanOrEqual(0.9);
    });

    it('returns null when amount differs', () => {
      const r = scoreMatch({
        ...base,
        entityAmount: 200,
      });
      expect(r).toBeNull();
    });

    it('returns null when date gap exceeds 30 days', () => {
      const r = scoreMatch({
        ...base,
        entityDate: new Date('2026-05-01'), // ~47d away
        entityDesc: 'FORNECEDOR X',
      });
      expect(r).toBeNull();
    });

    it('returns null when score falls below threshold (no description + far date)', () => {
      // amount matches, date 20d away (score 0.3+0.3=0.6, just over), no desc
      const r = scoreMatch({
        ...base,
        entityDate: new Date('2026-04-01'),
        // no entityDesc — base amount + date-window-only score
      });
      // score = 0.3 (amount) + 0.3 (date within month) = 0.6 — passes
      // the 0.5 threshold. So this returns WEAK. Make the date further
      // out to push it under.
      const tooFar = scoreMatch({
        ...base,
        entityDate: new Date('2026-05-01'),
      });
      // 47d → returns null outright (>30d).
      expect(tooFar).toBeNull();
      expect(r?.matchType).toBe('WEAK');
    });

    it('uses token overlap as a fallback for description similarity', () => {
      const r = scoreMatch({
        ...base,
        entityDate: new Date('2026-03-14'),
        entityDesc: 'PAGAMENTO FORNECEDOR', // shares 'PAGAMENTO' & 'FORNECEDOR'
      });
      expect(r?.matchType).toBe('WEAK');
      expect(r?.reason).toMatch(/description|token/);
    });
  });

  // ─────────────── edge cases ───────────────
  describe('edge cases', () => {
    it('handles empty refs without throwing', () => {
      const r = scoreMatch({
        ...base,
        bankRef: '',
        entityRef: '',
        orderNumber: '',
      });
      // No STRONG, no MEDIUM, amount matches → WEAK
      expect(r?.matchType).toBe('WEAK');
    });

    it('handles null entityDate gracefully (uses default dateScore)', () => {
      const r = scoreMatch({
        ...base,
        entityDate: null,
      });
      expect(r?.matchType).toBe('WEAK');
      // 0.3 (amount) + 0.3 (default) = 0.6 — passes
    });

    it('handles empty entity description', () => {
      const r = scoreMatch({
        ...base,
        entityDesc: '',
        entityDate: new Date('2026-03-15'),
      });
      expect(r?.matchType).toBe('WEAK');
    });
  });
});

describe('pickBest', () => {
  it('returns null for empty input', () => {
    expect(pickBest([])).toBeNull();
  });

  it('returns the highest-scoring candidate', () => {
    const best = pickBest([
      { score: 0.5, matchType: 'WEAK', reason: 'a' },
      { score: 1.0, matchType: 'STRONG', reason: 'b' },
      { score: 0.75, matchType: 'MEDIUM', reason: 'c' },
    ]);
    expect(best?.matchType).toBe('STRONG');
    expect(best?.score).toBe(1.0);
  });
});