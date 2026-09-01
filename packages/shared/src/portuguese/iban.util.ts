/**
 * Validação IBAN (ISO 13616 + ISO 7064 MOD-97-10) e NIB português (21 dígitos).
 * IBAN PT = PT + 2 check ISO + NIB 21 = 25 caracteres.
 * Exemplo válido gerado (IBAN + NIB): PT77003506510000000000739
 * Nota: o IBAN do seed grok (PT50003506510000000000712) NÃO passa MOD-97.
 */

const IBAN_LEN: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

export type IbanCheckStatus = 'valid' | 'invalid' | 'unknown';

export interface IbanParseResult {
  raw: string;
  normalized: string;
  country: string;
  checkDigits: string;
  bban: string;
  status: IbanCheckStatus;
  isPortuguese: boolean;
  nib?: string;
  bankCode?: string;
  branchCode?: string;
  accountNumber?: string;
  nibCheckDigits?: string;
  nibValid?: boolean;
}

export function normalizeIban(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[\s.\-]/g, '').toUpperCase();
}

/** ISO 7064 MOD-97-10 em blocos (sem BigInt). */
export function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    const d = numeric.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return -1;
    remainder = (remainder * 10 + d) % 97;
  }
  return remainder;
}

function ibanToNumeric(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let out = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (ch >= 'A' && ch <= 'Z') {
      out += String(ch.charCodeAt(0) - 55); // A=10
    } else {
      return '';
    }
  }
  return out;
}

export function isValidIban(input: string | null | undefined): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.length < 15 || iban.length > 34) return false;
  const country = iban.slice(0, 2);
  const expectedLen = IBAN_LEN[country];
  if (expectedLen && iban.length !== expectedLen) return false;
  const numeric = ibanToNumeric(iban);
  if (!numeric) return false;
  return mod97(numeric) === 1;
}

/** NIB PT: 21 dígitos, valor completo divisível por 97. */
export function isValidNib(input: string | null | undefined): boolean {
  const nib = (input ?? '').replace(/\s/g, '');
  if (!/^\d{21}$/.test(nib)) return false;
  return mod97(nib) === 0;
}

export function parseIban(input: string | null | undefined): IbanParseResult {
  const raw = input ?? '';
  const normalized = normalizeIban(raw);
  const country = normalized.slice(0, 2);
  const checkDigits = normalized.slice(2, 4);
  const bban = normalized.slice(4);
  const valid = isValidIban(normalized);
  const isPortuguese = country === 'PT';
  const result: IbanParseResult = {
    raw,
    normalized,
    country,
    checkDigits,
    bban,
    status: !normalized ? 'unknown' : valid ? 'valid' : 'invalid',
    isPortuguese,
  };
  if (isPortuguese && bban.length === 21) {
    result.nib = bban;
    result.bankCode = bban.slice(0, 4);
    result.branchCode = bban.slice(4, 8);
    result.accountNumber = bban.slice(8, 19);
    result.nibCheckDigits = bban.slice(19, 21);
    result.nibValid = isValidNib(bban);
    if (valid && result.nibValid === false) {
      result.status = 'invalid';
    }
  }
  return result;
}

export function ibanCountry(input: string | null | undefined): string | null {
  const n = normalizeIban(input);
  return /^[A-Z]{2}/.test(n) ? n.slice(0, 2) : null;
}

export function maskIban(input: string): string {
  const n = normalizeIban(input);
  if (n.length < 8) return n;
  return `${n.slice(0, 4)}••••${n.slice(-4)}`;
}

export function assertValidIban(input: string, label = 'IBAN'): string {
  const n = normalizeIban(input);
  if (!isValidIban(n)) {
    throw new Error(`${label} inválido: ${maskIban(n) || input}`);
  }
  return n;
}
