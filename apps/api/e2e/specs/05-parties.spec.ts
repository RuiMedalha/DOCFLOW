import { test, expect } from '@playwright/test';
import { Api } from '../helpers/api';
import { FIXTURE_IBAN_CREDITOR, makeNif, makePtIban } from '../helpers/pt-ids';

test.describe('Party management + anti-fraud @flow', () => {
  test('create vendor with NIF/IBAN, track IBAN history, anti-fraud checks @flow', async ({
    request,
  }) => {
    const api = new Api(request);
    const admin = await api.registerTenant();
    const token = admin.tokens.accessToken;
    const nif = makeNif();

    const party = await api.data<{
      id: string;
      nif: string;
      iban: string;
      ibanVerified: boolean;
    }>(
      'POST',
      '/parties',
      {
        token,
        data: {
          type: 'FORNECEDOR',
          name: 'EDP Comercial SA',
          nif,
          iban: FIXTURE_IBAN_CREDITOR,
        },
      },
      201,
    );
    expect(party.nif).toBe(nif);
    expect(party.iban).toBe(FIXTURE_IBAN_CREDITOR);

    const invalid = await api.json('POST', '/parties', {
      token,
      data: {
        type: 'FORNECEDOR',
        name: 'IBAN mau',
        nif: makeNif(),
        iban: 'PT50003506510000000000712',
      },
    });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).toMatch(/IBAN inválido/i);

    const dupe = await api.json('POST', '/parties', {
      token,
      data: {
        type: 'FORNECEDOR',
        name: 'Clone NIF',
        nif,
        iban: makePtIban(),
      },
    });
    expect(dupe.status).toBe(409);
    expect(JSON.stringify(dupe.body)).toMatch(/Já existe entidade com este NIF/i);

    const nextIban = makePtIban();
    await api.data('PATCH', `/parties/${party.id}`, {
      token,
      data: { iban: nextIban },
    });
    const history = await api.data<{ items: Array<{ oldIban?: string; newIban?: string }> }>(
      'GET',
      `/parties/${party.id}/iban-history`,
      { token },
    );
    expect(history.items.length).toBeGreaterThan(0);
    expect(history.items.some((h) => h.newIban === nextIban)).toBe(true);

    await api.data('POST', `/parties/${party.id}/iban/verify`, {
      token,
      data: { reason: 'confirmado por telefone E2E' },
    });

    const score = await api.data<{
      score: number;
      blacklistMatch: boolean;
    }>('GET', `/parties/${party.id}/iban/risk-score`, { token });
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);

    const flaggedIban = makePtIban();
    await api.data(
      'POST',
      '/parties/blacklist',
      {
        token,
        data: { iban: flaggedIban, reason: 'fraude conhecida E2E', source: 'manual' },
      },
      201,
    );

    const blocked = await api.json('POST', '/parties', {
      token,
      data: {
        type: 'FORNECEDOR',
        name: 'Fornecedor blacklist',
        nif: makeNif(),
        iban: flaggedIban,
      },
    });
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/blacklist/i);
  });
});
