/**
 * Portuguese NIF + IBAN generators that match @docflow/shared algorithms.
 * Used so E2E payloads pass server-side checksums without depending on seed data
 * (the demo seed IBANs are known-invalid — see packages/shared iban.util.ts).
 */

export function computeNifCheckDigit(firstEight: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(firstEight[i]) * (9 - i);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function makeNif(kind: 'coletiva' | 'singular' = 'coletiva'): string {
  const prefix = kind === 'coletiva' ? '5' : '2';
  let eight = prefix;
  for (let i = 0; i < 7; i++) eight += String(Math.floor(Math.random() * 10));
  return eight + String(computeNifCheckDigit(eight));
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    const d = numeric.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return -1;
    remainder = (remainder * 10 + d) % 97;
  }
  return remainder;
}

function toIbanNumeric(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let out = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') out += ch;
    else out += String(ch.charCodeAt(0) - 55);
  }
  return out;
}

/** ISO 7064 MOD-97-10 IBAN check. */
export function isValidIban(iban: string): boolean {
  const n = iban.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(n)) return false;
  return mod97(toIbanNumeric(n)) === 1;
}

/**
 * Build a valid PT IBAN (25 chars). BBAN is 21 digits: bank 0035 / branch 0651
 * plus a unique 11-digit account and 2 dummy NIB digits — only the ISO check
 * is required by `isValidIban`.
 */
export function makePtIban(account11?: string): string {
  const acct =
    account11 ??
    String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).padStart(11, '0');
  const bban = `00350651${acct}00`.slice(0, 21);
  const numeric = toIbanNumeric(`PT00${bban}`);
  const check = 98 - mod97(numeric);
  const iban = `PT${String(check).padStart(2, '0')}${bban}`;
  if (!isValidIban(iban)) {
    throw new Error(`generated invalid IBAN: ${iban}`);
  }
  return iban;
}

/** Canonical fixtures from the SEPA / shared test corpus. */
export const FIXTURE_IBAN_CREDITOR = 'PT50000201231234567890154';
export const FIXTURE_IBAN_DEBTOR = 'PT77003506510000000000739';
export const FIXTURE_BIC = 'CGDIPTPL';

/**
 * AT QR Code (Portaria AT). Total 123.00 EUR, IVA 23.00, issuer 500000000.
 * Copied from extraction.service.spec.ts so E2E and unit tests share a payload.
 */
export const SAMPLE_QR_AT =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260315*G:FT2026/1*H:J66S9FDD-1*' +
  'I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:abcd*R:1234';

export function uniqueSlug(prefix = 'e2e'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueEmail(local = 'admin'): string {
  return `${local}.${uniqueSlug('u')}@e2e.docflow.test`;
}
