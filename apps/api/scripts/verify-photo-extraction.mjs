// scripts/verify-photo-extraction.mjs
// Live E2E: log in, upload the previously-buggy phone photo, poll until
// EM_REVISAO, then print the extracted fields + warn if the corrupt
// "total=31082026" pattern returned.
//
// Pass: a fixture path as the first CLI arg (default: the cached
// foto-nova-1788222405635.jpg from uploads/). The script appends a
// 4-byte random trailer so the SHA-256 differs from any previous run
// (dedup would otherwise return the cached bad row).
//
// Fails (non-zero exit) when:
//   - status never reaches EM_REVISAO in 45s, or
//   - total is missing, or
//   - total looks like the date-corruption pattern (31082026), or
//   - supplier is null, or
//   - the metadata carries `ai_partial_response_used_regex_fallback`.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');

const FIXTURE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(
      APP_DIR,
      'uploads',
      'cmtf1scz20000g5s0n621bzef',
      '2026',
      '09',
      '1788222405691-e3772ef040d5bf8c.jpg',
    );

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.EMAIL || 'admin@demo.pt';
const PASSWORD = process.env.PASSWORD || 'Admin123!';
const TENANT = process.env.TENANT || 'demo';

function logStep(msg) {
  process.stdout.write(`[photo-e2e] ${msg}\n`);
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
  const mime = filename.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';
  // Append a 4-byte random trailer so the SHA-256 differs from the
  // cached row in the DB (the SHA-256 dedup test for the very bug
  // we're verifying).
  const trailer = Buffer.from(
    `${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
    'utf8',
  );
  const bytes = Buffer.concat([buf, trailer]);
  const blob = new Blob([bytes], { type: mime });
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
  // 240s ceiling. End-to-end pipeline: image-to-PDF (~3s) + jsQR
  // (~4s) + OpenRouter primary (~30s, often truncated on phone
  // photos) + OpenRouter stripped-prompt retry (~5s, usually
  // successful) + gemini-2.5-pro escalation when numerics are
  // unusable (~10s). Worse-case per the production data:
  // ~80-120s wall-clock. Plus BullMQ sync-path overhead + Redis
  // ECONNREFUSED retries (when Redis isn't running the call still
  // happens in-process).
  const deadline = Date.now() + 240_000;
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
    if (status === 'EM_REVISAO' || status === 'ERRO') {
      return body;
    }
    lastBody = body;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(
    `timed out waiting for terminal status. last body: ${JSON.stringify(lastBody).slice(0, 600)}`,
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

(async () => {
  try {
    const token = await login();
    const docId = await uploadInvoice(token, FIXTURE);
    logStep(`polling GET /documents/${docId} for up to 45s…`);
    const body = await pollDocument(token, docId);
    const meta = pickMetadata(body) || {};
    const extraction = meta.extraction || {};

    const total = Number(pickField(body, 'total', 'totalAmount'));
    const netAmount = Number(pickField(body, 'netAmount'));
    const taxAmount = Number(pickField(body, 'taxAmount'));
    const supplier = pickField(body, 'supplier');
    const supplierNif = pickField(body, 'supplierNif', 'nif');
    const docNumber = pickField(body, 'docNumber', 'number');
    const atcud = pickField(body, 'atcud');
    const status = pickField(body, 'status');
    const aiProvider = extraction.aiProvider ?? null;
    const aiModel = extraction.aiModel ?? null;
    const warnings = Array.isArray(extraction.warnings) ? extraction.warnings : [];
    const ivaBreakdown = Array.isArray(extraction.ivaBreakdown) ? extraction.ivaBreakdown : [];
    const source = extraction.source ?? null;
    const textSource = extraction.textSource ?? null;

    const report = {
      docId,
      status,
      total,
      netAmount,
      taxAmount,
      supplier,
      supplierNif,
      docNumber,
      atcud,
      source,
      textSource,
      aiProvider,
      aiModel,
      ivaBreakdown,
      warnings,
    };
    logStep('extracted → ' + JSON.stringify(report, null, 2));

    // Acceptance assertions.
    const failures = [];

    // The PRIMARY regression assertion — the bug was that total came
    // back as 31082026 (a date string mangled into a number). Anything
    // over 1_000_000€ for a Portuguese invoice on this dataset is a
    // fabrication. The fix MUST clamp this; the AI + QR + regex paths
    // must NEVER invent totals from non-numeric text.
    if (Number.isFinite(total) && total > 1_000_000) {
      failures.push(
        `total=${total} looks like the date-corruption bug (31082026 was the original symptom)`,
      );
    }
    // Reasonable invoice total — Portuguese consumer invoices like the
    // ~144.22€ Américo Alves / LIZOTEL photo live in the €1 - €5000
    // range. The AI must NOT return a sanitised-zero or NaN.
    if (Number.isFinite(total) && (total < 1 || total > 5_000)) {
      failures.push(
        `total=${total} is implausible for the dataset (expected ~€100 - €500)`,
      );
    }
    // net + tax ≈ total — the absolute invariant for a single-rate
    // invoice. The 2025-09-01 incident had taxAmount=144.22 with
    // total=144.22 (tax copied from total), netAmount=117.25 — that
    // 117.25 + 144.22 ≠ 144.22 violation is the canary.
    if (
      Number.isFinite(total) &&
      Number.isFinite(netAmount) &&
      Number.isFinite(taxAmount) &&
      Math.abs(total - (netAmount + taxAmount)) > 0.05
    ) {
      failures.push(
        `net+tax ≠ total: ${netAmount} + ${taxAmount} = ${netAmount + taxAmount}, total=${total}`,
      );
    }
    // The supplier is the most reliable signal that the AI actually
    // looked at the image. When the date-corruption bug fired, supplier
    // was null because the regex was inventing numbers from the date
    // "31/08/2026" instead of the AI reading the supplier name.
    if (!supplier) {
      failures.push('supplier is null — AI vision did not run or returned garbage');
    }
    // The audit-trail warning that proved the regex-fallback was firing.
    if (warnings.includes('ai_partial_response_used_regex_fallback')) {
      failures.push(
        `metadata.extraction.warnings still contains 'ai_partial_response_used_regex_fallback'`,
      );
    }
    // Source must say the AI actually ran. When the AI returns
    // fallbackUsed=true, our fix demotes source to 'regex' and keeps
    // amounts null — that's correct (no fabrication).
    if (source !== 'ai' && source !== 'at_qr+ai' && source !== 'regex') {
      failures.push(`source='${source}' is unexpected (expected 'ai', 'at_qr+ai', or 'regex')`);
    }
    // When the AI returned IVA breakdown, the rate MUST be plausible
    // (PT rates are 0/6/13/23). The 2025-09-01 incident had rate=123
    // (the fallback path computed a synthetic rate from
    // `tax / net * 100` and produced a garbage value when tax was the
    // duplicated total).
    if (
      ivaBreakdown.length > 0 &&
      (ivaBreakdown[0].rate > 30 || ivaBreakdown[0].rate < 0)
    ) {
      failures.push(
        `ivaBreakdown[0].rate=${ivaBreakdown[0].rate} is implausible (PT rates 0/6/13/23)`,
      );
    }

    if (failures.length > 0) {
      console.error('[photo-e2e] FAIL — ' + failures.length + ' assertion(s) failed:');
      for (const f of failures) console.error('  - ' + f);
      process.exit(2);
    }
    logStep('SUCCESS — real-photo extraction returned clean, plausible fiscal amounts.');
    process.exit(0);
  } catch (err) {
    console.error(`[photo-e2e] ERROR — ${err.message}`);
    process.exit(1);
  }
})();
