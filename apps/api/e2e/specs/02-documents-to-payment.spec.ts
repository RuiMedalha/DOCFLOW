import { test, expect } from '@playwright/test';
import { Api, minimalPdf, unwrap, uploadDocument } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, SAMPLE_QR_AT, makeNif, uniqueSlug } from '../helpers/pt-ids';

test.describe('Document upload → extract → verify → payable @flow', () => {
  test('upload PDF, apply AT-QR, manual verify, generate payable @flow', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const token = admin.tokens.accessToken;

    const vendor = await api.data<{ id: string; nif: string; iban: string }>(
      'POST',
      '/parties',
      {
        token,
        data: {
          type: 'FORNECEDOR',
          name: 'Fornecedor QR AT Lda',
          nif: makeNif(),
          iban: FIXTURE_IBAN_CREDITOR,
          paymentTermDays: 30,
        },
      },
      201,
    );
    expect(vendor.id).toBeTruthy();
    expect(vendor.iban.replace(/\s/g, '')).toBe(FIXTURE_IBAN_CREDITOR);

    const pdf = minimalPdf(4096, uniqueSlug('pdf'));
    const upload = await uploadDocument(
      token,
      { buffer: pdf, filename: 'fatura-qr.pdf', mimeType: 'application/pdf' },
      { origin: 'UPLOAD', type: 'FATURA_RECEBIDA' },
    );
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const doc = unwrap<{ id: string; status: string; fileName: string }>(upload.body);
    expect(doc.id).toBeTruthy();
    expect(doc.status).toBe('NOVO');

    const qr = await api.json('POST', `/extraction/documents/${doc.id}/at-qr`, {
      token,
      data: { qrText: SAMPLE_QR_AT },
    });
    expect(qr.status, JSON.stringify(qr.body)).toBe(200);

    const afterQr = await api.data<{
      id: string;
      status: string;
      total: number | string | null;
      docNumber: string | null;
      supplierNif: string | null;
    }>('GET', `/documents/${doc.id}`, { token });
    expect(afterQr.status).toBe('EM_REVISAO');
    expect(Number(afterQr.total)).toBeCloseTo(123, 2);
    expect(afterQr.docNumber).toMatch(/FT2026\/1/);

    const verified = await api.data<{ status: string }>('PATCH', `/documents/${doc.id}`, {
      token,
      data: {
        status: 'APROVADO',
        type: 'FATURA_RECEBIDA',
        dueDate: '2026-09-30',
        supplier: 'Fornecedor QR AT Lda',
      },
    });
    expect(verified.status).toBe('APROVADO');

    await api.data('PATCH', `/documents/${doc.id}`, {
      token,
      data: { supplier: 'Fornecedor QR AT Lda' },
    });

    const payable = await api.data<{
      id: string;
      amount: number | string;
      status: string;
      documentId: string;
    }>(
      'POST',
      '/payments/payables/from-document',
      {
        token,
        data: {
          documentId: doc.id,
          partyId: vendor.id,
          dueDate: '2026-09-30',
        },
      },
      201,
    );
    expect(payable.documentId).toBe(doc.id);
    expect(Number(payable.amount)).toBeCloseTo(123, 2);
    expect(payable.status).toBe('TO_PAY');
  });

  test('image upload is accepted and listed in inbox pagination @flow', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = await uploadDocument(
      admin.tokens.accessToken,
      { buffer: png, filename: 'scan.png', mimeType: 'image/png' },
      { origin: 'UPLOAD' },
    );
    expect(upload.status).toBe(201);

    const inbox = await api.data<{
      items: unknown[];
      meta: { page: number; limit: number; total: number };
    }>('GET', '/documents/inbox?page=1&limit=20', { token: admin.tokens.accessToken });
    expect(inbox.meta.page).toBe(1);
    expect(inbox.meta.limit).toBeLessThanOrEqual(20);
    expect(inbox.items.length).toBeGreaterThanOrEqual(1);
    expect(inbox.items.length).toBeLessThanOrEqual(inbox.meta.limit);
  });
});
