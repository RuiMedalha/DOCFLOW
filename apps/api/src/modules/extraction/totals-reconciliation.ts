/**
 * Fase 4.1 — descontos e fecho dos totais ao cêntimo.
 *
 * No teste real do Rui os descontos apareciam como "diferenças": o
 * sistema guardava um total que não batia certo com as linhas e ninguém
 * dava por isso. A regra passa a ser explícita:
 *
 *     soma(linhas) − desconto por linha − desconto global + IVA = total
 *
 * com tolerância de 1 cêntimo. Quando não fecha, o documento vai para
 * revisão com o motivo, em vez de guardar uma diferença silenciosa.
 *
 * Função pura e testada — sem Prisma, sem rede.
 */

export interface ReconLineItem {
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  discount?: number | null;
  vatRate?: number | null;
}

export interface TotalsReconciliation {
  /** True quando fecha dentro da tolerância. */
  reconciled: boolean;
  /** total esperado − total do documento (positivo = documento a menos). */
  delta: number | null;
  /** Soma dos descontos por linha. */
  lineDiscountTotal: number;
  /** Desconto global do cabeçalho, normalizado (nunca negativo). */
  discountAmount: number | null;
  /** Motivo legível para a metadata e o ecrã de revisão. */
  reason: string;
}

/** Tolerância de arredondamento: 1 cêntimo. */
export const TOTALS_TOLERANCE = 0.01;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Base líquida de uma linha, já sem o desconto da própria linha.
 * `lineTotal` é o que o fornecedor imprime (normalmente já líquido do
 * desconto); quando falta, derivamos de quantidade × preço unitário.
 */
export function lineNet(item: ReconLineItem): number | null {
  const lineTotal = num(item.lineTotal);
  if (lineTotal != null) return lineTotal;
  const qty = num(item.quantity) ?? 1;
  const unit = num(item.unitPrice);
  if (unit == null) return null;
  const discount = num(item.discount) ?? 0;
  return round2(unit * qty - discount);
}

export function reconcileTotals(input: {
  lineItems?: ReconLineItem[] | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  netAmount?: number | null;
  total?: number | null;
}): TotalsReconciliation {
  const discountRaw = num(input.discountAmount);
  const discountAmount = discountRaw != null ? Math.abs(round2(discountRaw)) : null;
  const items = input.lineItems ?? [];
  const lineDiscountTotal = round2(
    items.reduce((acc, it) => acc + Math.abs(num(it.discount) ?? 0), 0),
  );
  const total = num(input.total);
  const tax = num(input.taxAmount);

  if (total == null) {
    return {
      reconciled: false,
      delta: null,
      lineDiscountTotal,
      discountAmount,
      reason: 'no_total',
    };
  }

  // Base das linhas. Se alguma linha não dá base, não podemos fechar por
  // esta via — não inventamos um resultado.
  const nets = items.map(lineNet);
  const haveAllLines = items.length > 0 && nets.every((n) => n != null);

  if (haveAllLines) {
    const lines = round2((nets as number[]).reduce((a, b) => a + b, 0));
    const disc = discountAmount ?? 0;
    const t = tax ?? 0;

    // O fornecedor pode imprimir o total da linha líquido OU já com IVA
    // ("net or gross, whichever the supplier prints"), e o desconto
    // global pode já estar refletido nas linhas ou não. Não há forma de
    // saber qual a convenção — por isso testamos as quatro combinações
    // plausíveis e só damos o documento por não fechado quando NENHUMA
    // fecha. Assumir uma só convenção marcava metade das faturas reais
    // como erradas: a IKEA imprime linhas com IVA (soma = total exacto)
    // e era acusada de faltarem 48,62 € de IVA.
    const candidates: Array<{ expected: number; reason: string }> = [
      { expected: round2(lines - disc + t), reason: 'linhas_liquidas_menos_desconto_mais_iva' },
      { expected: round2(lines + t), reason: 'linhas_liquidas_mais_iva_desconto_ja_nas_linhas' },
      { expected: round2(lines - disc), reason: 'linhas_com_iva_menos_desconto' },
      { expected: lines, reason: 'linhas_com_iva_desconto_ja_nas_linhas' },
    ];
    let best = candidates[0];
    let bestDelta = round2(best.expected - total);
    for (const c of candidates) {
      const delta = round2(c.expected - total);
      if (Math.abs(delta) <= TOTALS_TOLERANCE) {
        return { reconciled: true, delta, lineDiscountTotal, discountAmount, reason: c.reason };
      }
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        best = c;
        bestDelta = delta;
      }
    }
    return {
      reconciled: false,
      // Reportamos a interpretação que menos falhou — é a que ajuda quem
      // vai rever o documento.
      delta: bestDelta,
      lineDiscountTotal,
      discountAmount,
      reason:
        `totals_mismatch:linhas=${lines.toFixed(2)} ` +
        `desconto=${disc.toFixed(2)} iva=${t.toFixed(2)} ` +
        `melhor=${best.reason}(${best.expected.toFixed(2)}) ` +
        `documento=${total.toFixed(2)} diferença=${bestDelta.toFixed(2)}`,
    };
  }

  // Sem linhas utilizáveis, ainda podemos fechar o trio base + IVA.
  const net = num(input.netAmount);
  if (net != null && tax != null) {
    const delta = round2(net + tax - total);
    if (Math.abs(delta) <= TOTALS_TOLERANCE) {
      return {
        reconciled: true,
        delta,
        lineDiscountTotal,
        discountAmount,
        reason: 'net_plus_tax_equals_total',
      };
    }
    return {
      reconciled: false,
      delta,
      lineDiscountTotal,
      discountAmount,
      reason:
        `totals_mismatch:base=${net.toFixed(2)} iva=${tax.toFixed(2)} ` +
        `documento=${total.toFixed(2)} diferença=${delta.toFixed(2)}`,
    };
  }

  return {
    reconciled: false,
    delta: null,
    lineDiscountTotal,
    discountAmount,
    reason: items.length === 0 ? 'no_line_items' : 'incomplete_line_items',
  };
}

/**
 * Fase 4.1 — notas de crédito.
 *
 * Uma NC nunca pode ser tratada como uma fatura normal: o valor tem de
 * entrar negativo no saldo do fornecedor e no IVA. O valor impresso fica
 * como está em `total`; o sinal vive nas colunas `signed*`.
 */
export function signedAmounts(
  documentType: string | null | undefined,
  amounts: { total?: number | null; taxAmount?: number | null; netAmount?: number | null },
): { signedTotal: number | null; signedTaxAmount: number | null; signedNetAmount: number | null } {
  const sign = documentType === 'NOTA_CREDITO' ? -1 : 1;
  const apply = (v: number | null | undefined): number | null => {
    const n = num(v);
    if (n == null) return null;
    // Um fornecedor que já imprime a NC com valores negativos não leva
    // o sinal duas vezes.
    return round2(sign * Math.abs(n));
  };
  return {
    signedTotal: apply(amounts.total),
    signedTaxAmount: apply(amounts.taxAmount),
    signedNetAmount: apply(amounts.netAmount),
  };
}
