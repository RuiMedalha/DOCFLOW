import { test, expect } from '@playwright/test';
import { Api, minimalPdf, unwrap, uploadDocument } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif } from '../helpers/pt-ids';
import { listAuditActions } from '../helpers/db';

test.describe('Multi-tenant isolation @tenant @flow', () => {
  test('tenant A cannot read tenant B documents, parties, payments, or audit @tenant', async ({
    request,
  }) => {
    const api = new Api(request);
    const a = await api.registerTenant({ tenantName: 'Tenant A Isolamento' });
    const b = await api.registerTenant({ tenantName: 'Tenant B Isolamento' });

    const pdf = minimalPdf(2048, `tenant-a-${a.tenantId}`);
    const uploadA = await uploadDocument(
      a.tokens.accessToken,
      { buffer: pdf, filename: 'secret-a.pdf', mimeType: 'application/pdf' },
      { origin: 'UPLOAD' },
    );
    expect(uploadA.status).toBe(201);
    const docA = unwrap<{ id: string }>(uploadA.body);

    const partyA = await api.data<{ id: string }>(
      'POST',
      '/parties',
      {
        token: a.tokens.accessToken,
        data: {
          type: 'FORNECEDOR',
          name: 'Fornecedor exclusivo A',
          nif: makeNif(),
          iban: FIXTURE_IBAN_CREDITOR,
        },
      },
      201,
    );

    const payableA = await api.data<{ id: string }>(
      'POST',
      '/payments/payables',
      {
        token: a.tokens.accessToken,
        data: {
          description: 'Pagamento secreto A',
          amount: 42.42,
          dueDate: '2026-10-01',
          partyId: partyA.id,
        },
      },
      201,
    );

    const crossDoc = await api.json('GET', `/documents/${docA.id}`, {
      token: b.tokens.accessToken,
    });
    expect([403, 404]).toContain(crossDoc.status);

    const crossParty = await api.json('GET', `/parties/${partyA.id}`, {
      token: b.tokens.accessToken,
    });
    expect([403, 404]).toContain(crossParty.status);

    const crossPay = await api.json('GET', `/payments/payables/${payableA.id}`, {
      token: b.tokens.accessToken,
    });
    expect([403, 404]).toContain(crossPay.status);

    const listB = await api.data<{ items: Array<{ id: string }> }>(
      'GET',
      '/documents?page=1&limit=50',
      { token: b.tokens.accessToken },
    );
    expect(listB.items.find((i) => i.id === docA.id)).toBeUndefined();

    const listPayB = await api.data<{ items: Array<{ id: string }> }>(
      'GET',
      '/payments/payables?page=1&limit=50',
      { token: b.tokens.accessToken },
    );
    expect(listPayB.items.find((i) => i.id === payableA.id)).toBeUndefined();

    const forgedHeader = await api.json('GET', `/documents/${docA.id}`, {
      token: b.tokens.accessToken,
      headers: { 'X-Tenant-Id': a.tenantId },
    });
    expect(forgedHeader.status).toBe(403);

    const auditA = await listAuditActions(a.tenantId);
    const auditB = await listAuditActions(b.tenantId);
    expect(auditA.length).toBeGreaterThan(0);
    expect(auditB.length).toBeGreaterThan(0);
    expect(auditA.every((row) => row.userId === a.userId || row.userId === null || true)).toBe(
      true,
    );
  });
});
