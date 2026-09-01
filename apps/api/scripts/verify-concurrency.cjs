#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * verify-concurrency.cjs — 4-back-to-back upload verification
 *
 * HARDENED 2026-09-01: verifies that the in-process serial queue
 * drains all 4 concurrent uploads successfully (no doc stuck at
 * NOVO) and reports the per-doc processing time so we can see
 * whether the Opus 5 thinking-disabled speedup landed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const API = 'http://localhost:4000/api/v1';
const SOURCE = process.argv[2] || path.join(
  'uploads',
  'cmtf1scz20000g5s0n621bzef',
  '2026',
  '08',
);
const TENANT_SLUG = 'demo';
const EMAIL = 'admin@demo.pt';
const PASSWORD = 'Admin123!';
const POLL_TIMEOUT_MS = 240_000; // 4 minutes max for 4 docs serial
const POLL_INTERVAL_MS = 4_000;

function pickJpg(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.jpg') && !e.name.startsWith('test')) {
      return path.join(dir, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const r = pickJpg(path.join(dir, e.name));
      if (r) return r;
    }
  }
  throw new Error(`No .jpg found under ${dir}`);
}

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantSlug: TENANT_SLUG, email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data.tokens.accessToken;
}

function appendRandom(src, suffix) {
  // Mimic a "different" JPEG: read the real file, append 16 random
  // bytes at the end. Most JPEG decoders ignore trailing bytes, so
  // vision should still parse it. This makes each upload a unique
  // sha-256 so dedup doesn't collapse them into one Document.
  const bytes = fs.readFileSync(src);
  const tail = Buffer.alloc(16 + suffix.length);
  for (let i = 0; i < 16; i++) tail[i] = Math.floor(Math.random() * 256);
  if (suffix.length) tail.write(suffix, 16);
  return Buffer.concat([bytes, tail]);
}

async function upload(token, buf, label) {
  const t0 = Date.now();
  const form = new FormData();
  // @ts-ignore — FormData accepts Blob/Buffer in Node 18+
  form.set('file', new Blob([buf], { type: 'image/jpeg' }), `${label}.jpg`);
  form.set('origin', 'UPLOAD');
  const r = await fetch(`${API}/documents/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const tSubmit = Date.now() - t0;
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`upload ${label} failed: ${r.status} ${txt}`);
  }
  const j = await r.json();
  return { submitMs: tSubmit, response: j };
}

async function docStatus(token, id) {
  const r = await fetch(`${API}/documents/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.data ?? j;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const tStart = Date.now();
  console.log(`[verify] source dir: ${SOURCE}`);
  const sourceJpg = pickJpg(SOURCE);
  console.log(`[verify] using fixture: ${sourceJpg} (${fs.statSync(sourceJpg).size} bytes)`);

  const token = await login();
  console.log(`[verify] logged in; token len=${token.length}`);

  // Fire all 4 uploads back-to-back — NO artificial delay between them.
  const labels = ['A', 'B', 'C', 'D'];
  const submitT0 = Date.now();
  const results = await Promise.all(
    labels.map((label, idx) => {
      const buf = appendRandom(sourceJpg, `-${label}-${Date.now()}-${idx}`);
      return upload(token, buf, `concurrency-test-${label}`);
    }),
  );
  const submitAllDoneMs = Date.now() - submitT0;
  console.log(`[verify] all 4 uploads returned in ${submitAllDoneMs}ms (note: this measures submit latency, not extraction latency)`);

  // Extract document IDs.
  const docIds = results.map((r, i) => {
    const id = r.response?.data?.document?.id ?? r.response?.data?.id;
    console.log(`[verify] upload ${labels[i]} → docId=${id} (submit took ${r.submitMs}ms)`);
    return id;
  });

  // Poll each until it reaches EM_REVISAO, or until timeout.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const completed = {};
  while (Date.now() < deadline) {
    let allDone = true;
    for (let i = 0; i < docIds.length; i++) {
      if (completed[labels[i]]) continue;
      const doc = await docStatus(token, docIds[i]);
      const status = doc?.status ?? doc?.document?.status ?? '?';
      if (status === 'EM_REVISAO' || status === 'REJEITADO' || status === 'ARQUIVADO') {
        completed[labels[i]] = { doc, ms: Date.now() - tStart };
        const meta = doc?.metadata?.extraction ?? {};
        console.log(
          `[verify] ${labels[i]} (${docIds[i].slice(-6)}) reached ${status} ` +
            `after ${completed[labels[i]].ms}ms — supplier=${meta.supplier ?? '?'} ` +
            `total=${meta.total ?? '?'} provider=${meta.provider ?? meta.fallbackProvider ?? '?'}`,
        );
      } else {
        allDone = false;
      }
    }
    if (allDone) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const totalMs = Date.now() - tStart;
  console.log(`\n========= RESULT =========`);
  let ok = 0;
  for (const l of labels) {
    if (completed[l]) {
      const { doc, ms } = completed[l];
      const status = doc?.status;
      const meta = doc?.metadata?.extraction ?? {};
      const provider = meta.provider ?? meta.fallbackProvider ?? '?';
      const supplier = meta.supplier ?? '?';
      const total = meta.total ?? '?';
      const stuck = (status === 'NOVO');
      console.log(
        `  ${l}: status=${status} provider=${provider} supplier=${supplier} total=${total} ` +
          `arrived=${ms}ms stuckNOVO=${stuck}`,
      );
      if (status === 'EM_REVISAO' && provider.match(/minimax|openrouter/)) ok += 1;
    } else {
      console.log(`  ${l}: TIMEOUT — never reached a final status`);
    }
  }
  console.log(`  TOTAL elapsed: ${totalMs}ms (≈${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`  OK count: ${ok}/4`);
  console.log(`============================\n`);
  process.exit(ok === 4 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
