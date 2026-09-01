# Production Readiness — Wave 3 Critical Path

Generated: 2026-08-30T23:46:00Z  
Validator: Grok 4.6 (test architect)  
Target: DocFlow API `http://localhost:4000/api/v1`

**Go-live: NO**

Ship the tenant ALS + JWT dual-shape patch, apply a repaired audit/refresh-token migration, and re-run this suite against a stable API (Redis up or BullMQ fully lazy). Until then the product is not production-ready.

## Matrix

- [x] Playwright suite exists under `apps/api/e2e/` (19 tests, HTML + JSON reporters)
- [x] Auth happy path: login JWT, refresh rotation, `/auth/me` (passed)
- [x] Expired token / wrong JWT secret → 401 (passed)
- [x] Invalid IBAN rejected before write (passed)
- [x] IBAN blacklist returns 400 with a Portuguese message (passed)
- [x] Error envelope does not include stack traces when the API is up (passed)
- [ ] All critical flows pass E2E (upload / recon / SEPA / RBAC blocked by env instability)
- [ ] Performance baselines met (login ~215–500ms observed; 10MB/10k not measured cleanly)
- [x] Multi-tenant isolation **after** the ALS patch (manual probe: new tenant lists 0 parties)
- [ ] Multi-tenant isolation **before** the ALS patch (P0 leak: GET `/parties` returned another tenant’s seed rows)
- [ ] RBAC on `/payments/payables/:id/approve` not E2E-green this run (API died / 429)
- [ ] Audit hash-chain unique constraint cannot be applied (duplicate empty `rowHash`)
- [ ] Go-live: **NO**

## What was verified

### Auth
- `POST /auth/register` issues `{ user, tenant, tokens }` in the `{ data, meta }` envelope.
- `POST /auth/login` returns a 3-part JWT + opaque refresh token; reused refresh → 401.
- Invalid password and unknown tenant both return 401 `"Invalid credentials"` (no user enumeration).
- Forged JWT (wrong secret) and expired JWT → 401.

### Isolation (P0 — patched in this session)
Live probe **before** the patch: a freshly registered tenant’s `GET /parties` returned `seed-party-cliente` belonging to `tenantId=cmtf1scz20000g5s0n621bzef`.

Cause: Nest middleware runs **before** guards, so `TenantMiddleware` never saw `req.user`, never opened AsyncLocalStorage, and Prisma tenant scoping was a no-op. `@CurrentUser()` expected `id`/`tenantId` while the JWT carries `sub`/`tenant_id`.

Patch (must ship):
- `src/common/middleware/tenant.middleware.ts` — verify Bearer JWT, attach dual-shape user, wrap `next()` in `runWithTenantContext`.
- `src/common/guards/jwt.guard.ts` — map `sub`→`id`, `tenant_id`→`tenantId`, `roles[0]`→`role`.
- `src/prisma/prisma.service.ts` — `$connect`/`$transaction` no longer recurse through `inner === this`.

Live probe **after** the patch: `GET /parties` for a new tenant returned `items: []`; `POST /parties` created a row with matching `tenantId`.

### Input validation
- Invalid IBAN `PT00NOTANIBAN` → 400 `IBAN inválido`.
- Blacklisted IBAN → 400 mentioning blacklist.

## Playwright results (latest full-ish run)

| Area | Result | Notes |
|---|---|---|
| Auth login / refresh / JWT | PASS | 3/3 |
| Document upload → QR → payable | FAIL | Multer: `File is required` / `Unexpected end of form` from Playwright multipart; native FormData also missed the `file` field |
| Reconciliation loop | FAIL | Blocked on upload |
| SEPA export | FAIL | FK / 429 / API crash mid-suite |
| Parties anti-fraud | PARTIAL | Register works; later 429 from global throttle |
| Multi-tenant E2E | FAIL | 429 on second register; **manual isolation probe passed after patch** |
| RBAC OPERADOR | FAIL | API process died (ECONNREFUSED) |
| Performance 10MB / 10k CSV | NOT CLEAN | Login ~215ms on server log; suite interrupted |
| Errors / health | PARTIAL | Passes when API is up |

HTML report: `apps/api/test-results/e2e-html/index.html`  
JSON: `apps/api/test-results/e2e-results.json`

## Critical gaps (blockers)

1. **Tenant ALS was not bound on authenticated requests** (fixed in source, must be in the deployed build).
2. **Migration `20260831000000_audit_chain_integrity_and_refresh_token_hash` cannot apply** — unique `(tenantId, rowHash)` fails because existing audit rows have duplicate empty `rowHash`. Token-hash column was applied out-of-band (`token` made nullable).
3. **Redis down** — BullMQ/ioredis spam `ECONNREFUSED` and the API process has died mid-suite. Extraction fallback exists; the process is not crash-proof.
4. **Global throttle 100/min** plus an external `/auth/login` flood from localhost exhausts the bucket. Login bucket is 5/15min per IP — NAT/shared IP will lock out real users.
5. **No public API to set tenant IBAN/BIC** — SEPA export 400s until a DB patch. Seed IBANs in `iban.util.ts` are documented as failing MOD-97.
6. **`GET /api/v1/health/full` was 404** on the previous process; liveness `/health` works.
7. **Payables without `documentId` are skipped by the matcher** — reconciliation of manual payables is incomplete.
8. **Generic `Error` from extraction `applyAtQr` is not an HttpException** — becomes 500 and can leak `exception.message`.
9. **PrismaService `inner === this`** caused `$connect` stack overflow after rebuild; patched, but the wrapper still needs a real inner client.

## Performance (observed, not a clean harness)

| Endpoint | Observed | Budget | Verdict |
|---|---|---|---|
| POST /auth/login | ~215–500ms (bcrypt 12) | < 500ms | Borderline; often OK |
| POST /documents/upload 10MB | not measured | < 3s | Blocked |
| POST /banking/csv/import 10k | not measured | < 10s | Blocked |
| POST /reconciliation/run | not measured | < 5s | Blocked |
| POST /payments/sepa/export | not measured | < 2s | Blocked |
| List pagination | code review: `skip`/`take` + `meta.limit` capped | — | Implemented in documents/parties/payments/banking |

## Error scenarios

| Scenario | Status |
|---|---|
| DB down | Health returns `{ db: "down" }` without connection strings (code) |
| Redis down | Extraction falls back in-process; ioredis still throws unhandled noise |
| Malformed CSV | 400 when API is up |
| IBAN blacklist | 400 user-friendly |
| Duplicate NIF | 409 when not throttled |
| Resumable upload | **Not implemented** |

## How to re-run

```powershell
cd apps/api
# Redis + Postgres up; THROTTLE_LIMIT=100000 for local E2E
pnpm exec nest build
node dist/src/main.js
npx playwright test --config e2e/playwright.config.ts
```

Reports land in `apps/api/test-results/`.

## Sign-off

| | |
|---|---|
| Critical flows E2E | **NO** (upload + recon + SEPA not green) |
| Isolation | **CONDITIONAL** (green only with the ALS patch deployed) |
| Secrets in errors | **YES** (when API up) |
| Audit chain | **NO** (empty hashes, unique constraint cannot apply) |
| RBAC | **UNPROVEN** this run |
| **Go-live** | **NO** |
