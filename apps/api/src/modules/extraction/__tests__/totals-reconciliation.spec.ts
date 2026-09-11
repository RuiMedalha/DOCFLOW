import {
  TOTALS_TOLERANCE,
  lineNet,
  reconcileTotals,
  signedAmounts,
} from '../totals-reconciliation';

/**
 * Fase 4.1 (P1.3) — no teste real do Rui os descontos apareciam como
 * "diferenças" e ficavam gravados em silêncio. A conta passa a ser
 * explícita e, quando não fecha, o documento vai para revisão com o
 * motivo.
 */
describe('reconcileTotals()', () => {
  it('fecha uma fatura com desconto global ao cêntimo', () => {
    const out = reconcileTotals({
      lineItems: [
        { quantity: 1, unitPrice: 100, lineTotal: 100 },
        { quantity: 2, unitPrice: 50, lineTotal: 100 },
      ],
      discountAmount: 20,
      taxAmount: 41.4, // 23 % sobre 180
      total: 221.4,
    });
    expect(out.reconciled).toBe(true);
    expect(out.delta).toBe(0);
    expect(out.discountAmount).toBe(20);
  });

  it('fecha com descontos por linha (o lineTotal já vem líquido)', () => {
    const out = reconcileTotals({
      lineItems: [
        { quantity: 1, unitPrice: 100, discount: 10, lineTotal: 90 },
        { quantity: 1, unitPrice: 60, discount: 5, lineTotal: 55 },
      ],
      taxAmount: 33.35,
      total: 178.35,
    });
    expect(out.reconciled).toBe(true);
    expect(out.lineDiscountTotal).toBe(15);
  });

  it('aceita exactamente 1 cêntimo de diferença e recusa 2', () => {
    const base = { lineItems: [{ lineTotal: 100 }], taxAmount: 23 };
    expect(reconcileTotals({ ...base, total: 123.01 }).reconciled).toBe(true);
    expect(reconcileTotals({ ...base, total: 122.99 }).reconciled).toBe(true);
    expect(reconcileTotals({ ...base, total: 123.02 }).reconciled).toBe(false);
    expect(TOTALS_TOLERANCE).toBe(0.01);
  });

  it('quando não fecha, diz exactamente porquê e quanto falta', () => {
    const out = reconcileTotals({
      lineItems: [{ lineTotal: 100 }],
      discountAmount: 10,
      taxAmount: 20.7,
      total: 120.7, // esqueceram-se do desconto
    });
    expect(out.reconciled).toBe(false);
    expect(out.delta).toBe(-10);
    expect(out.reason).toContain('totals_mismatch');
    expect(out.reason).toContain('desconto=10.00');
  });

  it('sem linhas utilizáveis, fecha o trio base + IVA', () => {
    expect(reconcileTotals({ netAmount: 100, taxAmount: 23, total: 123 })).toMatchObject({
      reconciled: true,
      reason: 'net_plus_tax_equals_total',
    });
    expect(reconcileTotals({ netAmount: 100, taxAmount: 23, total: 130 }).reconciled).toBe(false);
  });

  it('não inventa um resultado quando faltam dados', () => {
    expect(reconcileTotals({ total: 100 })).toMatchObject({ reconciled: false, reason: 'no_line_items' });
    expect(reconcileTotals({ lineItems: [{ description: 'x' } as never], total: 100 })).toMatchObject({
      reconciled: false,
      reason: 'incomplete_line_items',
    });
    expect(reconcileTotals({ lineItems: [{ lineTotal: 10 }] })).toMatchObject({
      reconciled: false,
      reason: 'no_total',
      delta: null,
    });
  });

  it('normaliza um desconto que venha negativo', () => {
    expect(reconcileTotals({ discountAmount: -20, total: 1 }).discountAmount).toBe(20);
  });

  it('reproduz a TEFCOLD: 716,37 de linhas, 14,33 de desconto, IVA 0', () => {
    // Os valores reais que a extração devolveu para a VOV26009084.
    const out = reconcileTotals({
      lineItems: [{ lineTotal: 716.37 }, { lineTotal: 0 }],
      discountAmount: 14.33,
      taxAmount: 0,
      total: 702.04,
    });
    expect(out.reconciled).toBe(true);
    expect(out.delta).toBe(0);
  });
});

describe('lineNet()', () => {
  it('prefere o lineTotal impresso pelo fornecedor', () => {
    expect(lineNet({ quantity: 2, unitPrice: 50, lineTotal: 95 })).toBe(95);
  });
  it('deriva de quantidade × preço − desconto quando falta o lineTotal', () => {
    expect(lineNet({ quantity: 3, unitPrice: 10, discount: 5 })).toBe(25);
    expect(lineNet({ unitPrice: 10 })).toBe(10); // quantidade implícita 1
  });
  it('devolve null quando não há como calcular', () => {
    expect(lineNet({ quantity: 3 })).toBeNull();
    expect(lineNet({})).toBeNull();
  });
});

/**
 * Fase 4.1 (P1.2) — uma nota de crédito nunca pode ser tratada como uma
 * fatura normal: entra negativa no saldo do fornecedor e no IVA.
 */
describe('signedAmounts()', () => {
  it('inverte o sinal numa nota de crédito', () => {
    expect(signedAmounts('NOTA_CREDITO', { total: 123, taxAmount: 23, netAmount: 100 })).toEqual({
      signedTotal: -123,
      signedTaxAmount: -23,
      signedNetAmount: -100,
    });
  });

  it('não inverte duas vezes quando o fornecedor já imprime negativo', () => {
    expect(signedAmounts('NOTA_CREDITO', { total: -123 }).signedTotal).toBe(-123);
  });

  it('deixa a fatura normal positiva', () => {
    expect(signedAmounts('FATURA_RECEBIDA', { total: 123, taxAmount: 23 })).toMatchObject({
      signedTotal: 123,
      signedTaxAmount: 23,
    });
  });

  it('preserva os nulos em vez de os transformar em zero', () => {
    expect(signedAmounts('NOTA_CREDITO', {})).toEqual({
      signedTotal: null,
      signedTaxAmount: null,
      signedNetAmount: null,
    });
  });
});
