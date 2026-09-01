import { test, expect } from '@playwright/test';
import { Api, CSV_MAPPING, csvStatement, unwrap, uploadDocument } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif } from '../helpers/pt-ids';
import { listAuditActions } from '../helpers/db';

test.describe('Bank reconciliation full loop @flow', () => {
  test('CSV import → STRONG match → accept/reject → no duplicate matches @flow @audit', async ({
    request,
  }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const token = admin.tokens.accessToken;

    const vendor = await api.data<{ id: string }>(
      'POST',
      '/parties',
      {
        token,
        data: {
          type: 'FORNECEDOR',
          name: 'EDP Comercial SA',
          nif: makeNif(),
          iban: FIXTURE_IBAN_CREDITOR,
        },
      },
      201,
    );

    const pdf = Buffer.from('%PDF-1.4\n% recon-e2e\n1 0 obj<<>>endobj\n%%EOF\n');
    const upload = await uploadDocument(
      token,
      { buffer: pdf, filename: 'ft-2026-555.pdf', mimeType: 'application/pdf' },
      { origin: 'UPLOAD', type: 'FATURA_RECEBIDA' },
    );
    expect(upload.status).toBe(201);
    const doc = unwrap<{ id: string }>(upload.body);

    await api.data('PATCH', `/documents/${doc.id}`, {
      token,
      data: {
        type: 'FATURA_RECEBIDA',
        supplier: 'EDP Comercial SA',
        docNumber: 'FT 2026/555',
        total: 250.5,
        dueDate: '2026-08-20',
        docDate: '2026-08-15',
      },
    });

    await api.data(
      'POST',
      '/payments/payables/from-document',
      {
        token,
        data: {
          documentId: doc.id,
          partyId: vendor.id,
          dueDate: '2026-08-20',
        },
      },
      201,
    );

    const csv = csvStatement([
      {
        date: '20/08/2026',
        description: 'PAG FT 2026/555 EDP COMERCIAL',
        amount: '-250,50',
        reference: 'FT 2026/555',
      },
      {
        date: '21/08/2026',
        description: 'TRF SALARIO NAO RELACIONADO',
        amount: '-900,00',
        reference: 'SAL-001',
      },
    ]);

    const imported = await api.data<{
      imported: number;
      skippedDuplicates?: number;
    }>('POST', '/banking/csv/import', {
      token,
      data: {
        content: csv,
        mapping: CSV_MAPPING,
        dateFormat: 'DD/MM/YYYY',
        decimalSep: ',',
        thousandSep: '.',
        hasHeader: true,
        saveAsTemplate: 'Millennium E2E',
      },
    });
    expect(imported.imported).toBeGreaterThanOrEqual(1);

    const txs = await api.data<{
      items: Array<{ id: string; amount: number | string; reference: string | null }>;
      meta: { total: number; limit: number };
    }>('GET', '/banking/transactions?page=1&limit=50', { token });
    expect(txs.items.length).toBeGreaterThanOrEqual(1);
    expect(txs.items.length).toBeLessThanOrEqual(txs.meta.limit);

    const run1 = await api.data<{
      scannedTransactions: number;
      suggestionsCreated: number;
      byType: { STRONG: number; MEDIUM: number; WEAK: number };
    }>('POST', '/reconciliation/run', { token });
    expect(run1.scannedTransactions).toBeGreaterThanOrEqual(1);

    const pending = await api.data<{
      items: Array<{
        id: string;
        matchType: string;
        score: number;
        status: string;
        bankTransaction: { id: string };
      }>;
    }>('GET', '/reconciliation/suggestions?status=PENDING&limit=50', { token });
    expect(pending.items.length).toBeGreaterThanOrEqual(1);

    const strong = pending.items.find((s) => s.matchType === 'STRONG') ?? pending.items[0];
    expect(strong).toBeTruthy();
    expect(['STRONG', 'MEDIUM', 'WEAK']).toContain(strong.matchType);

    const accepted = await api.data<{ accepted: true; bankTransactionId: string }>(
      'POST',
      `/reconciliation/suggestions/${strong.id}/accept`,
      { token },
    );
    expect(accepted.accepted).toBe(true);

    const leftover = pending.items.find((s) => s.id !== strong.id);
    if (leftover) {
      const rejected = await api.data<{ rejected: true }>(
        'POST',
        `/reconciliation/suggestions/${leftover.id}/reject`,
        { token },
      );
      expect(rejected.rejected).toBe(true);
    }

    const run2 = await api.data<{ suggestionsCreated: number }>('POST', '/reconciliation/run', {
      token,
    });
    expect(run2.suggestionsCreated).toBe(0);

    const acceptedList = await api.data<{
      items: Array<{ id: string; status: string }>;
    }>('GET', '/reconciliation/suggestions?status=ACCEPTED', { token });
    const acceptedIds = acceptedList.items.map((i) => i.id);
    expect(new Set(acceptedIds).size).toBe(acceptedIds.length);

    const audit = await listAuditActions(admin.tenantId);
    const actions = audit.map((a) => a.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.createdAt instanceof Date)).toBe(true);
  });
});
