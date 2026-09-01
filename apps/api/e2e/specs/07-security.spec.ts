import { test, expect } from '@playwright/test';
import { Api } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif, uniqueEmail } from '../helpers/pt-ids';

test.describe('Security: RBAC, XSS, IDOR, input validation @rbac @secrets', () => {
  test('OPERADOR cannot approve payables (ADMIN/APPROVER only) @rbac', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();

    const invited = await api.data<{
      user: { email: string };
      temporaryPassword: string;
    }>(
      'POST',
      '/auth/invite',
      {
        token: admin.tokens.accessToken,
        data: {
          email: uniqueEmail('ops'),
          name: 'Operador E2E',
          role: 'OPERADOR',
        },
      },
      201,
    );

    const ops = await api.login(
      invited.user.email,
      invited.temporaryPassword,
      admin.tenantSlug,
    );
    expect(ops.role).toBe('OPERADOR');

    const vendor = await api.data<{ id: string }>(
      'POST',
      '/parties',
      {
        token: admin.tokens.accessToken,
        data: {
          type: 'FORNECEDOR',
          name: 'Vendor RBAC',
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
        token: admin.tokens.accessToken,
        data: {
          description: 'Needs approval',
          amount: 10,
          dueDate: '2026-09-10',
          partyId: vendor.id,
        },
      },
      201,
    );

    const denied = await api.json('POST', `/payments/payables/${payable.id}/approve`, {
      token: ops.tokens.accessToken,
      data: { note: 'should fail' },
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toMatch(/stack|at Object/i);

    const sepaDenied = await api.json('POST', '/payments/sepa/export', {
      token: ops.tokens.accessToken,
      data: { payableIds: [payable.id] },
    });
    expect(sepaDenied.status).toBe(403);
  });

  test('XSS payloads in metadata are stored as data, not executed; errors stay JSON @secrets', async ({
    request,
  }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const xss = '<script>alert("xss")</script>';

    const party = await api.data<{ id: string; notes: string | null; name: string }>(
      'POST',
      '/parties',
      {
        token: admin.tokens.accessToken,
        data: {
          type: 'FORNECEDOR',
          name: xss,
          nif: makeNif(),
          notes: xss,
        },
      },
      201,
    );
    expect(party.name).toBe(xss);
    expect(party.notes).toBe(xss);

    const listed = await api.data<{ items: Array<{ name: string }> }>(
      'GET',
      '/parties?search=script&limit=20',
      { token: admin.tokens.accessToken },
    );
    expect(JSON.stringify(listed)).toContain('script');
    expect(JSON.stringify(listed)).not.toContain('<html');
  });

  test('error envelope never leaks stack traces @secrets', async ({ request }) => {
    const api = new Api(request);
    const boom = await api.json('GET', '/documents/not-a-uuid', {});
    expect(boom.status).toBeGreaterThanOrEqual(400);
    const text = JSON.stringify(boom.body);
    expect(text).not.toMatch(/at Object\.|node_modules|prisma\/client/i);
    expect(text).not.toMatch(/passwordHash|JWT_ACCESS_SECRET|DATABASE_URL/i);
  });
});
