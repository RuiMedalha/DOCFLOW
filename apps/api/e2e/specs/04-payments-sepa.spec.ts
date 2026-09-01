import { test, expect } from '@playwright/test';
import { Api } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, FIXTURE_IBAN_DEBTOR, makeNif } from '../helpers/pt-ids';
import { payableAmountAsString } from '../helpers/db';

test.describe('Payment scheduling & SEPA export @flow', () => {
  test('one-off + recurring schedules, approve, export valid pain.001 XML @flow', async ({
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
          name: 'NOS Comunicações SA',
          nif: makeNif(),
          iban: FIXTURE_IBAN_CREDITOR,
          bic: 'BCOMPTPL',
        },
      },
      201,
    );

    const oneOff = await api.data<{ id: string; recurring: boolean }>(
      'POST',
      '/payments/schedule',
      {
        token,
        data: {
          title: 'Seguro frota (único)',
          amount: 410.1,
          dueDate: '2026-09-15',
          paymentMethod: 'sepa',
          partyId: vendor.id,
          recurring: false,
        },
      },
      201,
    );
    expect(oneOff.id).toBeTruthy();

    const recurring = await api.data<{ id: string; recurring: boolean; recurrenceType?: string }>(
      'POST',
      '/payments/schedule',
      {
        token,
        data: {
          title: 'Renda escritório',
          amount: 1250,
          dueDate: '2026-09-01',
          paymentMethod: 'sepa',
          partyId: vendor.id,
          recurring: true,
          recurrenceType: 'MONTHLY',
          recurrenceInterval: 1,
        },
      },
      201,
    );
    expect(recurring.recurring).toBe(true);

    const calendar = await api.data<{
      items?: unknown[];
      occurrences?: unknown[];
    }>(
      'GET',
      '/payments/schedule/calendar?from=2026-09-01&to=2026-12-31&maxOccurrences=6',
      { token },
    );
    const occ = (calendar as { items?: unknown[]; occurrences?: unknown[] }).items
      ?? (calendar as { occurrences?: unknown[] }).occurrences
      ?? calendar;
    expect(occ).toBeTruthy();

    const p1 = await api.data<{ id: string }>(
      'POST',
      '/payments/payables',
      {
        token,
        data: {
          description: 'Renda setembro',
          amount: 1250.0,
          dueDate: '2026-09-01',
          partyId: vendor.id,
        },
      },
      201,
    );
    const p2 = await api.data<{ id: string }>(
      'POST',
      '/payments/payables',
      {
        token,
        data: {
          description: 'NOS comunicações',
          amount: 89.99,
          dueDate: '2026-09-05',
          partyId: vendor.id,
        },
      },
      201,
    );

    const stored1 = await payableAmountAsString(p1.id);
    const stored2 = await payableAmountAsString(p2.id);
    expect(stored1).toBe('1250.00');
    expect(stored2).toBe('89.99');

    await api.data('POST', `/payments/payables/${p1.id}/approve`, {
      token,
      data: { note: 'OK E2E' },
    });
    await api.data('POST', `/payments/payables/${p2.id}/approve`, {
      token,
      data: { note: 'OK E2E' },
    });

    const sepa = await api.raw('POST', '/payments/sepa/export', {
      token,
      data: { payableIds: [p1.id, p2.id], requestedExecutionDate: '2026-09-03' },
    });
    expect(sepa.status(), await sepa.text().then((t) => t.slice(0, 400))).toBe(200);
    const xml = await sepa.text();
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
    expect(xml).toContain('<Document');
    expect(xml).toContain('<CstmrCdtTrfInitn>');
    expect(xml).toContain('<CtrlSum>');
    expect(xml).toContain(FIXTURE_IBAN_CREDITOR);
    expect(xml).toContain(FIXTURE_IBAN_DEBTOR);
    expect(xml).toMatch(/<NbOfTxs>2<\/NbOfTxs>/);
    expect(xml).toMatch(/<CtrlSum>1339.99<\/CtrlSum>/);
    expect(xml).toContain('<InstdAmt Ccy="EUR">1250.00</InstdAmt>');
    expect(xml).toContain('<InstdAmt Ccy="EUR">89.99</InstdAmt>');
    expect(sepa.headers()['x-docflow-control-sum']).toBe('1339.99');

    const listed = await api.data<{
      items: unknown[];
      meta: { page: number; limit: number; total: number };
    }>('GET', '/payments/payables?page=1&limit=20', { token });
    expect(listed.meta.limit).toBeLessThanOrEqual(200);
    expect(listed.items.length).toBeLessThanOrEqual(listed.meta.limit);
  });
});
