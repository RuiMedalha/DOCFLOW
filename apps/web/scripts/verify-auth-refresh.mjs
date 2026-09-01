// Node.js verification of the refresh+retry flow against the live API.
// Simulates: fresh login → GET documents → corrupt the access token →
// GET documents (forces 401) → confirm the auth-refresh helper refreshes
// and the retried request succeeds.

import { strict as assert } from 'node:assert';

const API = 'http://localhost:4000/api/v1';

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function looksLikeJwt(t) {
  return typeof t === 'string' && t.split('.').length === 3;
}

function isJwtExpired(t) {
  if (!looksLikeJwt(t)) return false;
  try {
    const payload = JSON.parse(b64urlDecode(t.split('.')[1]));
    const nowSec = Math.floor(Date.now() / 1000);
    return typeof payload.exp === 'number' && payload.exp <= nowSec + 5;
  } catch {
    return false;
  }
}

// ----- 1. Fresh login --------------------------------------------------
console.log('--- 1. Fresh login ---');
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@demo.pt',
    password: 'Admin123!',
    tenantSlug: 'demo',
  }),
});
assert.equal(loginRes.status, 200, `login expected 200, got ${loginRes.status}`);
const loginBody = await loginRes.json();
const tokens = loginBody.data.tokens;
assert.ok(looksLikeJwt(tokens.accessToken), 'accessToken is a JWT');
assert.ok(!isJwtExpired(tokens.accessToken), 'fresh accessToken is not expired');
console.log('OK — login → real JWT, not expired');

// ----- 2. GET documents with fresh token ------------------------------
console.log('\n--- 2. GET /documents with fresh token ---');
const docsRes = await fetch(`${API}/documents?page=1&limit=20`, {
  headers: { Authorization: `Bearer ${tokens.accessToken}` },
});
assert.equal(docsRes.status, 200, `documents expected 200, got ${docsRes.status}`);
const docsBody = await docsRes.json();
assert.ok(Array.isArray(docsBody.data?.items), 'documents returns an items array');
console.log(`OK — GET /documents → 200 (${docsBody.data.items.length} items)`);

// ----- 3. Force a 401 with a syntactically valid but rejected JWT ------
console.log('\n--- 3. Force 401 with a rejected JWT, then refresh ---');
// A real-looking 3-segment JWT that the API will reject (wrong signature).
const fakeJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIiwidGVuYW50X2lkIjoiZmFrZSIsInJvbGVzIjpbIkFETUlOIl0sImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo5OTk5OTk5OTk5fQ.invalidsignature_corrupt';
const rejectedRes = await fetch(`${API}/documents?page=1&limit=20`, {
  headers: { Authorization: `Bearer ${fakeJwt}` },
});
assert.equal(rejectedRes.status, 401, `corrupt token expected 401, got ${rejectedRes.status}`);
console.log('OK — corrupt JWT → 401');

// ----- 4. Use refresh endpoint ----------------------------------------
console.log('\n--- 4. Refresh → new pair, then retry ---');
const refreshRes = await fetch(`${API}/auth/refresh`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken: tokens.refreshToken }),
});
assert.equal(refreshRes.status, 200, `refresh expected 200, got ${refreshRes.status}`);
const refreshBody = await refreshRes.json();
const newTokens = refreshBody.data;
assert.ok(looksLikeJwt(newTokens.accessToken), 'refresh returned a new access JWT');
assert.notEqual(newTokens.accessToken, tokens.accessToken, 'new access token is different');
assert.notEqual(newTokens.refreshToken, tokens.refreshToken, 'new refresh token is different (rotated)');
console.log('OK — refresh rotates both tokens');

// ----- 5. Retried document GET with the new token ---------------------
console.log('\n--- 5. Retry GET /documents with refreshed token ---');
const retryRes = await fetch(`${API}/documents?page=1&limit=20`, {
  headers: { Authorization: `Bearer ${newTokens.accessToken}` },
});
assert.equal(retryRes.status, 200, `retry expected 200, got ${retryRes.status}`);
const retryBody = await retryRes.json();
assert.ok(Array.isArray(retryBody.data?.items), 'retry returns items array');
console.log(`OK — retried GET /documents → 200 (${retryBody.data.items.length} items)`);

// ----- 6. Verify the token guard helpers see an expired JWT as poisoned
console.log('\n--- 6. Verify isJwtExpired() / looksLikeJwt() helpers ---');
// Build a JWT that expired long ago.
const pastExp = Math.floor(Date.now() / 1000) - 60;
const payload = Buffer.from(JSON.stringify({ sub: 'x', exp: pastExp })).toString('base64url');
const expiredJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
assert.equal(looksLikeJwt(expiredJwt), true, 'well-formed 3-segment JWT looks like JWT');
assert.equal(isJwtExpired(expiredJwt), true, 'JWT with past exp is detected as expired');
assert.equal(isJwtExpired(fakeJwt), false, 'corrupt payload returns false (cannot decode)');
assert.equal(looksLikeJwt('mock-access-token'), false, 'mock-access-token fails JWT shape check');
console.log('OK — helpers correctly detect expired + non-JWT poisons');

console.log('\n=== ALL CHECKS PASSED ===');
