import { test, expect } from '@playwright/test';
import { Api, CSV_MAPPING, csvStatement, minimalPdf, uploadDocument } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif } from '../helpers/pt-ids';
import { recordPerf } from '../helpers/perf';

test.describe('Performance baselines @perf', () => {
  test('login < 500ms, 10MB upload < 3s, CSV 10k < 10s, matching < 5s, SEPA < 2s @perf', async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const api = new Api(request);
    const admin = await api.registerTenant();

    const login = await api.timed('POST', '/auth/login', 500, {
      data: {
        email: admin.email,
        password: admin.password,
        tenantSlug: admin.tenantSlug,
      },
    });
    expect(login.status).toBe(200);

    const token = admin.tokens.accessToken;
    const big = minimalPdf(10 * 1024 * 1024, 'perf-10mb');
    const upload = await uploadDocument(
      token,
      { buffer: big, filename: 'big.pdf', mimeType: 'application/pdf' },
      { origin: 'UPLOAD' },
    );
    const uploadMs = upload.ms;
    recordPerf({
      endpoint: '/documents/upload',
      method: 'POST',
      ms: uploadMs,
      budgetMs: 3000,
      ok: uploadMs < 3000 && upload.status === 201,
      status: upload.status,
    });
    expect(upload.status).toBe(201);

    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      date: '15/03/2026',
      description: `MOV ${String(i).padStart(5, '0')} FORNECEDOR`,
      amount: i % 2 === 0 ? '-12,34' : '45,00',
      reference: `REF-${i}`,
    }));
    const csv = csvStatement(rows);
    const startedCsv = Date.now();
    const imported = await api.json('POST', '/banking/csv/import', {
      token,
      data: {
        content: csv,
        mapping: CSV_MAPPING,
        dateFormat: 'DD/MM/YYYY',
        decimalSep: ',',
        thousandSep: '.',
        hasHeader: true,
      },
      timeout: 60_000,
    });
    const csvMs = Date.now() - startedCsv;
    recordPerf({
      endpoint: '/banking/csv/import',
      method: 'POST',
      ms: csvMs,
      budgetMs: 10_000,
      ok: csvMs < 10_000 && imported.status === 200,
      status: imported.status,
    });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 500)).toBe(200);

    const vendor = await api.data<{ id: string }>(
      'POST',
      '/parties',
      {
        token,
        data: {
          type: 'FORNECEDOR',
          name: 'Perf Vendor',
          nif: makeNif(),
          iban: FIXTURE_IBAN_CREDITOR,
        },
      },
      201,
    );
    const payable = await api.data<{ id: string }>(
      'POST',
      '/payments/payables',
      {
        token,
        data: {
          description: 'Perf payable',
          amount: 12.34,
          dueDate: '2026-03-15',
          partyId: vendor.id,
        },
      },
      201,
    );
    await api.data('POST', `/payments/payables/${payable.id}/approve`, {
      token,
      data: { note: 'perf' },
    });

    const matching = await api.timed('POST', '/reconciliation/run', 5000, { token });
    expect(matching.status).toBe(200);

    const sepaStart = Date.now();
    const sepa = await api.raw('POST', '/payments/sepa/export', {
      token,
      data: { payableIds: [payable.id] },
    });
    const sepaMs = Date.now() - sepaStart;
    recordPerf({
      endpoint: '/payments/sepa/export',
      method: 'POST',
      ms: sepaMs,
      budgetMs: 2000,
      ok: sepaMs < 2000 && sepa.status() === 200,
      status: sepa.status(),
    });
    expect(sepa.status()).toBe(200);

    const listDocs = await api.data<{
      items: unknown[];
      meta: { limit: number; page: number };
    }>('GET', '/documents?page=1&limit=20', { token });
    expect(listDocs.meta.limit).toBe(20);
    expect(listDocs.items.length).toBeLessThanOrEqual(20);

    const listTx = await api.data<{ items: unknown[]; meta: { limit: number } }>(
      'GET',
      '/banking/transactions?page=1&limit=50',
      { token },
    );
    expect(listTx.items.length).toBeLessThanOrEqual(50);
  });
});
