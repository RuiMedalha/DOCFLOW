/**
 * Verification script — PATCHes each test document via API and asserts
 * the finalFolder + metadata.filing match the expected paths.
 *
 * Run with:  npx ts-node scripts/verify-filing.ts
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as fs from 'fs';

const TENANT_SLUG = 'demo';
const API = 'http://localhost:4000/api/v1';
const ADMIN_EMAIL = 'admin@demo.pt';
const ADMIN_PASSWORD = 'Admin123!';
// 4 PDFs that we just uploaded live, in the same order:
const PDFS = [
  { file: 'C:/tmp/filing-tests/meals.pdf',     manualCategory: 'Refeições',   partyId: null,                  expected: '/Despesas/refeicoes/' },
  { file: 'C:/tmp/filing-tests/fuel.pdf',      manualCategory: 'Combustível', partyId: null,                  expected: '/Despesas/combustivel/' },
  { file: 'C:/tmp/filing-tests/recurring.pdf', manualCategory: null,          partyId: '__EDP__',             expected: '/Fornecedores/edp_comercial/' },
  { file: 'C:/tmp/filing-tests/foreign.pdf',   manualCategory: null,          partyId: '__IBERDROLA__',      expected: '/Estrangeiras/Fornecedor/iberdrola_espana/' },
];

async function login(): Promise<string> {
  const resp = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG }),
  });
  if (!resp.ok) throw new Error(`login failed ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  return j.data?.tokens?.accessToken ?? '';
}

async function uploadPdf(token: string, file: string): Promise<string> {
  const buf = fs.readFileSync(file);
  const blob = new Blob([buf], { type: 'application/pdf' });
  const fd = new FormData();
  fd.append('file', blob, file.split('/').pop()!);
  const resp = await fetch(`${API}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd as any,
  });
  if (!resp.ok) throw new Error(`upload failed ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  return j.data?.id ?? '';
}

async function patch(token: string, id: string, body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${API}/documents/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`patch failed ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  return j.data;
}

async function pollForEmRevisao(token: string, id: string, maxMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const resp = await fetch(`${API}/documents/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const j = await resp.json();
      if (j.data?.status === 'EM_REVISAO') return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const token = await login();
  console.log(`# token=${token.slice(0, 20)}…\n`);

  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error('tenant not found');

  const edp = await prisma.party.findFirst({ where: { tenantId: tenant.id, name: 'EDP Comercial' } });
  const iberdrola = await prisma.party.findFirst({ where: { tenantId: tenant.id, name: 'Iberdrola Espana' } });
  if (!edp || !iberdrola) {
    console.log(`# Parties not seeded — run scripts/filing-test.ts first`);
    process.exit(1);
  }

  const partyMap: Record<string, string> = {
    __EDP__: edp.id,
    __IBERDROLA__: iberdrola.id,
  };

  // Upload the 4 PDFs (live).
  const ids: string[] = [];
  for (const c of PDFS) {
    const id = await uploadPdf(token, c.file);
    ids.push(id);
    console.log(`✓ uploaded ${c.file.split(/[\\/]/).pop()} → ${id}`);
    // Wait for extraction to complete so our PATCH isn't racing with it.
    await pollForEmRevisao(token, id);
  }

  // PATCH each: set partyId + supplier (from party name) + expenseCategory.
  // The engine reads `supplier` for the {Entidade} token; sending the
  // party's canonical name ensures the folder path uses it regardless
  // of what Gemini extracted.
  console.log('\n# PATCH each document — set partyId + supplier + expenseCategory\n');
  for (let i = 0; i < PDFS.length; i++) {
    const c = PDFS[i];
    const id = ids[i];
    const patchBody: Record<string, unknown> = {};
    if (c.partyId) {
      const partyId = partyMap[c.partyId];
      patchBody.partyId = partyId;
      const party = c.partyId === '__EDP__' ? edp : iberdrola;
      patchBody.supplier = party.name;
    }
    if (c.manualCategory) patchBody.expenseCategory = c.manualCategory;
    let updated;
    try {
      updated = await patch(token, id, patchBody);
    } catch (e: any) {
      console.log(`✗ ${c.file.split(/[\\/]/).pop()} → PATCH failed: ${e.message}`);
      continue;
    }
    const finalFolder = updated.finalFolder ?? '(none)';
    const filing = updated.metadata?.filing;
    const ok = finalFolder.startsWith(c.expected);
    console.log(
      `${ok ? '✓' : '✗'} ${c.file.split(/[\\/]/).pop()?.padEnd(20)} → finalFolder=${finalFolder}` +
      (filing ? `  filing.expenseCategory=${filing.expenseCategory}` : '') +
      (ok ? '' : `  EXPECTED starts with: ${c.expected}`),
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
