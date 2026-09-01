import { test, expect } from '@playwright/test';
import { Api } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif } from '../helpers/pt-ids';
import { listAuditActions, payableAmountAsString, verifyAuditChain } from '../helpers/db';

test.describe('Audit trail + financial accuracy @audit @flow', () => {
  test('mutations write audit rows, hash chain is intact, amounts stay Decimal @audit', async ({
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
          name: 'Audit Vendor',
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
          description: 'Decimal check 0.10',
          amount: 0.1,
          dueDate: '2026-09-01',
          partyId: vendor.id,
        },
      },
      201,
    );
    const payable2 = await api.data<{ id: string }>(
      'POST',
      '/payments/payables',
      {
        token,
        data: {
          description: 'Decimal check 0.20',
          amount: 0.2,
          dueDate: '2026-09-01',
          partyId: vendor.id,
        },
      },
      201,
    );

    expect(await payableAmountAsString(payable.id)).toBe('0.10');
    expect(await payableAmountAsString(payable2.id)).toBe('0.20');

    await api.data('POST', `/payments/payables/${payable.id}/approve`, {
      token,
      data: { note: 'audit' },
    });
    await api.data('POST', `/payments/payables/${payable2.id}/approve`, {
      token,
      data: { note: 'audit' },
    });

    const sepa = await api.raw('POST', '/payments/sepa/export', {
      token,
      data: { payableIds: [payable.id, payable2.id] },
    });
    expect(sepa.status()).toBe(200);
    const xml = await sepa.text();
    expect(xml).toMatch(/<CtrlSum>0.30<\/CtrlSum>/);

    const chain = await verifyAuditChain(admin.tenantId);
    expect(chain.valid, `broken at ${chain.brokenAt}`).toBe(true);
    expect(chain.count).toBeGreaterThan(0);

    const actions = await listAuditActions(admin.tenantId);
    const names = actions.map((a) => a.action);
    expect(names).toEqual(expect.arrayContaining(['CREATE', 'APPROVE']));
    expect(actions.every((a) => a.createdAt)).toBe(true);
  });
});
