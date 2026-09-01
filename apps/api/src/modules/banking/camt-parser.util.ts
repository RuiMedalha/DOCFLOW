/**
 * Minimal CAMT.053 (ISO 20022 Bank-to-Customer Statement) parser.
 *
 * Scope: extract every <Ntry> entry into a BankTransaction-shaped object.
 * We pull just what we need — booking date, amount, currency, party name,
 * IBAN, reference (AcctSvcrRef / EndToEndId / TxId), and the closing
 * balance. Anything else is preserved as rawXml so the audit trail keeps
 * the source.
 *
 * Why hand-rolled: pulling fast-xml-parser for a fixed shape is overkill,
 * and regex on the <Ntry> blocks is fast + dependency-free.
 */

import { Prisma } from '@prisma/client';

export interface CamtEntry {
  /** ISO date YYYY-MM-DD for booking date (or value date as fallback) */
  date: string;
  /** Signed amount in major units (EUR). Cents are dropped — Prisma stores Decimal(14,2) */
  amount: Prisma.Decimal;
  /** ISO currency code (EUR default) */
  currency: string;
  /** "CRDT" / "DBIT" — preserved for debugging */
  direction?: string;
  /** Bank-side reference (AcctSvcrRef) */
  bankRef?: string;
  /** End-to-end payment reference */
  endToEndId?: string;
  /** TxId / InstrId fallback */
  txId?: string;
  /** Counterparty (debtor/creditor) name */
  counterpartyName?: string;
  /** Counterparty IBAN */
  counterpartyIban?: string;
  /** Remittance information (unstructured) */
  remittanceInfo?: string;
  /** Raw <Ntry> XML for storage */
  rawXml: string;
}

const ENTRY_RE = /<Ntry\b[^>]*>([\s\S]*?)<\/Ntry>/gi;

/** Pull the first text inside a simple element. Returns undefined if absent. */
function pick(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return undefined;
  return m[1].replace(/<[^>]+>/g, '').trim() || undefined;
}

/** Date in CAMT is either <Dt> or <DtTm>; we prefer <Dt>. */
function pickDate(xml: string): string | undefined {
  const dt = pick(xml, 'Dt');
  if (dt) return dt;
  const dtm = pick(xml, 'DtTm');
  if (!dtm) return undefined;
  // YYYY-MM-DDThh:mm:ss[.fff][Z|+hh:mm]
  return dtm.slice(0, 10);
}

function pickNumber(xml: string, tag: string): number {
  const raw = pick(xml, tag);
  if (!raw) return 0;
  // strip thousands separators, normalize decimal comma
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a CAMT.053 XML string into a flat list of `CamtEntry`. Returns an
 * empty array when no <Ntry> blocks are present — callers handle that as
 * a "nothing to import" path.
 */
export function parseCamtContent(xml: string): CamtEntry[] {
  if (!xml || typeof xml !== 'string') return [];

  const entries: CamtEntry[] = [];
  let match: RegExpExecArray | null;
  ENTRY_RE.lastIndex = 0;
  while ((match = ENTRY_RE.exec(xml)) !== null) {
    const block = match[0];
    const inner = match[1];

    const date = pickDate(inner);
    if (!date) continue;

    // <Amt Ccy="EUR">123.45</Amt>  — we capture Ccy from the same element.
    // ISO 20022 uses '.' as decimal separator; we only swap to JS-friendly
    // form by replacing comma with dot (some European banks emit "12,34").
    const amtRe =
      /<Amt\b[^>]*Ccy="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Amt>/i;
    const amtMatch = inner.match(amtRe);
    const currency = amtMatch ? amtMatch[1] : 'EUR';
    const amountRaw = amtMatch ? amtMatch[2] : pick(inner, 'Amt') ?? '0';
    const normalized = amountRaw.includes(',')
      ? amountRaw.replace(/\./g, '').replace(',', '.')
      : amountRaw;
    const direction = pick(inner, 'CdtDbtInd');
    let amount: Prisma.Decimal;
    try {
      // Keep bank money in Decimal form; Number would lose precision before
      // Prisma writes the value to its Decimal column.
      const unsignedAmount = new Prisma.Decimal(normalized).abs();
      amount = (direction ?? '').toUpperCase() === 'DBIT'
        ? unsignedAmount.negated()
        : unsignedAmount;
    } catch {
      continue;
    }

    // Transaction details: pick the deepest references
    const txDetailsMatch = inner.match(/<TxDtls\b[\s\S]*?<\/TxDtls>/i);
    const txBlock = txDetailsMatch ? txDetailsMatch[0] : '';

    const refsBlockMatch = txBlock.match(/<Refs\b[\s\S]*?<\/Refs>/i);
    const refsBlock = refsBlockMatch ? refsBlockMatch[0] : '';

    const bankRef = pick(refsBlock, 'AcctSvcrRef');
    const endToEndId = pick(refsBlock, 'EndToEndId');
    const txId = pick(refsBlock, 'TxId') ?? pick(refsBlock, 'InstrId');

    // Party block — try Creditor first, then Debtor (depending on direction)
    const isDebit = (direction ?? '').toUpperCase() === 'DBIT';
    const partyTag = isDebit ? 'Cdtr' : 'Dbtr';
    const accountTag = isDebit ? 'CdtrAcct' : 'DbtrAcct';
    const partyMatch = inner.match(
      new RegExp(`<${partyTag}\\b[\\s\\S]*?<\\/${partyTag}>`, 'i'),
    );
    const partyBlock = partyMatch ? partyMatch[0] : '';
    const accountMatch = inner.match(
      new RegExp(`<${accountTag}\\b[\\s\\S]*?<\\/${accountTag}>`, 'i'),
    );
    const accountBlock = accountMatch ? accountMatch[0] : '';

    const counterpartyName = pick(partyBlock, 'Nm');
    const counterpartyIban =
      pick(accountBlock, 'IBAN') ?? pick(accountBlock, 'Othr');

    // Remittance info (unstructured)
    const rmtiMatch = inner.match(/<RmtInf\b[\s\S]*?<\/RmtInf>/i);
    const rmtiBlock = rmtiMatch ? rmtiMatch[0] : '';
    const remittanceInfo =
      pick(rmtiBlock, 'Ustrd') ?? pick(rmtiBlock, 'CdtrRefInf');

    entries.push({
      date,
      amount,
      currency,
      direction,
      bankRef,
      endToEndId,
      txId,
      counterpartyName,
      counterpartyIban,
      remittanceInfo,
      rawXml: block,
    });
  }

  return entries;
}

/**
 * Convenience helper to compute closing balance from <Bal> blocks. We look
 * for the first <Bal><Tp><Cd>CLBD</Cd></Tp>...</Bal> pair — that's the
 * canonical "Closing Booked" balance. Falls back to the first <Bal>.
 */
export function extractClosingBalance(xml: string): number | null {
  const clbdRe = /<Bal\b[\s\S]*?<Tp>[\s\S]*?<Cd>CLBD<\/Cd>[\s\S]*?<\/Tp>([\s\S]*?)<\/Bal>/i;
  const clbdMatch = xml.match(clbdRe);
  const block = clbdMatch
    ? clbdMatch[0]
    : (xml.match(/<Bal\b[\s\S]*?<\/Bal>/i)?.[0] ?? '');
  if (!block) return null;
  const amtMatch = block.match(/<Amt[^>]*>([\s\S]*?)<\/Amt>/i);
  if (!amtMatch) return null;
  const raw = amtMatch[1];
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}
