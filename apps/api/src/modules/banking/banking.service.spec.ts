import { ConflictException, BadRequestException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { BankingService } from './banking.service';
import { computeFileHash, computeRowHash } from './csv-parser.util';
import { PreviewCsvDto, ImportCsvDto, ImportCamtDto } from './dto/banking.dto';

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

describe('BankingService — CSV import (H-08)', () => {
  function buildPrismaStub() {
    const rows: any[] = [];
    let rowCounter = 0;
    const bankTransaction: any = {
      findFirst: jest.fn(async ({ where }: any) => {
        // File-level dedup: a row whose importHash matches the file hash.
        return (
          rows.find(
            (r) => r.tenantId === where?.tenantId && r.importHash === where?.importHash,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.importHash?.in) {
          const set = new Set(where.importHash.in);
          return rows.filter(
            (r) => r.tenantId === where.tenantId && set.has(r.importHash),
          );
        }
        return [];
      }),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        // H-08: with skipDuplicates, simulate the @@unique gate — the
        // first concurrent caller wins; the second caller's data
        // silently drops dupes by importHash.
        let count = 0;
        for (const d of data) {
          const dupe = rows.find(
            (r) => r.tenantId === d.tenantId && r.importHash === d.importHash,
          );
          if (dupe) {
            if (!skipDuplicates) throw new Error('unique violation');
            continue;
          }
          rows.push({ id: `bt-${++rowCounter}`, ...d });
          count += 1;
        }
        return { count };
      }),
    };
    const csvTemplate: any = {
      upsert: jest.fn(async () => ({ id: 'tpl-1' })),
    };
    const audit: any = {
      log: jest.fn(async () => undefined),
      logInTx: jest.fn(async () => undefined),
    };
    const prisma: any = {
      bankTransaction,
      csvTemplate,
      audit,
      $transaction: jest.fn(async (work: any) => {
        // Pass the same model mocks into the tx callback so the
        // service's writes are visible to subsequent reads.
        return work({ bankTransaction, csvTemplate, audit });
      }),
    };
    return { prisma, rows, bankTransaction, csvTemplate, audit };
  }

  it('H-08: races two identical CSV imports — only one wins, the other reports zero imported', async () => {
    const { prisma, rows } = buildPrismaStub();
    const svc = new BankingService(prisma as any, prisma.audit as any);

    const csv =
      'Data;Descrição;Valor;Saldo;Referência\n' +
      '15/03/2026;EDP Comercial;-45,90;1234,56;REF-1\n' +
      '16/03/2026;Fornecedor X;-120,00;1114,56;REF-2';

    // Compute the per-row hashes the service will compute.
    const fileHash = computeFileHash(csv);
    expect(fileHash).toHaveLength(64);

    // Race two identical imports.
    const dto = new ImportCsvDto();
    dto.mapping = {
      date: 'Data',
      description: 'Descrição',
      amount: 'Valor',
      balance: 'Saldo',
      reference: 'Referência',
    };
    dto.dateFormat = 'DD/MM/YYYY';
    dto.decimalSep = ',';
    dto.thousandSep = '.';
    dto.hasHeader = true;

    const [a, b] = await Promise.all([
      svc.importCsv(TENANT_ID, USER_ID, csv, dto),
      svc.importCsv(TENANT_ID, USER_ID, csv, dto),
    ]);

    // Exactly one import should report imported=2; the other should
    // either reject with ConflictException OR report imported=0 (the
    // service's existing file-level dedup will throw on the second
    // call, which is also acceptable — the point is: not both succeed).
    const successes = [a, b].filter((r) => r.imported === 2);
    expect(successes.length).toBe(1);

    // The DB only ever holds two rows, regardless of which side won.
    const persistedForFile = rows.filter((r) => r.importHash !== fileHash);
    expect(persistedForFile.length).toBe(2);
  });
});

describe('BankingService CAMT.053 direction and counterparty', () => {
  it('stores DBIT as negative creditor and CRDT as positive debtor without Number conversion', async () => {
    const rows: any[] = [];
    const bankTransaction = {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async ({ data }: any) => {
        rows.push(...data);
        return { count: data.length };
      }),
    };
    const audit = {
      log: jest.fn(async () => undefined),
      logInTx: jest.fn(async () => undefined),
    };
    const prisma: any = {
      bankTransaction,
      $transaction: jest.fn(async (work: any) => work({ bankTransaction })),
    };
    const svc = new BankingService(prisma, audit as any);
    const dto = new ImportCamtDto();
    dto.xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">45.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-15</Dt></BookgDt>
    <TxDtls><RltdPties><Cdtr><Nm>Fornecedor DBIT</Nm></Cdtr><CdtrAcct><Id><IBAN>PT50000201231234567890154</IBAN></Id></CdtrAcct></RltdPties></TxDtls>
  </Ntry>
  <Ntry><Amt Ccy="EUR">123.456789012345678</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-16</Dt></BookgDt>
    <TxDtls><RltdPties><Dbtr><Nm>Cliente CRDT</Nm></Dbtr><DbtrAcct><Id><IBAN>PT50000201231234567890155</IBAN></Id></DbtrAcct></RltdPties></TxDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

    await svc.importCamt(TENANT_ID, USER_ID, dto);

    expect(rows).toHaveLength(2);
    expect(rows[0].amount.toString()).toBe('-45.9');
    expect(rows[0].counterpartyName).toBe('Fornecedor DBIT');
    expect(rows[0].counterpartyIban).toBe('PT50000201231234567890154');
    expect(rows[1].amount.toString()).toBe('123.456789012345678');
    expect(rows[1].counterpartyName).toBe('Cliente CRDT');
    expect(rows[1].counterpartyIban).toBe('PT50000201231234567890155');
  });
});

describe('BankingService.previewCsv — BUG 4 (was 500, now 400)', () => {
  function buildPrismaStub() {
    const audit = { log: jest.fn(async () => undefined), logInTx: jest.fn() };
    const prisma: any = {
      bankTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
      csvTemplate: { upsert: jest.fn() },
      audit,
      $transaction: jest.fn(),
    };
    return { prisma, audit };
  }

  const csv =
    'Data;Valor;Descricao\n' +
    '15/03/2026;-45,90;EDP\n' +
    '16/03/2026;1500,00;Cliente X\n' +
    '17/03/2026;-200,00;Multibanco';

  function makeDto(overrides: Record<string, unknown>): PreviewCsvDto {
    const dto = new PreviewCsvDto();
    Object.assign(dto, overrides);
    return dto;
  }

  it('throws BadRequestException (not 500) when mapping is empty — BUG 4', () => {
    const { prisma } = buildPrismaStub();
    const svc = new BankingService(prisma, prisma.audit);
    // BEFORE the fix this returned HTTP 500 with
    //   TypeError: Cannot read properties of undefined (reading 'date')
    // AFTER the fix it throws BadRequestException with a helpful message.
    expect(() => svc.previewCsv(csv, makeDto({}))).toThrow(BadRequestException);
  });

  it('throws BadRequestException when mapping has wrong column names — BUG 4', () => {
    const { prisma } = buildPrismaStub();
    const svc = new BankingService(prisma, prisma.audit);
    expect(() =>
      svc.previewCsv(
        csv,
        makeDto({
          mapping: { date: 'WRONG', description: 'Descricao', amount: 'Valor' },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('returns the first 20 parsed rows when mapping is valid (regression — happy path)', () => {
    const { prisma } = buildPrismaStub();
    const svc = new BankingService(prisma, prisma.audit);
    const out = svc.previewCsv(
      csv,
      makeDto({
        mapping: { date: 'Data', description: 'Descricao', amount: 'Valor' },
        dateFormat: 'DD/MM/YYYY',
        decimalSep: ',',
      }),
    );
    expect(out.preview).toHaveLength(3);
    expect(out.totalRows).toBe(3);
    expect(out.errors).toHaveLength(0);
    expect(out.preview[0]!.date).toBe('2026-03-15');
    expect(out.preview[0]!.amount).toBeCloseTo(-45.9);
  });

  it('folds flat *Column fields into the mapping (BUG 4 — OpenAPI flat shape)', () => {
    const { prisma } = buildPrismaStub();
    const svc = new BankingService(prisma, prisma.audit);
    const out = svc.previewCsv(
      csv,
      makeDto({
        dateColumn: 'Data',
        amountColumn: 'Valor',
        descriptionColumn: 'Descricao',
        dateFormat: 'DD/MM/YYYY',
        decimalSep: ',',
      }),
    );
    // Before the fix this exact shape crashed with HTTP 500.
    expect(out.preview).toHaveLength(3);
    expect(out.totalRows).toBe(3);
    expect(out.errors).toHaveLength(0);
  });
});
