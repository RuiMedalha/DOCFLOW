import { BadRequestException } from '@nestjs/common';
import {
  buildSepaPain001Xml,
  computeSepaTotals,
  SEPA_CURRENCY,
  SEPA_PAIN_001_NS,
  SEPA_REMITTANCE_MAX,
  SEPA_XML_HEADER,
  SepaExportInput,
} from './iso20022-sepa.builder';

/**
 * Tests for the SEPA pain.001.001.03 builder.
 *
 * Coverage:
 *   - Well-formed XML declaration + Document root with the correct ISO
 *     20022 namespace.
 *   - GrpHdr fields (MsgId, CreDtTm, NbOfTxs, CtrlSum, InitgPty/Nm).
 *   - PmtInf block per instruction (PmtInfId, PmtMtd=TRF, BtchBookg,
 *     PmtTpInf/SvcLvl/Cd=SEPA, ReqdExctnDt, Dbtr, DbtrAcct/IBAN,
 *     DbtrAgt/BIC).
 *   - CdtTrfTxInf fields (PmtId/EndToEndId, Amt/InstdAmt, Cdtr/Nm,
 *     CdtrAcct/IBAN, optional RmtInf/Ustrd).
 *   - IBAN validation: invalid IBAN → 400, valid IBAN passes through.
 *   - Totals (NbOfTxs, CtrlSum) match the input arithmetic.
 *   - XML-escape does not double-escape ampersands inside remittance.
 *
 * PT IBAN used throughout: PT50000201231234567890154 — passes MOD-97-10
 * (it's the canonical "valid Portuguese IBAN" fixture from the @docflow/shared
 * test corpus). When the suite runs in a real PT environment, change to
 * a real bank IBAN; for unit testing this synthetic one is fine.
 */

const VALID_PT_IBAN = 'PT50000201231234567890154';
const VALID_DEBTOR_IBAN = 'PT77003506510000000000739';
const VALID_PT_BIC = 'BCOMPTPL';

const baseInput = (overrides: Partial<SepaExportInput> = {}): SepaExportInput => ({
  messageId: 'MSG-TEST-0001',
  creationDate: new Date('2026-08-30T10:00:00Z'),
  initiatingPartyName: 'DocFlow Demo Lda',
  instructions: [
    {
      paymentInformationId: 'PMT-TEST-0001',
      requestedExecutionDate: new Date('2026-09-02'),
      debtorName: 'DocFlow Demo Lda',
      debtorIban: VALID_DEBTOR_IBAN,
      debtorBic: VALID_PT_BIC,
      transfers: [
        {
          endToEndId: 'payable-1',
          amount: 1234.56,
          creditorName: 'EDP Comercial SA',
          creditorIban: VALID_PT_IBAN,
          creditorBic: null,
          remittanceInformation: 'Fatura FT 2026/123',
        },
        {
          endToEndId: 'payable-2',
          amount: 250.0,
          creditorName: 'NOS Comunicações SA',
          creditorIban: VALID_PT_IBAN,
          creditorBic: VALID_PT_BIC,
          remittanceInformation: null,
        },
      ],
    },
  ],
  ...overrides,
});

describe('SEPA pain.001.001.03 builder', () => {
  it('produces a well-formed XML with the ISO 20022 namespace and root', () => {
    const xml = buildSepaPain001Xml(baseInput());
    expect(xml.startsWith(SEPA_XML_HEADER)).toBe(true);
    expect(xml).toContain(`xmlns="${SEPA_PAIN_001_NS}"`);
    expect(xml).toContain('<Document');
    expect(xml).toContain('</Document>');
    expect(xml).toContain('<CstmrCdtTrfInitn>');
    expect(xml).toContain('</CstmrCdtTrfInitn>');
  });

  it('renders the GrpHdr with correct counts and totals', () => {
    const xml = buildSepaPain001Xml(baseInput());
    // 2 transfers × (1234.56 + 250.00) = 1484.56
    expect(xml).toContain('<MsgId>MSG-TEST-0001</MsgId>');
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>1484.56</CtrlSum>');
    expect(xml).toContain('<CreDtTm>2026-08-30T10:00:00</CreDtTm>');
    expect(xml).toContain('<InitgPty><Nm>DocFlow Demo Lda</Nm></InitgPty>');
  });

  it('renders the PmtInf block with TRF, SEPA service level and execution date', () => {
    const xml = buildSepaPain001Xml(baseInput());
    expect(xml).toContain('<PmtInfId>PMT-TEST-0001</PmtInfId>');
    expect(xml).toContain('<PmtMtd>TRF</PmtMtd>');
    expect(xml).toContain('<BtchBookg>true</BtchBookg>');
    expect(xml).toContain('<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>');
    expect(xml).toContain('<ReqdExctnDt>2026-09-02</ReqdExctnDt>');
    expect(xml).toContain('<Dbtr><Nm>DocFlow Demo Lda</Nm></Dbtr>');
    expect(xml).toContain(`<IBAN>${VALID_DEBTOR_IBAN}</IBAN>`);
    expect(xml).toContain(`<BIC>${VALID_PT_BIC}</BIC>`);
  });

  it('renders each CdtTrfTxInf with the canonical ISO 20022 fields', () => {
    const xml = buildSepaPain001Xml(baseInput());

    expect(xml).toContain('<EndToEndId>payable-1</EndToEndId>');
    expect(xml).toContain('<EndToEndId>payable-2</EndToEndId>');

    // Amount is rendered as a fixed 2-decimal string in EUR.
    expect(xml).toContain(`<InstdAmt Ccy="${SEPA_CURRENCY}">1234.56</InstdAmt>`);
    expect(xml).toContain(`<InstdAmt Ccy="${SEPA_CURRENCY}">250.00</InstdAmt>`);

    // Creditor name + IBAN appear once per transfer.
    expect(xml).toContain('<Cdtr><Nm>EDP Comercial SA</Nm></Cdtr>');
    expect(xml).toContain('<Cdtr><Nm>NOS Comunicações SA</Nm></Cdtr>');
    expect(xml).toContain(`<IBAN>${VALID_PT_IBAN}</IBAN>`);

    // Optional CdtrAgt is omitted when no BIC is supplied.
    // First transfer has creditorBic=null → no <CdtrAgt>.
    expect(xml).not.toContain('<CdtrAgt><FinInstnId><BIC></BIC></FinInstnId></CdtrAgt>');
    // Second transfer has creditorBic=VALID_PT_BIC → present.
    expect(xml).toContain(`<CdtrAgt><FinInstnId><BIC>${VALID_PT_BIC}</BIC></FinInstnId></CdtrAgt>`);

    // RmtInf present only when supplied.
    expect(xml).toContain('<RmtInf><Ustrd>Fatura FT 2026/123</Ustrd></RmtInf>');
  });

  it('clamps remittance information to the SEPA 140-char cap', () => {
    const longRemittance = 'X'.repeat(SEPA_REMITTANCE_MAX + 50);
    const xml = buildSepaPain001Xml(
      baseInput({
        instructions: [
          {
            ...baseInput().instructions[0],
            transfers: [
              {
                endToEndId: 'payable-1',
                amount: 100,
                creditorName: 'EDP Comercial SA',
                creditorIban: VALID_PT_IBAN,
                remittanceInformation: longRemittance,
              },
            ],
          },
        ],
      }),
    );
    expect(xml).toContain(`<Ustrd>${'X'.repeat(SEPA_REMITTANCE_MAX)}</Ustrd>`);
    expect(xml).not.toContain('X'.repeat(SEPA_REMITTANCE_MAX + 1));
  });

  it('escapes XML-special characters in fields', () => {
    const xml = buildSepaPain001Xml(
      baseInput({
        initiatingPartyName: 'Acme & Co <test>',
        instructions: [
          {
            paymentInformationId: 'PMT-TEST-0002',
            requestedExecutionDate: new Date('2026-09-02'),
            debtorName: 'DocFlow "Demo" Lda',
            debtorIban: VALID_DEBTOR_IBAN,
            debtorBic: null,
            transfers: [
              {
                endToEndId: 'payable-1',
                amount: 100,
                creditorName: 'Vendor & Sons',
                creditorIban: VALID_PT_IBAN,
                remittanceInformation: 'Quote: "abc&def"',
              },
            ],
          },
        ],
      }),
    );
    expect(xml).toContain('<Nm>Acme &amp; Co &lt;test&gt;</Nm>');
    expect(xml).toContain('<Nm>DocFlow &quot;Demo&quot; Lda</Nm>');
    expect(xml).toContain('<Nm>Vendor &amp; Sons</Nm>');
    expect(xml).toContain('<Ustrd>Quote: &quot;abc&amp;def&quot;</Ustrd>');
  });

  it('throws BadRequest when a creditor IBAN fails MOD-97-10 validation', () => {
    expect(() =>
      buildSepaPain001Xml(
        baseInput({
          instructions: [
            {
              ...baseInput().instructions[0],
              transfers: [
                {
                  endToEndId: 'payable-1',
                  amount: 100,
                  creditorName: 'Bad IBAN Vendor',
                  creditorIban: 'PT50AAAA00000000000000000', // not MOD-97 valid
                  remittanceInformation: null,
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequest when the debtor IBAN fails MOD-97-10 validation', () => {
    expect(() =>
      buildSepaPain001Xml(
        baseInput({
          instructions: [
            {
              ...baseInput().instructions[0],
              debtorIban: 'PT50ZZZZ00000000000000000',
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequest when the input has no transfers', () => {
    expect(() =>
      buildSepaPain001Xml(
        baseInput({
          instructions: [
            {
              paymentInformationId: 'PMT-empty',
              requestedExecutionDate: new Date('2026-09-02'),
              debtorName: 'DocFlow Demo Lda',
              debtorIban: VALID_DEBTOR_IBAN,
              debtorBic: null,
              transfers: [],
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequest when messageId is missing', () => {
    expect(() => buildSepaPain001Xml(baseInput({ messageId: '' }))).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequest when initiatingPartyName is missing', () => {
    expect(() =>
      buildSepaPain001Xml(baseInput({ initiatingPartyName: '' })),
    ).toThrow(BadRequestException);
  });

  it('computeSepaTotals mirrors the totals in the rendered XML', () => {
    const input = baseInput();
    const totals = computeSepaTotals({ instructions: input.instructions });
    expect(totals.numberOfTransactions).toBe(2);
    expect(totals.controlSum).toBeCloseTo(1484.56, 2);
  });

  it('emits an empty <DbtrAgt> when the tenant has no BIC', () => {
    const xml = buildSepaPain001Xml(
      baseInput({
        instructions: [
          {
            ...baseInput().instructions[0],
            debtorBic: null,
          },
        ],
      }),
    );
    expect(xml).toContain('<DbtrAgt><FinInstnId><BIC></BIC></FinInstnId></DbtrAgt>');
  });
});
