// scripts/verify-openrouter-fallback.mjs
// Live E2E: log in, upload a sample invoice, poll until EM_REVISAO,
// then print the extracted fields + metadata.extraction.aiProvider.
//
// Pass: a fixture path as the first CLI arg (default: scripts/invoice-digital.pdf)
// Fails (non-zero exit) when:
//   - the aiProvider is neither 'openrouter/gemini' nor 'gemini', or
//   - any core field is missing after 35s.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');
const FIXTURE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(APP_DIR, 'scripts', 'invoice-digital.pdf');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.EMAIL || 'admin@demo.pt';
const PASSWORD = process.env.PASSWORD || 'Admin123!';
const TENANT = process.env.TENANT || 'demo';

function logStep(msg) {
  process.stdout.write(`[openrouter-e2e] ${msg}\n`);
}

async function readJson(r) {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 500) };
  }
}

async function login() {
  logStep(`logging in as ${EMAIL} (tenant=${TENANT}) against ${BASE}…`);
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      tenantSlug: TENANT,
    }),
  });
  if (!r.ok) {
    throw new Error(`login failed ${r.status}: ${await r.text()}`);
  }
  const body = await readJson(r);
  const access =
    body?.data?.tokens?.accessToken ?? body?.tokens?.accessToken ?? body?.accessToken;
  if (!access) {
    throw new Error(`login response missing accessToken: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return access;
}

async function uploadInvoice(token, fixturePath) {
  logStep(`uploading ${fixturePath}…`);
  const buf = await fs.readFile(fixturePath);
  const filename = path.basename(fixturePath);
  const mime = filename.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : filename.toLowerCase().endsWith('.png')
      ? 'image/png'
      : filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'application/octet-stream';
  const blob = new Blob([buf], { type: mime });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('origin', 'UPLOAD');
  const r = await fetch(`${BASE}/api/v1/documents/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!r.ok) {
    throw new Error(`upload failed ${r.status}: ${await r.text()}`);
  }
  const body = await readJson(r);
  const docId =
    body?.data?.id ?? body?.id ?? body?.document?.id ?? body?.data?.document?.id;
  if (!docId) {
    throw new Error(`upload response missing id: ${JSON.stringify(body).slice(0, 300)}`);
  }
  logStep(`uploaded → documentId=${docId}`);
  return docId;
}

async function pollDocument(token, docId) {
  const deadline = Date.now() + 35_000;
  let lastBody = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/v1/documents/${docId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      throw new Error(`GET /documents/${docId} failed ${r.status}: ${await r.text()}`);
    }
    const body = await readJson(r);
    const status = body?.data?.status ?? body?.status ?? body?.document?.status;
    if (status === 'EM_REVISAO') return body;
    lastBody = body;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(
    `timed out waiting for EM_REVISAO. last body: ${JSON.stringify(lastBody).slice(0, 600)}`,
  );
}

function pickField(body, ...keys) {
  const root = body?.data ?? body?.document ?? body;
  for (const k of keys) {
    const v = root?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function pickMetadata(body) {
  const root = body?.data ?? body?.document ?? body;
  return root?.metadata ?? body?.metadata ?? null;
}

async function findUniqueFixture() {
  // The fixture we got might be a duplicate; preserve the original
  // extension so MIME sniffing stays correct, and append a long
  // random-ish byte sequence (date.now + process pid + a counter) so
  // the SHA-256 differs from any previous run.
  const base = FIXTURE;
  const ext = path.extname(base) || '.bin';
  const buf = await fs.readFile(base);
  const noise = Buffer.from(
    `${Date.now()}-${process.pid}-${Math.random()}`,
    'utf8',
  );
  const candidate = Buffer.concat([buf, noise]);
  const candidatePath = path.join(
    '/tmp',
    `e2e-${Date.now()}${ext}`,
  );
  await fs.writeFile(candidatePath, candidate);
  return candidatePath;
}

(async () => {
  try {
    const token = await login();
    const fixturePath = await findUniqueFixture();
    const docId = await uploadInvoice(token, fixturePath);
    logStep(`polling GET /documents/${docId} for up to 35s…`);
    const body = await pollDocument(token, docId);
    const meta = pickMetadata(body) || {};
    const extraction = meta.extraction || {};
    const aiProvider = extraction.aiProvider ?? null;
    const aiModel = extraction.aiModel ?? null;
    const supplier = pickField(body, 'supplier');
    const supplierNif = pickField(body, 'supplierNif');
    const total = pickField(body, 'total', 'totalAmount');
    const taxAmount = pickField(body, 'taxAmount');
    const docDate = pickField(body, 'docDate', 'date');
    const iban = pickField(body, 'iban');
    const docNumber = pickField(body, 'docNumber', 'number');
    const type = pickField(body, 'type', 'documentType');
    const report = {
      docId,
      status: pickField(body, 'status'),
      supplier,
      supplierNif,
      total,
      taxAmount,
      docDate,
      iban,
      docNumber,
      type,
      aiProvider,
      aiModel,
    };
    logStep('extracted → ' + JSON.stringify(report, null, 2));
    const okProvider =
      aiProvider === 'openrouter/gemini-2.5-flash' ||
      aiProvider === 'gemini';
    const okFields = supplier && total != null && taxAmount != null;
    if (!okProvider) {
      console.error(
        `[openrouter-e2e] FAIL — aiProvider is "${aiProvider}" (expected 'openrouter/gemini-2.5-flash' or 'gemini')`,
      );
      process.exit(2);
    }
    if (!okFields) {
      console.error(
        '[openrouter-e2e] FAIL — extracted fields missing (supplier/total/taxAmount)',
      );
      process.exit(3);
    }
    logStep('SUCCESS — invoice extracted via vision provider.');
    process.exit(0);
  } catch (err) {
    console.error(`[openrouter-e2e] ERROR — ${err.message}`);
    process.exit(1);
  }
})();
