/**
 * Regras de IVA portuguesas (CIVA) — continente, Açores e Madeira.
 * Arredondamento comercial: 2 casas, half-up, por linha.
 */

export type IvaRegion = 'PT' | 'PT-AC' | 'PT-MA';
export type IvaRateKind = 'exempt' | 'reduced' | 'intermediate' | 'normal';

export const IVA_RATES: Record<
  IvaRegion,
  { reduced: number; intermediate: number; normal: number }
> = {
  PT: { reduced: 6, intermediate: 13, normal: 23 },
  'PT-AC': { reduced: 4, intermediate: 9, normal: 16 },
  'PT-MA': { reduced: 5, intermediate: 12, normal: 22 },
};

export const IVA_EXEMPTION_CODES: Record<string, string> = {
  M01: 'Art. 16.º n.º 6 alínea c) do CIVA',
  M02: 'Art. 6.º do Decreto-Lei n.º 198/90',
  M04: 'IVA de caixa',
  M05: 'Isento art. 9.º do CIVA',
  M07: 'Isento art. 14.º do CIVA (exportações / operações assimiladas)',
  M09: 'Isento art. 9.º do CIVA (outras)',
  M16: 'Autoliquidação',
  M99: 'Não sujeito / não tributável',
};

export interface IvaLine {
  base: number;
  rate: number;
  tax: number;
  kind?: IvaRateKind;
  region?: IvaRegion;
  exemptionCode?: string;
}

export interface IvaBreakdownCheck {
  ok: boolean;
  errors: string[];
  summedBase: number;
  summedTax: number;
  summedGross: number;
}

const RATE_TOLERANCE = 0.05;
const MONEY_TOLERANCE = 0.02;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0));
}

export function ivaFromBase(base: number, ratePercent: number): number {
  return roundMoney(base * (ratePercent / 100));
}

export function grossFromBase(base: number, ratePercent: number): number {
  return roundMoney(base + ivaFromBase(base, ratePercent));
}

export function splitGross(
  gross: number,
  ratePercent: number,
): { base: number; tax: number } {
  if (ratePercent === 0) return { base: roundMoney(gross), tax: 0 };
  const base = roundMoney(gross / (1 + ratePercent / 100));
  const tax = roundMoney(gross - base);
  return { base, tax };
}

export function classifyIvaRate(
  ratePercent: number,
  region: IvaRegion = 'PT',
): IvaRateKind | null {
  if (!Number.isFinite(ratePercent)) return null;
  if (Math.abs(ratePercent) <= RATE_TOLERANCE) return 'exempt';
  const table = IVA_RATES[region];
  const entries: Array<[IvaRateKind, number]> = [
    ['reduced', table.reduced],
    ['intermediate', table.intermediate],
    ['normal', table.normal],
  ];
  for (const [kind, official] of entries) {
    if (Math.abs(ratePercent - official) <= RATE_TOLERANCE) return kind;
  }
  return null;
}

export function rateForKind(kind: IvaRateKind, region: IvaRegion = 'PT'): number {
  if (kind === 'exempt') return 0;
  return IVA_RATES[region][kind];
}

export function regionFromCode(code?: string | null): IvaRegion {
  const c = (code ?? 'PT').toUpperCase();
  if (c === 'PT-AC' || c === 'PTAC' || c === 'AC') return 'PT-AC';
  if (c === 'PT-MA' || c === 'PTMA' || c === 'MA' || c === 'MAD') return 'PT-MA';
  return 'PT';
}

export function lineTaxMatchesRate(line: IvaLine, tolerance = MONEY_TOLERANCE): boolean {
  const expected = ivaFromBase(line.base, line.rate);
  return Math.abs(roundMoney(line.tax) - expected) <= tolerance;
}

export function validateIvaBreakdown(
  lines: IvaLine[],
  expected?: { total?: number; totalTax?: number; region?: IvaRegion },
): IvaBreakdownCheck {
  const errors: string[] = [];
  const region = expected?.region ?? 'PT';

  lines.forEach((line, idx) => {
    if (!Number.isFinite(line.base) || line.base < 0) {
      errors.push(`linha ${idx}: base inválida`);
    }
    if (!Number.isFinite(line.rate) || line.rate < 0) {
      errors.push(`linha ${idx}: taxa inválida`);
    }
    if (!Number.isFinite(line.tax) || line.tax < 0) {
      errors.push(`linha ${idx}: imposto inválido`);
    }
    if (line.rate === 0) {
      if (line.tax !== 0) errors.push(`linha ${idx}: isento com imposto ≠ 0`);
      if (line.exemptionCode && !IVA_EXEMPTION_CODES[line.exemptionCode] && !/^M\d{2}$/.test(line.exemptionCode)) {
        errors.push(`linha ${idx}: código de isenção desconhecido (${line.exemptionCode})`);
      }
    } else {
      const kind = classifyIvaRate(line.rate, line.region ?? region);
      if (!kind || kind === 'exempt') {
        errors.push(`linha ${idx}: taxa ${line.rate}% não existe em ${line.region ?? region}`);
      }
      if (!lineTaxMatchesRate(line)) {
        errors.push(
          `linha ${idx}: IVA ${line.tax} ≠ ${ivaFromBase(line.base, line.rate)} (${line.rate}% de ${line.base})`,
        );
      }
    }
  });

  const summedBase = sumMoney(lines.map((l) => l.base));
  const summedTax = sumMoney(lines.map((l) => l.tax));
  const summedGross = roundMoney(summedBase + summedTax);

  if (expected?.totalTax != null && Math.abs(summedTax - expected.totalTax) > MONEY_TOLERANCE) {
    errors.push(`total imposto ${summedTax} ≠ esperado ${expected.totalTax}`);
  }
  if (expected?.total != null && Math.abs(summedGross - expected.total) > MONEY_TOLERANCE) {
    errors.push(`total documento ${summedGross} ≠ esperado ${expected.total}`);
  }

  return { ok: errors.length === 0, errors, summedBase, summedTax, summedGross };
}
