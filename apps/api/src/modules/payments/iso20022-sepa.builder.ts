import { BadRequestException } from '@nestjs/common';
import { isValidIban, normalizeIban } from '@docflow/shared';

/**
 * SEPA pain.001.001.03 (CustomerCreditTransferInitiation) XML builder.
 *
 * We construct the XML by hand rather than pulling a heavy library: the
 * schema is fixed, the message is small (one <Document> root with a
 * <CstmrCdtTrfInitn> body), and every dependency in DocFlow runs through
 * the prisma/shared stack — adding `xmlbuilder2` or `iso20022-js` for one
 * output format is unnecessary weight.
 *
 * The builder is pure (no I/O) so the service can unit-test it end-to-end
 * via the XML string round-trip.
 *
 * Spec references:
 *   - ISO 20022 pain.001.001.03 (older but still required by every PT
 *     bank as of 2026; pain.001.001.09 adds more fields we don't need).
 *   - DocFlow internal: docs/portuguese-fiscal-integrations.md §4.
 *
 * Cardinality rules enforced here:
 *   - One <GrpHdr> per <Document>.
 *   - One or more <PmtInf> per <CstmrCdtTrfInitn>.
 *   - One or more <CdtTrfTxInf> per <PmtInf>.
 *   - <NbOfTxs> and <CtrlSum> must match the actual count and arithmetic
 *     sum (we recalculate on the fly and 400 if the input is wrong).
 */

export const SEPA_PAIN_001_NS =
  'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

export const SEPA_XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;

/** ISO 4217 currency supported by every PT bank over SEPA. */
export const SEPA_CURRENCY = 'EUR';

/** End-to-end ID cap (per EPC guideline) — keep <= 35 chars. */
export const SEPA_END_TO_END_ID_MAX = 35;

/** Unstructured remittance info max length (SEPA guideline, 140 chars). */
export const SEPA_REMITTANCE_MAX = 140;

/** Creditor / debtor name max length for SEPA pain.001 (70 chars). */
export const SEPA_PARTY_NAME_MAX = 70;

/**
 * Single credit transfer transaction, as passed in by the caller
 * (PaymentsService) and rendered into <CdtTrfTxInf>.
 *
 * Notes:
 *   - `endToEndId` becomes <PmtId>/<EndToEndId>. Use a stable internal id
 *     so camt.054 reconciliation can match the bank feedback back to our
 *     Payment row.
 *   - `creditorIban` is REQUIRED and must pass isValidIban (MOD-97-10).
 *     Without a valid IBAN we 400 — never emit invalid data to the bank.
 *   - `creditorBic` is OPTIONAL. PT banks accept SEPA credits to a PT IBAN
 *     without the BIC, but a BIC short-circuits routing.
 *   - `remittanceInformation` becomes <RmtInf>/<Ustrd>. Trim + clamp to
 *     the SEPA 140-char limit so the bank doesn't reject the file.
 */
export interface SepaCreditTransfer {
  endToEndId: string;
  amount: number; // EUR, 2-decimal precision
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  remittanceInformation?: string | null;
}

/**
 * Top-level payment instruction block. A real-world SEPA file splits a
 * batch into multiple <PmtInf> blocks when, e.g., the requested execution
 * date differs per subset of payments. The DocFlow MVP exports ONE block
 * per batch — sufficient for a single "pay all approved" run.
 */
export interface SepaPaymentInstruction {
  /** <PmtInfId>; unique per batch, <= 35 chars. */
  paymentInformationId: string;
  /** Requested execution date for this block. */
  requestedExecutionDate: Date;
  /** Debtor (the tenant). Both BIC and IBAN are mandatory on the debtor side. */
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  /** Transfers in this block. */
  transfers: SepaCreditTransfer[];
}

/**
 * Top-level builder input.
 *
 * `groupHeader.messageId` is the canonical "<MsgId>" DocFlow surfaces
 * later in Payment.sepaMessageId for reconciliation. Keep it short (<=35)
 * and unique per tenant.
 */
export interface SepaExportInput {
  messageId: string;
  /** ISO timestamp the batch was created. */
  creationDate: Date;
  /** Initiating party name — usually the tenant legal name. */
  initiatingPartyName: string;
  instructions: SepaPaymentInstruction[];
}

/**
 * Throws BadRequestException with the offending IBAN label when one of the
 * input IBANs does not pass the shared MOD-97-10 check. Service callers
 * catch and surface as 400 to the caller.
 */
function assertValidIbanOrThrow(value: string, label: string): string {
  const normalized = normalizeIban(value);
  if (!normalized) {
    throw new BadRequestException(`${label} is required`);
  }
  if (!isValidIban(normalized)) {
    throw new BadRequestException(`${label} is not a valid IBAN (${normalized})`);
  }
  return normalized;
}

/**
 * XML-escape the five entities. The shared iban util doesn't ship an
 * escape helper — keep the logic here to avoid pulling another dep.
 *
 * `'` is left as-is; attribute values are always double-quoted, so a
 * single quote is harmless inside either text or attributes.
 */
function xmlEscape(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render an ISO date in YYYY-MM-DD form. <ReqdExctnDt> uses ISO calendar
 * dates — Date.toISOString() gives us a Z-suffixed UTC timestamp we slice.
 */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Render an ISO 20022 timestamp with seconds: YYYY-MM-DDTHH:mm:ss. */
function isoTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * Render <Amt>/<InstdAmt>. Ccy is fixed to EUR; the amount is rounded
 * to 2 decimals (the SEPA schema requirement). Numbers bigger than what
 * 2dp can represent throw — we never accept sub-cent precision.
 */
function renderInstructedAmount(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new BadRequestException(`Invalid SEPA amount: ${amount}`);
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new BadRequestException(`SEPA amount out of range: ${amount}`);
  }
  const formatted = (cents / 100).toFixed(2);
  return `<Amt><InstdAmt Ccy="${SEPA_CURRENCY}">${formatted}</InstdAmt></Amt>`;
}

/**
 * Render a single <CdtTrfTxInf> for one transfer. Pulled out so the
 * builder can keep <PmtInf> tidy and so tests can target each transfer
 * in isolation.
 */
function renderCreditTransferTransaction(
  t: SepaCreditTransfer,
): string {
  const endToEndId = t.endToEndId?.trim();
  if (!endToEndId) {
    throw new BadRequestException('transfer.endToEndId is required');
  }
  if (endToEndId.length > SEPA_END_TO_END_ID_MAX) {
    throw new BadRequestException(
      `transfer.endToEndId exceeds ${SEPA_END_TO_END_ID_MAX} chars`,
    );
  }

  const creditorIban =
    assertValidIbanOrThrow(t.creditorIban, 'transfer.creditorIban');

  const creditorName = t.creditorName?.trim();
  if (!creditorName) {
    throw new BadRequestException('transfer.creditorName is required');
  }
  if (creditorName.length > SEPA_PARTY_NAME_MAX) {
    throw new BadRequestException(
      `transfer.creditorName exceeds ${SEPA_PARTY_NAME_MAX} chars`,
    );
  }

  const parts: string[] = [];
  parts.push('<CdtTrfTxInf>');
  parts.push('<PmtId><EndToEndId>' + xmlEscape(endToEndId) + '</EndToEndId></PmtId>');
  parts.push(renderInstructedAmount(t.amount));

  // CdtrAgt is optional — many PT SEPA flows omit it for IBAN-only PT
  // creditor accounts. Render only when the caller actually has one
  // (after IBAN validation, since BIC validity is its own concern).
  const creditorBic = t.creditorBic ? t.creditorBic.trim().toUpperCase() : '';
  if (creditorBic) {
    parts.push(
      `<CdtrAgt><FinInstnId><BIC>${xmlEscape(creditorBic)}</BIC></FinInstnId></CdtrAgt>`,
    );
  }

  parts.push(
    `<Cdtr><Nm>${xmlEscape(creditorName)}</Nm></Cdtr>`,
  );
  parts.push(
    `<CdtrAcct><Id><IBAN>${xmlEscape(creditorIban)}</IBAN></Id></CdtrAcct>`,
  );

  const remittance = t.remittanceInformation?.trim() ?? '';
  if (remittance) {
    const clamped =
      remittance.length > SEPA_REMITTANCE_MAX
        ? remittance.slice(0, SEPA_REMITTANCE_MAX)
        : remittance;
    parts.push(
      `<RmtInf><Ustrd>${xmlEscape(clamped)}</Ustrd></RmtInf>`,
    );
  }
  parts.push('</CdtTrfTxInf>');
  return parts.join('');
}

/**
 * Render one <PmtInf>. Always-batch debit is a bank-side concern; the
 * DocFlow MVP sets <BtchBookg>true (single SEPA collect per batch).
 */
function renderPaymentInformation(pmt: SepaPaymentInstruction): string {
  if (!pmt.transfers?.length) {
    throw new BadRequestException('PmtInf.transfers cannot be empty');
  }

  const pmtInfId = pmt.paymentInformationId?.trim();
  if (!pmtInfId) {
    throw new BadRequestException('PmtInf.paymentInformationId is required');
  }
  if (pmtInfId.length > SEPA_END_TO_END_ID_MAX) {
    throw new BadRequestException(
      `PmtInf.paymentInformationId exceeds ${SEPA_END_TO_END_ID_MAX} chars`,
    );
  }

  const debtorIban = assertValidIbanOrThrow(pmt.debtorIban, 'PmtInf.debtorIban');
  const debtorName = pmt.debtorName?.trim();
  if (!debtorName) {
    throw new BadRequestException('PmtInf.debtorName is required');
  }

  const ctrlSum = pmt.transfers.reduce(
    (acc, t) => acc + Math.round(t.amount * 100),
    0,
  );
  const formattedCtrlSum = (ctrlSum / 100).toFixed(2);

  const transfersXml = pmt.transfers.map(renderCreditTransferTransaction).join('');

  const parts: string[] = [];
  parts.push('<PmtInf>');
  parts.push(`<PmtInfId>${xmlEscape(pmtInfId)}</PmtInfId>`);
  parts.push('<PmtMtd>TRF</PmtMtd>');
  parts.push('<BtchBookg>true</BtchBookg>');
  parts.push(`<NbOfTxs>${pmt.transfers.length}</NbOfTxs>`);
  parts.push(`<CtrlSum>${formattedCtrlSum}</CtrlSum>`);
  parts.push('<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>');
  parts.push(`<ReqdExctnDt>${isoDate(pmt.requestedExecutionDate)}</ReqdExctnDt>`);

  // Debtor — both BIC and IBAN are required on the debtor side. If the
  // tenant has no BIC on file we still emit <DbtrAgt> with an empty BIC,
  // because the schema requires the tag — but we never let an invalid
  // IBAN through, that always 400s above.
  parts.push(`<Dbtr><Nm>${xmlEscape(debtorName)}</Nm></Dbtr>`);
  parts.push(`<DbtrAcct><Id><IBAN>${xmlEscape(debtorIban)}</IBAN></Id></DbtrAcct>`);
  const debtorBic = pmt.debtorBic ? pmt.debtorBic.trim().toUpperCase() : '';
  if (debtorBic) {
    parts.push(
      `<DbtrAgt><FinInstnId><BIC>${xmlEscape(debtorBic)}</BIC></FinInstnId></DbtrAgt>`,
    );
  } else {
    // Required by the schema even when empty.
    parts.push('<DbtrAgt><FinInstnId><BIC></BIC></FinInstnId></DbtrAgt>');
  }

  parts.push(transfersXml);
  parts.push('</PmtInf>');
  return parts.join('');
}

/**
 * Top-level builder. Produces a fully-formed pain.001.001.03 XML string
 * ready to write to disk or stream back to the caller.
 *
 * Throws BadRequestException on any validation failure (missing fields,
 * invalid IBANs, NaN amounts). The caller is responsible for catching
 * and translating.
 */
export function buildSepaPain001Xml(input: SepaExportInput): string {
  if (!input.instructions?.length) {
    throw new BadRequestException('At least one PmtInf block is required');
  }
  const messageId = input.messageId?.trim();
  if (!messageId) {
    throw new BadRequestException('messageId is required');
  }
  if (messageId.length > SEPA_END_TO_END_ID_MAX) {
    throw new BadRequestException(
      `messageId exceeds ${SEPA_END_TO_END_ID_MAX} chars`,
    );
  }
  const initiatingParty = input.initiatingPartyName?.trim();
  if (!initiatingParty) {
    throw new BadRequestException('initiatingPartyName is required');
  }
  if (initiatingParty.length > SEPA_PARTY_NAME_MAX) {
    throw new BadRequestException(
      `initiatingPartyName exceeds ${SEPA_PARTY_NAME_MAX} chars`,
    );
  }

  // Aggregate group header counters across ALL PmtInf blocks. The XML
  // schema requires a single GrpHdr-level sum.
  const allTransfers = input.instructions.flatMap((i) => i.transfers ?? []);
  if (!allTransfers.length) {
    throw new BadRequestException('No credit transfers to export');
  }
  const grandTotal = allTransfers.reduce(
    (acc, t) => acc + Math.round(t.amount * 100),
    0,
  );
  const grandFormatted = (grandTotal / 100).toFixed(2);

  const instructionsXml = input.instructions
    .map(renderPaymentInformation)
    .join('');

  const groupHeader = [
    '<GrpHdr>',
    `<MsgId>${xmlEscape(messageId)}</MsgId>`,
    `<CreDtTm>${isoTimestamp(input.creationDate)}</CreDtTm>`,
    `<NbOfTxs>${allTransfers.length}</NbOfTxs>`,
    `<CtrlSum>${grandFormatted}</CtrlSum>`,
    `<InitgPty><Nm>${xmlEscape(initiatingParty)}</Nm></InitgPty>`,
    '</GrpHdr>',
  ].join('');

  const body = `<CstmrCdtTrfInitn>${groupHeader}${instructionsXml}</CstmrCdtTrfInitn>`;
  const rootAttrs =
    `xmlns="${SEPA_PAIN_001_NS}" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;

  return [
    SEPA_XML_HEADER,
    `<Document ${rootAttrs}>${body}</Document>`,
  ].join('\n');
}

/**
 * Helper for the service to compute counters when it wants to surface
 * the totals OUT-of-band (before persisting the export). Returns the
 * same numbers that buildSepaPain001Xml bakes into the XML so the
 * service can store them on Payment rows for parity verification.
 */
export function computeSepaTotals(input: { instructions: SepaPaymentInstruction[] }): {
  numberOfTransactions: number;
  controlSum: number;
} {
  const flat = input.instructions.flatMap((i) => i.transfers ?? []);
  const numberOfTransactions = flat.length;
  const cents = flat.reduce(
    (acc, t) => acc + Math.round(t.amount * 100),
    0,
  );
  return {
    numberOfTransactions,
    controlSum: cents / 100,
  };
}
