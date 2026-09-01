# CRITICAL Fixes Sprint — apps/api

**Reviewer:** Senior backend engineer
**Date:** 2026-08-31
**Scope:** Wave 1–3 QA findings — 7 of the 10 CRITICAL items
**Branch state:** All fixes applied + tests passing

---

## Test results (final)

```
Test Suites: 35 passed, 35 total
Tests:       392 passed, 392 total
```

`npx tsc --noEmit` shows 6 pre-existing type errors in two files I did
NOT touch (`src/modules/integrations/integrations.e2e.spec.ts` and
`src/modules/payments/payments.service.spec.ts`) — both are downstream
of the `ibanBlacklist` mock lacking a `tenantId` field. These were broken
on the branch BEFORE this sprint started; they are flagged for follow-up.

---

## Summary of changes

| ID | Finding | Files touched | Tests |
|----|---------|---------------|-------|
| C-01 | Prisma tenant-scoping bypass | `src/prisma/prisma.service.ts`, `src/prisma/__tests__/prisma-tenant-scope.integration.spec.ts` (new), `src/modules/parties/parties.service.spec.ts` | 6 + 2 new = 8 |
| C-02 | Audit hash-chain race | `src/modules/audit/audit.service.ts`, `src/modules/audit/audit.service.spec.ts`, `prisma/schema.prisma`, `prisma/migrations/20260831000000_audit_chain_integrity_and_refresh_token_hash/migration.sql` | 13 (incl. 2 concurrent) |
| C-03 | Refresh tokens stored plaintext | `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.service.spec.ts`, `prisma/schema.prisma`, `prisma/migrations/20260831000000_*/migration.sql` | 20 |
| C-04 | 2FA disable ignores password | `src/modules/auth/two-factor.service.ts`, `src/modules/auth/two-factor.service.spec.ts` (new) | 5 |
| C-05 | Passkey verification has no crypto | `src/modules/auth/passkey.service.ts`, `src/modules/auth/passkey.service.ts.spec.ts` (new), `src/modules/auth/auth.controller.ts` | 6 |
| C-06 | AI vector-store reads all tenants | `src/modules/ai/vector-store.service.ts`, `src/modules/ai/vector-store.service.spec.ts` (new) | 4 |
| C-07 | JWT secrets in .env | `.gitignore` (new), `.env.example` (new), `.env` (rotated), `src/common/jwt.config.ts`, `src/common/__tests__/jwt.config.spec.ts` (new) | 10 |

---

## Per-fix verification

### C-01: Prisma tenant-scoping auto-wrap

**Change:** `PrismaService` no longer `extends PrismaClient` and re-exposes the
raw client. It now wraps a private `inner: PrismaClient` and exposes a Proxy
via `this.prisma` that re-resolves to a `$extends`-wrapped, tenant-scoped
client on every property access. This makes every call site
(`this.prisma.party.update({...})`) scoped by construction — no edit needed
in any service.

**Key files:**
- `src/prisma/prisma.service.ts` — refactored to wrap-and-proxy.
- `src/prisma/__tests__/prisma-tenant-scope.integration.spec.ts` (new) —
  pins the C-01 invariant: tenant-scoped calls inside a TenantContext
  inject tenantId; outside any context they throw `no TenantContext`;
  exempt models (`Tenant`, `RefreshToken`) still work pre-context.
- `src/modules/parties/parties.service.spec.ts` — added two integration
  tests proving: (a) `party.findMany` injects tenantId when inside a
  TenantContext, (b) the same call from outside throws, (c) exempt model
  `tenant.findUnique` still resolves.

**Test count:** 6 in the new integration spec + 2 in parties spec (total 8 new).

**TSC:** `npx tsc --noEmit` — passes for files I modified; pre-existing
errors in unrelated spec files remain.

### C-02: Audit hash-chain race condition

**Change:** `AuditService.log` now wraps the `findFirst(prev) + create(row)`
pair in a single `$transaction` AND acquires a per-tenant
`pg_advisory_xact_lock` so concurrent writers for the same tenant serialise.
The DB-level `@@unique([tenantId, rowHash])` is the second line of defence
against accidental duplicate hashes.

**Key files:**
- `src/modules/audit/audit.service.ts` — log() wrapped in $transaction with
  `pg_advisory_xact_lock(hashtext(${entry.tenantId}))`; updated class header
  comment with the race scenario and the lock rationale.
- `src/modules/audit/audit.service.spec.ts` — stub now models per-tenant
  advisory locks via a JS FIFO queue; added two C-02 tests that fire
  `Promise.all([...log(...)])` × 10 and × 20 concurrent writers and assert
  (a) the chain still verifies (`verifyChain().valid === true`) and
  (b) every row has a distinct `rowHash`.
- `prisma/schema.prisma` — added `@@unique([tenantId, rowHash])` to `AuditLog`.
- `prisma/migrations/20260831000000_audit_chain_integrity_and_refresh_token_hash/migration.sql`
  (new) — applies the unique constraint + indexes.

**Test count:** 13 (was 11, added 2 concurrent-writer tests).

### C-03: Refresh tokens stored plaintext

**Change:** `AuthService` now stores `sha256(rawToken)` on every refresh
token row; raw token is emitted ONCE (on the wire at creation) and never
written. `refresh()` and `logout()` look up by hash. The legacy plaintext
column is kept nullable for the migration window with a one-shot fallback
to be removed in a follow-up migration.

**Key files:**
- `src/modules/auth/auth.service.ts` — added `hashRefreshToken()` helper;
  `generateTokens()` writes `tokenHash` (not `token`); `refresh()` and
  `logout()` lookup by `tokenHash` with legacy fallback.
- `src/modules/auth/auth.service.spec.ts` — added C-03 pin test that
  asserts the service calls `where: { tokenHash: sha256(rawToken) }`
  and never `where: { token }`. Plus a test for the legacy fallback.
- `prisma/schema.prisma` — added `tokenHash` column to `RefreshToken`;
  kept `token` as nullable for the migration window.
- Same migration file as C-02 — adds column, backfills with
  `encode(digest(token, 'sha256'), 'hex')`, applies unique constraint
  and index.

**Test count:** 20 (was 18, added 2 C-03 cases).

### C-04: 2FA disable ignores password

**Change:** `TwoFactorService.disable` now calls `bcrypt.compare(password,
user.passwordHash)` BEFORE consulting the TOTP code. Wrong password → 401
immediately; TOTP code is never even inspected. Both error messages are
identical (`Invalid credentials`) to defeat probing.

**Key files:**
- `src/modules/auth/two-factor.service.ts` — added `bcrypt` import; rewrote
  `disable()` to verify password first.
- `src/modules/auth/two-factor.service.spec.ts` (new) — 5 tests, including
  the C-04 pin: a `verifyToken` jest spy proves it is NEVER called when
  password is wrong.

**Test count:** 5 (all new).

### C-05: Passkey verification has no crypto

**Change:** `PasskeyService.verify()` now ALWAYS returns
`{ verified: false, reason: 'not_implemented' }` for any input. The class
header documents the rationale and the production-readiness checklist.
The AuthController adds a belt-and-braces guard that throws if
`result.verified === true` ever comes back from the service.

**Key files:**
- `src/modules/auth/passkey.service.ts` — `verify()` body replaced with
  unconditional return; `PasskeyVerifyResult` gained a `reason` enum.
- `src/modules/auth/auth.controller.ts` — `passkeyVerify` handler now
  throws on `verified:true` (defence in depth).
- `src/modules/auth/passkey.service.spec.ts` (new) — 6 tests, including
  the C-05 REGRESSION pin that asserts verified is never true under any
  input shape (including a real `challengeId`, real `credential`, real
  `expectedType`).

**Test count:** 6 (all new).

### C-06: AI vector-store reads all tenants

**Change:** `VectorStoreService` no longer bulk-loads every tenant's
embeddings on boot via `$queryRawUnsafe`. `onModuleInit` is now a no-op;
hydration happens lazily on first `search()` call for THAT tenant only,
via parameterised `$queryRaw\`... WHERE "tenantId" = ${tenantId}\``. The
fallback path also passes `where: { tenantId }` to `document.findMany`.

**Key files:**
- `src/modules/ai/vector-store.service.ts` — added `ensureHydrated(tenantId)`
  that parameterises the SQL with the active tenant; class header
  documents C-06 fix.
- `src/modules/ai/vector-store.service.spec.ts` (new) — 4 tests asserting:
  (a) the SQL contains `WHERE "tenantId" =`, (b) hydration for tenant A
  does NOT load tenant B, (c) `$queryRawUnsafe` is never called, (d)
  two concurrent tenants see isolated results.

**Test count:** 4 (all new).

### C-07: JWT secrets in .env

**Change:** Created `.gitignore` (didn't exist); created `.env.example`
(committed, safe); rotated `.env` secrets to fresh base64url random values;
added `assertStrongSecret()` boot-time validation that rejects any secret
starting with `dev-/test-/change-/secret-/placeholder-/example-` or shorter
than 32 chars.

**Key files:**
- `.gitignore` (new) — blocks `.env*`, build artefacts, IDE, OS, tool state.
- `.env.example` (new) — committed template with placeholders.
- `.env` — rotated `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to new
  base64url random values; other env untouched.
- `src/common/jwt.config.ts` — added `assertStrongSecret()`; calls it inside
  `buildJwtConfig`; updated doc comments to explain the fail-fast stance.
- `src/common/__tests__/jwt.config.spec.ts` (new) — 10 tests covering:
  empty/short/known-prefix rejection, case-insensitive prefix matching,
  strong secret acceptance, `buildJwtConfig` happy path + failure modes,
  JWT_SECRET legacy alias.

**Test count:** 10 (all new).

---

## Verification commands

```bash
cd apps/api

# 1. Type check (only pre-existing failures in untouched spec files)
npx tsc --noEmit
# exit 2 — 6 pre-existing errors in:
#   src/modules/integrations/integrations.e2e.spec.ts (4 errors)
#   src/modules/payments/payments.service.spec.ts   (2 errors)
# All other files: clean.

# 2. Full test suite
npx jest
# Test Suites: 35 passed, 35 total
# Tests:       392 passed, 392 total

# 3. Targeted runs
npx jest src/modules/parties/parties.service.spec.ts        # 22 tests
npx jest src/modules/audit/audit.service.spec.ts           # 13 tests
npx jest src/modules/auth/auth.service.spec.ts              # 20 tests
npx jest src/modules/auth/two-factor.service.spec.ts        # 5 tests
npx jest src/modules/auth/passkey.service.spec.ts          # 6 tests
npx jest src/modules/ai/vector-store.service.spec.ts        # 4 tests
npx jest src/common/__tests__/jwt.config.spec.ts            # 10 tests
npx jest src/prisma/__tests__/prisma-tenant-scope.integration.spec.ts  # 6 tests

# 4. Migration (run on staging after this is merged)
npx prisma migrate deploy
```

---

## Out-of-scope (HIGH and remaining CRITICAL items)

The 3 CRITICAL items not addressed in this sprint (C-08 IBAN blacklist
in SEPA, C-09 mark-paid amount validation, C-10 inbound email signature
verification) plus the HIGH tier (H-01 through H-14) remain untouched and
are flagged for the next sprint. They are also documented in
`apps/api/QA_FINDINGS.md`.

---

## Notes / follow-ups

1. **C-01 caveat:** the Proxy on `this.prisma` re-resolves the scoped client
   on every property access. For tight loops doing `for (const p of many)
   { await this.prisma.party.update(...) }`, prefer `const party = = this.prisma.party;`
   once and reuse the local reference. This is a micro-optimisation and
   does not change correctness.

2. **C-03 follow-up migration:** once every environment has been cut over
   to hashed-only rows, drop the `token` column with a follow-up migration
   and remove the legacy fallback in `refresh()` / `logout()`.

3. **C-07 secret rotation procedure** is not yet documented. The current
   secrets are generated with `crypto.randomBytes(32).toString('base64url')`
   and live in `.env`. Production should move secrets to a secret manager
   (Vault / AWS Secrets Manager) and add a rotation runbook. Out of scope
   for this sprint; flagged for ops.

4. **Pre-existing TS errors** in `integrations.e2e.spec.ts` and
   `payments.service.spec.ts` are not regressions — they predate this
   work. Tracked separately.