/**
 * Validação de NIF / NIPC português (módulo 11).
 * Pesos 9..2 sobre os 8 primeiros dígitos; resto < 2 ⇒ dígito de controlo 0.
 * Referência: algoritmo AT / Portaria do NIF; testes com 500697370 e 500000000 (seed grok).
 */

export type NifKind =
  | 'pessoa_singular'
  | 'nao_residente'
  | 'pessoa_coletiva'
  | 'administracao_publica'
  | 'heranca_ou_fundo'
  | 'irregular_ou_outro'
  | 'unknown';

const NIF_DIGITS = /^\d{9}$/;

export function normalizeNif(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[\s.\-]/g, '');
}

export function computeNifCheckDigit(firstEight: string): number {
  if (!/^\d{8}$/.test(firstEight)) {
    throw new Error('computeNifCheckDigit: esperado 8 dígitos');
  }
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(firstEight[i]) * (9 - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function classifyNif(nif: string): NifKind {
  const n = normalizeNif(nif);
  if (!NIF_DIGITS.test(n)) return 'unknown';
  const d0 = n[0];
  const prefix2 = n.slice(0, 2);
  if (d0 === '1' || d0 === '2' || d0 === '3') return 'pessoa_singular';
  if (prefix2 === '45') return 'nao_residente';
  if (d0 === '5') return 'pessoa_coletiva';
  if (d0 === '6') return 'administracao_publica';
  if (['70', '71', '72', '74', '75', '77', '78', '79'].includes(prefix2)) {
    return 'heranca_ou_fundo';
  }
  if (d0 === '8' || d0 === '9') return 'irregular_ou_outro';
  return 'unknown';
}

export function isValidNif(input: string | null | undefined): boolean {
  const nif = normalizeNif(input);
  if (!NIF_DIGITS.test(nif)) return false;
  if (classifyNif(nif) === 'unknown') return false;
  const expected = computeNifCheckDigit(nif.slice(0, 8));
  return expected === Number(nif[8]);
}

/** Consumidor final no QR-AT (campo B). */
export function isFinalConsumerNif(input: string | null | undefined): boolean {
  const nif = normalizeNif(input);
  return nif === '' || nif === '0' || nif === '000000000' || nif === '999999990';
}

export function assertValidNif(input: string, label = 'NIF'): string {
  const nif = normalizeNif(input);
  if (!isValidNif(nif)) {
    throw new Error(`${label} inválido: ${input}`);
  }
  return nif;
}
