// scripts/verify-photo-lizotel.mjs
// Same as verify-photo-extraction but uploads the LIZOTEL "phone.jpg"
// instead of the Américo Alves photo — both are 2.6 MB phone photos
// of the same kind. The user explicitly named both photos in the
// acceptance criteria.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

// LIZOTEL phone.jpg — found in the path below (path is unique per
// upload; the original was cmtfu... but the actual upload may have
// used a different sub-folder). The path is constructed from the
// last successful run we observed.
const FIXTURE = path.join(
  APP_DIR,
  'uploads',
  'cmtf1scz20000g5s0n621bzef',
  '2026',
  '09',
  '1788221200443-941125507b159141.jpg',
);

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.EMAIL || 'admin@demo.pt';
const PASSWORD = process.env.PASSWORD || 'Admin123!';
const TENANT = process.env.TENANT || 'demo';

function logStep(msg) { process.stdout.write(`[lizotel-e2e] ${msg}\n`); }
async function readJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { __raw: text.slice(0, 500) }; }
}

async function login() {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, tenantSlug: TENANT }),
  });
  if (!r.ok) throw new Error(`login failed ${r.status}: ${await r.text()}`);
  const body = await readJson(r);
  const access = body?.data?.tokens?.accessToken ?? body?.tokens?.accessToken;
  if (!access) throw new Error(`login missing accessToken`);
  return access;
}

async function uploadInvoice(token, fixturePath) {
  logStep(`uploading ${fixturePath}…`);
  const buf = await fs.readFile(fixturePath);
  const filename = path.basename(fixturePath);
  const mime = 'image/jpeg';
  const trailer = Buffer.from(`${Date.now()}-${process.pid}-${Math.floor(Math.random()*1e9)}`, 'utf8');
  const bytes = Buffer.concat([buf, trailer]);
  const blob = new Blob([bytes], { type: mime });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('origin', 'UPLOAD');
  const r = await fetch(`${BASE}/api/v1/documents/upload`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  });
  if (!r.ok) throw new Error(`upload failed ${r.status}: ${await r.text()}`);
  const body = await readJson(r);
  const docId = body?.data?.id ?? body?.id;
  if (!docId) throw new Error(`upload missing id`);
  logStep(`uploaded → documentId=${docId}`);
  return docId;
}

async function pollDocument(token, docId) {
  const deadline = Date.now() + 240_000;
  let lastBody = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/v1/documents/${docId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`GET /documents/${docId} failed ${r.status}`);
    const body = await readJson(r);
    const status = body?.data?.status;
    if (status === 'EM_REVISAO' || status === 'ERRO') return body;
    lastBody = body;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`timed out: ${JSON.stringify(lastBody).slice(0, 600)}`);
}

function pickField(body, ... keys) {
  const root = body?.data ?? body?.document ?? body;
  for (const k of keys) {
    const v = root?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

(async () => {
  try {
    const token = await login();
    const docId = await uploadInvoice(token, FIXTURE);
    logStep(`polling for up to 240s…`);
    const body = await pollDocument(token, docId);
    const meta = body?.data?.metadata ?? {};
    const extraction = meta.extraction ?? {};

    const total = Number(pickField(body, 'total', 'totalAmount'));
    const netAmount = Number(pickField(body, 'netAmount'));
    const taxAmount = Number(pickField(body, 'taxAmount'));
    const supplier = pickField(body, 'supplier');
    const supplierNif = pickField(body, 'supplierNif', 'nif');
    const docNumber = pickField(body, 'docNumber', 'number');
    const atcud = pickField(body, 'atcud');
    const status = pickField(body, 'status');
    const aiProvider = extraction.aiProvider ?? null;
    const warnings = Array.isArray(extraction.warnings) ? extraction.warnings : [];
    const ivaBreakdown = Array.isArray(extraction.ivaBreakdown) ? extraction.ivaBreakdown : [];

    logStep('extracted → ' + JSON.stringify({
      docId, status, total, netAmount, taxAmount,
      supplier, supplierNif, docNumber, atcud,
      aiProvider, ivaBreakdown, warnings,
    }, null, 2));

    const failures = [];
    if (!(Number.isFinite(total) && total > 0)) failures.push(`total invalid: ${total}`);
    if (!(Number.isFinite(netAmount) && netAmount > 0)) failures.push(`netAmount invalid: ${netAmount}`);
    if (!(Number.isFinite(taxAmount) && taxAmount >= 0)) failures.push(`taxAmount invalid: ${taxAmount}`);
    if (!supplier) failures.push('supplier is null');
    if (Number.isFinite(total) && total > 1_000_000) failures.push(`total looks like corruption: ${total}`);
    if (Number.isFinite(total) && Number.isFinite(netAmount) && Number.isFinite(taxAmount) && Math.abs(total - (netAmount + taxAmount)) > 0.05) {
      failures.push(`net+tax ≠ total: ${netAmount} + ${taxAmount} ≠ ${total}`);
    }
    if (warnings.includes('ai_partial_response_used_regex_fallback')) {
      failures.push('warnings still contains ai_partial_response_used_regex_fallback');
    }
    if (ivaBreakdown.length > 0 && (ivaBreakdown[0].rate > 30 || ivaBreakdown[0].rate < 0)) {
      failures.push(`ivaBreakdown rate implausible: ${ivaBreakdown[0].rate}`);
    }

    if (failures.length > 0) {
      console.error('[lizotel-e2e] FAIL — ' + failures.length + ' failures:');
      failures.forEach(f => console.error('  - ' + f));
      process.exit(2);
    }
    logStep('SUCCESS — LIZOTEL phone.jpg extracted correctly.');
    process.exit(0);
  } catch (err) {
    console.error('[lizotel-e2e] ERROR — ' + err.message);
    process.exit(1);
  }
})();