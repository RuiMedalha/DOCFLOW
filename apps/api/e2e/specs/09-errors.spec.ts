import { test, expect } from '@playwright/test';
import { Api } from '../helpers/api';
import { makeNif, makePtIban } from '../helpers/pt-ids';

test.describe('Error scenarios @errors @secrets', () => {
  test('health liveness never leaks connection strings @secrets @errors', async ({ request }) => {
    const api = new Api(request);
    const health = await api.json('GET', '/health');
    expect(health.status).toBe(200);
    const text = JSON.stringify(health.body);
    expect(text).not.toMatch(/postgresql:\/\/|redis:\/\/|password=/i);
    expect(text).not.toMatch(/stack/i);

    const full = await api.json('GET', '/health/full');
    if (full.status === 200) {
      const fullText = JSON.stringify(full.body);
      expect(fullText).not.toMatch(/postgresql:\/\/|ECONNREFUSED|ioredis/i);
    }
  });

  test('malformed CSV returns 400 and does not crash @errors', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const res = await api.json('POST', '/banking/csv/import', {
      token: admin.tokens.accessToken,
      data: {
        content: 'this is not;;;csv\x00\n\n????',
        mapping: {
          date: 'Data',
          description: 'Descrição',
          amount: 'Valor',
        },
        dateFormat: 'DD/MM/YYYY',
        hasHeader: true,
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toMatch(/at Object|node_modules/i);
  });

  test('IBAN blacklist returns 400 with a user-friendly message @errors', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const iban = makePtIban();
    await api.data(
      'POST',
      '/parties/blacklist',
      {
        token: admin.tokens.accessToken,
        data: { iban, reason: 'conta denunciada', source: 'manual' },
      },
      201,
    );
    const blocked = await api.json('POST', '/parties', {
      token: admin.tokens.accessToken,
      data: { type: 'FORNECEDOR', name: 'Blacklisted vendor', nif: makeNif(), iban },
    });
    expect(blocked.status).toBe(400);
    const msg = JSON.stringify(blocked.body);
    expect(msg).toMatch(/blacklist/i);
    expect(msg).not.toMatch(/Prisma|stack/i);
  });

  test('duplicate party NIF returns 409 with helpful message @errors', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const nif = makeNif();
    await api.data(
      'POST',
      '/parties',
      {
        token: admin.tokens.accessToken,
        data: { type: 'FORNECEDOR', name: 'Primeiro', nif },
      },
      201,
    );
    const dupe = await api.json('POST', '/parties', {
      token: admin.tokens.accessToken,
      data: { type: 'FORNECEDOR', name: 'Segundo', nif },
    });
    expect(dupe.status).toBe(409);
    expect(JSON.stringify(dupe.body)).toMatch(/Já existe entidade com este NIF/i);
  });

  test('invalid IBAN is rejected before DB write @errors', async ({ request }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const res = await api.json('POST', '/parties', {
      token: admin.tokens.accessToken,
      data: {
        type: 'FORNECEDOR',
        name: 'IBAN inválido',
        nif: makeNif(),
        iban: 'PT00NOTANIBAN',
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/IBAN inválido/i);
  });
});
