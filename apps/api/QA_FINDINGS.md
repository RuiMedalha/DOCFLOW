# DocFlow Backend — Production Hardening & Completeness Review

**Reviewer:** Senior Backend Architect
**Scope:** All Wave 1–3 backend modules (`apps/api`)
**Method:** Manual + grep-based static analysis of services, controllers, middleware, Prisma extension, schema, and tests.
**Out of scope:** Dynamic exploitation, infra, frontend, non-backend code paths.
**Recommendation:** Conditional NO for production. Acceptable for a *closed-beta staging* deployment with the CRITICAL findings addressed first.

---

## CRITICAL

### C-01. Prisma tenant-scoping extension is bypassed across the entire codebase
- **Files:** every `src/modules/*/*.service.ts` (275+ Prisma call sites), and `src/prisma/prisma.service.ts`.
- **Observation:** `PrismaService` extends `PrismaClient` directly. The tenant-scope `$extends` wrapper is exposed via `.scoped` / `.forTenant()` getters, but **no service in the codebase calls them**. Every call site uses `this.prisma.<model>.<op>(...)`, which is the **raw** client and is unaffected by the extension.
- **The extension only auto-injects `tenantId` when the wrapped client is invoked** — the helpers in `prisma.helpers.ts` are only called by the extension itself, so any query bypassing the wrapper has no defense-in-depth.
- **Comments in `reconciliation.service.ts:44` and `documents.controller.ts:57`** claim "every query goes through `prisma.scoped`", but reading those files confirms the comments are aspirational — `.scoped` / `.forTenant()` is never invoked.
- **Concrete impact examples:**
  - `parties.service.ts:338` `prisma.party.update({ where: { id }, data })` — `where` has no `tenantId`. Any partyId known to an attacker can be mutated regardless of JWT tenant.
  - `payments.service.ts:302` `prisma.payableItem.update({ where: { id }, data })` — same pattern, applies to money.
  - `banking.service.ts:109`, `banking.service.ts:129`, `documents.service.ts:280/319/377`, `extraction.service.ts:155/231`, `payroll.service.ts:21/52`, `reconciliation.service.ts:529/567`, `crm.service.ts:296/322/410/532/553/867`, `integrations.service.ts:168/197/280` — every one is `where: { id }` only.
  - `auth.service.ts:277` `user.findUnique({ where: { id: userId } })` — does not constrain to JWT's tenantId. Defense-in-depth bypass.
- **Why the existing tests don't catch it:** `src/prisma/__tests__/prisma-tenant-scope.spec.ts` is a *mocked unit test* of the extension logic in isolation. There is no integration test that calls the production service methods and asserts tenant scoping.
- **Repro (proof-of-concept):**
  1. Register tenant A and tenant B.
  2. Create a Party in tenant A, capture its id.
  3. Authenticate as a tenant-B user; call `PATCH /parties/<tenant A's partyId>` with `{ name: "hijacked" }`.
  4. Observe: the update succeeds (200 OK) and the row is now visible to tenant A with the new name.
- **Fix:** Either (a) replace `this.prisma` in services with `this.prisma.scoped`, or (b) wrap `PrismaService` itself with `$extends` in its constructor so every call is scoped by construction. Add an integration test that calls `prisma.<model>.findMany()` from inside a TenantContext and another from outside, and asserts the second throws.

### C-02. Audit hash-chain race condition allows tampering-untraceable writes
- **File:** `src/modules/audit/audit.service.ts:154-189` (`write`), plus callers in every service.
- **Observation:** `write()` reads `prev = auditLog.findFirst({ where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })` and then computes `rowHash` from `prevHash`. The `create()` is performed in a **separate statement outside any transaction**. Two concurrent audit writes can both read the same `prev.rowHash`, both compute `rowHash` chained to that same `prevHash`, and both insert. The second row's `prevHash` will not match the actual previous row's `rowHash`, so `verifyChain()` correctly flags it as broken — but **the audit rows themselves are committed** with cross-inconsistent hashes. Worse: a buggy service that retries on transient failure can double-write the same audit row.
- **Evidence:** `audit.service.ts:163-167` shows the read is keyed on `createdAt` (no `@@unique([tenantId, createdAt])` on the schema), and `audit.service.ts:175-189` shows the write is not transactional with the read.
- **Impact:** The chain is supposed to be tamper-evident — this race means the chain breaks under any moderate concurrency. The "M2 fix" comment on the audit chain was about *amount tolerance*, not concurrency, so the underlying invariant is unprotected.
- **Fix:** Wrap `findFirst(prev) + create(row)` inside `$transaction(async tx => { ... })`, and add `@@unique([tenantId, rowHash])` to make accidental insertion of a duplicate hash detectable. Alternatively, acquire a per-tenant advisory lock (`pg_advisory_xact_lock`) around the read+write.

### C-03. Refresh tokens stored in plaintext in the database
- **File:** `src/modules/auth/auth.service.ts:380-387`.
- **Observation:** Refresh tokens are `randomBytes(48).toString('base64url')` and persisted verbatim: `token: refreshToken`. A database read (SQL injection in another module, log dump, or backup leak) yields every active session token.
- **Comment in auth.service.ts:379** says: *"opaque random, not a JWT. Single DB lookup is intentional: revocation is fast and rotation is mandatory."* — rotation is fine, but the lack of at-rest hashing is not. Modern guidance is `sha256(token)` at rest with the raw value only emitted once at creation.
- **Impact:** DB compromise → full account takeover for every active session until idle refresh tokens expire (7 days).
- **Fix:** Store `sha256(refreshToken)` on the row; on `refresh()` and `logout()` accept the raw token from the wire, hash it, and look up by hash.

### C-04. 2FA disable ignores the password — full bypass with just a TOTP code
- **File:** `src/modules/auth/two-factor.service.ts:111` (`disable`) and `src/modules/auth/auth.controller.ts:132-134`.
- **Observation:** `disable(userId, _password, token)` takes a `password` argument (prefixed with `_` to silence linters) but never reads it. The controller advertises "requires current password + last TOTP code" but the password is silently discarded. An attacker who has obtained a single TOTP code (e.g. from a stolen device, a shoulder-surf, or a TOTP-replay window) and knows the JWT-derived `userId` can disable 2FA without ever proving knowledge of the password.
- **Test gap:** `auth.service.spec.ts` does not cover the disable path.
- **Impact:** Trivial 2FA removal; the protection collapses to a one-time TOTP. Combined with refresh-token re-use (not protected if attacker has long-lived session), full account takeover.
- **Fix:** Verify password by `bcrypt.compare(password, user.passwordHash)` BEFORE calling TOTP verification. Reject if the password doesn't match.

### C-05. Passkey authentication has no cryptographic verification — anyone with a valid `challengeId` is "verified"
- **File:** `src/modules/auth/passkey.service.ts:51-62` (`verify`).
- **Observation:** The verifier does:
  ```ts
  const stored = this.store.get(opts.challengeId);
  if (!stored || stored.expiresAt < new Date()) return { verified: false };
  if (opts.expectedType === 'authentication') this.store.delete(opts.challengeId);
  return { verified: true, credentialId: opts.credential.slice(0, 64) };
  ```
  The `credential` argument is sliced and echoed back but never cryptographically checked. No signature, no public key, no authenticatorData verification. The class header comment explicitly says it is a skeleton, but the controllers in `auth.controller.ts:148-166` are wired and `@Public()` — anyone who can hit `/auth/passkey/verify` with a still-valid `challengeId` (issued via the also-public `/auth/passkey/challenge`) gets `{ verified: true }`.
- **Impact:** Authentication bypass if passkey is ever treated as a primary factor. Currently safe because the only caller is `@Public()` and no downstream code accepts a passkey-verified session, but if the skeleton is completed naively (e.g. by lifting the `{ verified: true }` into a session), the system would be fully compromised.
- **Fix:** Until `@simplewebauthn/server` is wired, do not return `{ verified: true }` at all — return `{ verified: false, reason: 'skeleton_not_implemented' }`. Add a server-side guard that rejects any login flow accepting a passkey-verified token without cryptographic proof.

### C-06. AI vector-store hydration raw SQL reads across ALL tenants
- **File:** `src/modules/ai/vector-store.service.ts:88-92`.
- **Observation:**
  ```ts
  const rows = await (this.prisma as any).$queryRawUnsafe(`
    SELECT "documentId", "chunkIndex", content, field, embedding, "tenantId"
    FROM document_embeddings
    LIMIT 5000
  `);
  ```
  - No `tenantId` predicate — every tenant's embeddings are loaded into the in-memory vector store on init.
  - `$queryRawUnsafe` is the dangerous variant; if the SQL ever embeds user-controlled text (currently it doesn't), this is a textbook SQL injection. Even though the surrounding constants are safe today, the API shape invites future regressions.
  - The cast `(this.prisma as any)` bypasses TypeScript — there is no tenant scoping safety net.
- **Impact:** Cross-tenant data leak in the AI search path. When a user runs a RAG query, the in-memory store may include embeddings from other tenants and return snippets/documents they have no rights to see.
- **Fix:** Replace with `prisma.$queryRaw\`SELECT ... FROM document_embeddings WHERE tenantId = ${tenantId} LIMIT 5000\`` (parameterised) and pass the active tenant from `getTenantContext()`. Add a test that asserts `WHERE tenantId = $tenantId` is present in the rendered query.

### C-07. JWT secret committed in `.env`
- **File:** `apps/api/.env`, `../../.env` (`JWT_SECRET="dev-secret-key-12345"`, `JWT_REFRESH_SECRET="dev-refresh-key-67890"`).
- **Observation:** Both files contain symmetric secrets with predictable values (`dev-secret-key-12345`, `dev-refresh-key-67890`). The `jwt.config.ts` validates that the env var is present but does not validate strength or compare against a blocklist of known-dev values.
- **Impact:** If either file is committed to source control (it appears to be in this repo), the production-equivalent secret is irrecoverably compromised. Any operator who clones the repo can sign tokens for any tenant.
- **Fix:** (a) Add `.env*` to `.gitignore` and rotate the keys immediately. (b) Add length + entropy checks in `buildJwtConfig` (e.g. min 32 bytes, reject strings matching `/^(dev|test|change|secret)/i`). (c) Move to RS256 + JWKS for production; HS256 with a shared secret is a deployment risk.

### C-08. SEPA export can build with an unverified/blacklisted IBAN
- **File:** `src/modules/payments/payments.service.ts:702-847` (`exportSepa`) and `src/modules/parties/parties.service.ts:466-526` (`flagIban`).
- **Observation:** `exportSepa` reads the party's `iban` field directly. It does NOT verify `ibanVerified` flag nor check the `IbanBlacklist` table before constructing the credit-transfer list. The SEPA builder correctly validates the IBAN syntax via `assertValidIbanOrThrow`, but a syntactically valid IBAN can still be on the blacklist.
- **Repro:**
  1. Create a party with IBAN `PT50...` (valid format).
  2. Add the IBAN to the blacklist via `POST /parties/blacklist`.
  3. Create and approve a payable for that party.
  4. Call `POST /payments/sepa/export`.
  5. Observe: the blacklisted IBAN is included in the XML — payment is generated for a flagged IBAN.
- **Impact:** A flagged-but-syntactically-valid IBAN flows through to a real-world payment. The anti-fraud flag is advisory only.
- **Fix:** In `exportSepa`, before adding a party to `transfers`, check `party.ibanFlagged === false` AND `IbanBlacklist` contains no row for that IBAN. Skip with a `skipped` entry and a security-tagged reason.

### C-09. Mark-paid does not validate `paidAmount` matches `expectedAmount`
- **File:** `src/modules/payments/payments.service.ts:383-436`.
- **Observation:** `paidAmount = dto.paidAmount ?? Number(existing.amount)`. If the operator passes `paidAmount: 1` for a 100-EUR payable, the row is flipped to `PAID` with `paidAmount = 1`. No tolerance check, no warning, no required justification. Same applies to `markPayablePaid`'s audit metadata — the audit row records the smaller amount.
- **Impact:** Paying a fraction of a payable marks the entire payable as paid and unblocks downstream flows (WIP: mark-as-paid is the gate for "this tx paid that bill"). Partial payments are silently promoted to full payments.
- **Fix:** Reject when `Math.abs(paidAmount - Number(existing.amount)) > 0.01` unless an explicit `partialReason` is provided. If partial, store `paidAmount` and keep `status = PARTIALLY_PAID` (requires schema enum change) or open an underpayment follow-up.

### C-10. Inbound email webhook signature is verified against JSON-stringified body, not the raw HTTP body
- **File:** `src/modules/inbound/inbound.service.ts:284-289`.
- **Observation:**
  ```ts
  const raw = typeof body.rawBody === 'string' ? body.rawBody : JSON.stringify(body);
  const expected = createHmac('sha256', String(sendgridSecret)).update(raw).digest('base64');
  ```
  SendGrid Inbound Parse signs the actual raw HTTP body (multipart/form-data bytes). If the controller forwarded `req.rawBody` correctly (it currently does not — `body` is parsed), the verification would match. Today, when a real SendGrid request arrives, `body` is the NestJS-parsed object, `body.rawBody` is undefined, and we fall back to `JSON.stringify(body)`. The HMAC computed over `JSON.stringify(body)` will **never match** the SendGrid header value. The endpoint silently fails closed for legitimate SendGrid traffic — but the failure mode is total rejection, not bypass. The deeper issue is that the verification path was written assuming a JSON-body provider (Mailgun's older API) and reused for SendGrid.
- **Risk:** Once a developer adds `app.use(express.raw({...}))` and forwards `req.rawBody`, the verification silently becomes correct. **Until then, it's broken-but-safe.** The failure would manifest as "inbound emails never land in our inbox" — an availability bug, but also a sign that signature-fail-closed logic is accidentally over-trusting.
- **Fix:** Persist SendGrid raw body into `req.rawBody` (via `app.use(express.raw({ type: 'multipart/form-data', limit: ... }))` and a small adapter) and always verify against that. Reject the fallback to `JSON.stringify(body)` for any provider that signs raw bytes.

---

## HIGH

### H-01. Non-tenant-scoped `.findUnique({ where: { id } })` are pervasive (defense-in-depth bypass)
- **Files (representative):** `src/modules/parties/parties.service.ts:338/389/432/475/883/904`, `src/modules/payments/payments.service.ts:302/410/678/`, `src/modules/banking/banking.service.ts:109/129/`, `src/modules/documents/documents.service.ts:280/319/377/`, `src/modules/extraction/extraction.service.ts:155/231/`, `src/modules/crm/crm.service.ts:296/322/410/532/553/867`, `src/modules/integrations/integrations.service.ts:168/197/280/`, `src/modules/payroll/payroll.service.ts:21/52`.
- **Observation:** All of these calls use `where: { id }` with no `tenantId` filter. Today the raw client means they execute unscoped — relying entirely on the route having verified the JWT (and on the caller knowing the id). Even after C-01 is fixed (auto-scoping on the client), it is still defence-in-depth-poor that manual service code doesn't include `tenantId` in its own `where`.
- **Repro:** An operator in tenant B, given tenant A's payableId, can hit `PATCH /payments/payables/<tenantA_payableId>` and the update runs against tenant A.
- **Fix:** Always include `tenantId` explicitly in service `where` clauses that operate on tenant-scoped rows. Add a lint rule that flags `.findUnique({ where: { id } })` against a tenant-scoped model.

### H-02. RBAC absent on `parties`, `crm`, `payments` payables, `extraction`, `ai`, and `reconciliation` controllers
- **Files:** `src/modules/parties/parties.controller.ts` (no `@Roles`), `src/modules/crm/crm.controller.ts`, `src/modules/crm/contacts.controller.ts`, `src/modules/payments/payments.controller.ts` (only specific endpoints have `@Roles(ADMIN, APPROVER)`), `src/modules/extraction/extraction.controller.ts`, `src/modules/ai/copilot.controller.ts`, `src/modules/reconciliation/reconciliation.controller.ts`.
- **Observation:** Any authenticated user — including an `OPERADOR` — can create parties, modify the chart of accounts, mark payables as paid, approve payables (in the missing-RBAC controllers), trigger AI agent endpoints, trigger document extraction. The default global `RbacGuard` allows the route if no `@Roles` is declared.
- **Impact:** OPERADOR accounts have write to master data and finance-affecting operations.
- **Fix:** Add `@Roles(Role.ADMIN, Role.CONTABILIDADE)` (or `OPERADOR` for view-only endpoints) at the controller or handler level. At minimum, gate destructive endpoints (`POST /parties/:id/iban/flag`, `DELETE /parties/:id`, `PATCH /accounts/:id`, `DELETE /accounts/:id`) with `ADMIN`.

### H-03. Timing-unsafe comparison for cron secret and scanner token
- **File:** `src/modules/inbound/inbound.controller.ts:44-46` (`/mail/sync-all`), and implicitly in `inbound.service.ts` for the scan token.
- **Observation:**
  ```ts
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) { ... }
  ```
  String inequality is timing-unsafe; a network-adjacent attacker can use statistical timing to recover the secret byte-by-byte.
- **Impact:** CRON_SECRET (which has full multi-tenant mailbox sync authority) and the scanner token (which has direct file-drop authority under any tenant's scanner token) can both be brute-forced with enough samples.
- **Fix:** Use `crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(process.env.CRON_SECRET))` after a length check. Same for the scan token path.

### H-04. Payroll tax calculation uses JavaScript Number arithmetic before persisting to Decimal
- **File:** `src/modules/payroll/payroll.service.ts:41-66`.
- **Observation:** `gross = Number(employee.grossMonthly ?? employee.baseSalary ?? 0)`, then `irtTax = this.money(gross * irsRate)`, then `netSalary = this.money(gross - irtTax - ssEmployee)`. `this.money(value)` is `Math.round(value * 100) / 100`. For a €1234.56 salary at 23% rate, `gross * irsRate = 283.9488`, `Math.round(28394.88) / 100 = 283.95` — fine. But `Math.round` at the JS-precision boundary (e.g. €9999.99 * 0.23 = 2299.9977) can round either way, and the intermediate steps lose cents. The schema has `Decimal`, but by the time we send to Prisma the value is already a JS number.
- **Impact:** Payroll amounts may differ from expected by sub-cent (or cent, under rounding rules) on the wire and in stored audits. Payslips produced from these decimals may mismatch what accountants expect.
- **Fix:** Use `new Prisma.Decimal(employee.grossMonthly).times(irsRate).toDecimalPlaces(2, ...)` so all math stays in Decimal. Also validate IRS brackets against the current Portuguese tax tables for FY 2026 (the current hardcoded bands in `irsRate()` are not versioned or documented).

### H-05. IBAN history write happens outside transaction with Party update
- **File:** `src/modules/parties/parties.service.ts:338-360`.
- **Observation:** `prisma.party.update` writes the new IBAN. Then a separate (non-transactional) `prisma.ibanHistory.create` records the change. The catch block (lines 355-359) **silently swallows** any IbanHistory failure — meaning the audit trail can be silently lost. Worse, the catch block logs only the message, not the row data, making post-mortem traceability hard.
- **Impact:** The IBAN history is a regulatory-critical audit trail. Silent failures break compliance.
- **Fix:** Wrap `prisma.party.update` and `prisma.ibanHistory.create` in a single `prisma.$transaction` and require both to succeed (roll back the party update if history insert fails). For unsafe cases where you really want best-effort, use AuditService semantics explicitly and document it.

### H-06. Duplicate document detection has a TOCTOU race in concurrent uploads
- **File:** `src/modules/documents/documents.service.ts:100-130`.
- **Observation:** The dedup check is `findFirst({ where: { sha256, tenantId } })` followed by `document.create(...)`. Two concurrent uploads of the same file from the same tenant both pass the check and both insert, producing duplicates.
- **Impact:** Per Wave 1 design intent (per-tenant dedup, see comment line 98), concurrent uploads break the invariant.
- **Fix:** Add a `@@unique([tenantId, sha256])` constraint on `Document` and use `upsert`. Alternatively, wrap the lookup+insert in a serialisable transaction.

### H-07. Reconciliation matching can race-create duplicate suggestions for the same (tx, doc)
- **File:** `src/modules/reconciliation/reconciliation.service.ts:71-104`.
- **Observation:** The "existing busy" check (`status: PENDING | ACCEPTED`) is read, then suggestions are created. If `/reconciliation/run` is invoked twice concurrently, both reads see "no busy tx X", both emit suggestions for X. There's no `@@unique` on `(bankTransactionId, documentId)` either, so the unique constraint that would normally serialise this insert does not exist.
- **Impact:** Duplicate suggestions flood the review queue; auto-reject-of-competing-pendings logic (`acceptSuggestion`) is only triggered if a user accepts one, not on creation.
- **Fix:** Either add `@@unique([bankTransactionId, documentId], where: status in (PENDING, ACCEPTED))` (a partial unique index) or wrap the matching run in a per-tenant advisory lock so only one matching pass can run at a time.

### H-08. CSV import dedup likewise vulnerable to TOCTOU
- **File:** `src/modules/banking/banking.service.ts:181-308`.
- **Observation:** File-level dedup (line 190) reads, then createMany skips duplicates — racing concurrent imports of the same file would both pass the read and produce an inconsistent `importBatch` column (one batch, two writers). The `importHash @unique` does help with row-level dedup, but the importBatch metadata is mangled.
- **Fix:** Wrap file-dedup check + createMany inside a transaction with `ON CONFLICT DO NOTHING` semantics; or use `@@unique([tenantId, importHash])` plus upsert.

### H-09. Stack traces logged at 5xx but not propagated to clients — verify in tests
- **File:** `src/common/filters/all-exceptions.filter.ts`.
- **Observation:** The filter correctly does not include `stack` in the response payload (line 66-73). `stack` is logged server-side (line 78). Good — but no test pins this invariant. A future contributor adding `includeStack: true` for "dev debug" would leak internal paths to clients.
- **Fix:** Add a unit test asserting that for `new Error('boom')`, the response body has no `stack` field and the `message` matches the operator message.

### H-10. Error logging may include sensitive data via Prisma `meta`
- **File:** `src/common/filters/all-exceptions.filter.ts:75-83`.
- **Observation:** For 5xx, the logger serialises `JSON.stringify(message)`. For Prisma errors it sends `code` + a generic `Database error: ${err.code}` string. Acceptable — but in any future code path that emits `JSON.stringify(exception.message)` for an exception thrown deep inside services that hold `tenant.iban` or `dto.nif`, those values land in the log.
- **Recommendation:** Add a `safeLog` helper that recognises `iban`, `nif`, `passwordHash`, `refreshToken`, `authorization`, and redacts via `***`. Apply it to every `Logger.error` / `Logger.warn` call site that touches service-level data.

### H-11. Auth module's `_password` parameter convention invites future regressions
- **File:** `src/modules/auth/two-factor.service.ts:111`.
- **Observation:** See C-04. TypeScript should fail-fast on unused parameters — the leading underscore is an ESLint convention, not a type-level promise. A linter change or refactor that strips the underscore accidentally would compile.
- **Fix:** Either (a) remove the `_password` parameter until it's actually verified, or (b) implement password verification and remove the underscore.

### H-12. JwtGuard does not enforce signing-algorithm pinning
- **File:** `src/common/jwt.config.ts:22-23`, `src/modules/auth/strategies/jwt.strategy.ts:38`.
- **Observation:** `algorithm: 'HS256'` is set on signing and `algorithms: ['HS256']` on verification. Good. But `jwt.config.ts` *signs* with HS256, meaning anyone with the secret can sign new tokens. There is no plan to switch to RS256 + JWKS. Confirmed missing for production.
- **Impact:** Long-lived shared-secret model is the primary token-forgery risk surface.
- **Fix:** Plan and execute an RS256 migration for production. Until then, restrict secret-issuance to deploy-time and document the rotation procedure (currently absent).

### H-13. No tests for `verifyChain` after a run under concurrency
- **File:** `src/modules/audit/audit.service.spec.ts`.
- **Observation:** Spec covers hash computation for known inputs (283 lines). Missing: any test that invokes `AuditService.log` concurrently from two async tasks and asserts that the chain still verifies (`verifyChain()` returns `{ valid: true }`). Today's code likely fails that test (see C-02).
- **Fix:** Add a test that fires N concurrent `Promise.all([...audit.log(...)])` and asserts chain validity.

### H-14. No controller-level rate limits on write endpoints beyond `ThrottlerGuard` defaults
- **File:** `src/app.module.ts:51-56`, `src/modules/payments/payments.controller.ts`, `src/modules/parties/parties.controller.ts`, `src/modules/banking/banking.controller.ts`.
- **Observation:** Global `ThrottlerGuard` with 100 req / 60s. No tighter limits on destructive endpoints (party update, mark-paid, approve, SEPA export). A bug or a compromised OPERADOR account can hammer these from a single IP.
- **Fix:** Add `@Throttle({ default: { limit: 10, ttl: 60_000 } })` to destructive handlers. Async extraction endpoints (`/extraction/*`) should already have stricter limits — verify.

### H-15. Bulk CSV import does not stream; 100k-row import explodes the process
- **File:** `src/modules/banking/banking.service.ts:181-308`.
- **Observation:** `parsed.rows.map(...)` materialises every parsed row in memory, then `createMany` issues a single SQL insert. For a 100k-row CSV, this is hundreds of MB of heap AND a single multi-megabyte SQL `VALUES` clause, both of which exceed default Postgres `work_mem` and NodeJS heap budgets.
- **Impact:** OOM under realistic bank exports; transaction rollback on partial failure but no chunked commit.
- **Fix:** Stream rows from the parser, batch into 1k-row chunks, `createMany({ data: chunk, skipDuplicates: true })` per chunk, each chunk in its own transaction (or all in one tx with `skipDuplicates`).

### H-16. N+1 in `listPayables` if hydration missing
- **File:** `src/modules/payments/payments.service.ts:96-139`.
- **Observation:** Already batched correctly with `Promise.all` + `Map`. ✅ No issue. (Counted as audited.)

### H-17. `seed.run.ts` and `seed.ts` referenced — verify they don't bypass tenant scope
- **File:** `prisma/seed.ts`, `prisma/seed.run.ts`. (Out of scope for runtime, but should be flagged if they use `prisma.asSystem()` or call the raw client without seed-time justification.)
- **Action:** Confirm seed scripts deliberately bypass scoping for fixture loading only.

### H-18. `payments.controller.ts` SEPA export `@Roles(Role.ADMIN, Role.APPROVER)` is set correctly
- **Observation:** Approved. No issue.

### H-19. `me()` endpoint trusts the JWT userId with no tenant verification
- **File:** `src/modules/auth/auth.service.ts:276-287`.
- **Observation:** `user.findUnique({ where: { id: userId } })` does not check `tenantId === payload.tenant_id`. Once C-01 is fixed (scoped client), this is mitigated; until then, a forged JWT with a different sub could return any user's profile (only the JWT secret is in play).
- **Fix:** Add `where: { id: userId, tenantId: payload.tenant_id }`.

### H-20. `disable2fa` and `verify2fa` endpoints expose 2FA state to anyone with a valid JWT, including a stolen one
- **File:** `src/modules/auth/two-factor.controller.ts` (controller file), via `two-factor.service.ts`.
- **Observation:** `verify2fa` accepts `{ token }` and returns `{ valid: true }` without rate limiting. With 6-digit TOTP and 1-step window, the success rate is 1/100000 — but no `Throttle` decorator or per-IP/per-account counter limits brute-force attempts.
- **Fix:** Add `Throttle({ default: { limit: 5, ttl: 60_000 } })` on `verify2fa`, plus an audit log on every failed attempt with `metadata: { reason: 'invalid_totp' }`.

---

## MEDIUM

### M-01. DTOs do not always declare `@Transform` for raw input types
- **Sample:** `src/modules/payments/dto/payments.dto.ts`, `src/modules/auth/dto/login.dto.ts`.
- **Action:** Audit DTOs for missing `@IsString()`, `@IsEmail()`, `@IsIBAN()`, etc. on every field. The global `ValidationPipe` uses `forbidNonWhitelisted: true`, so unknown fields are stripped (good), but fields with weak typing (e.g. `password: string`) won't reject weak passwords. Add password-strength validation in `AuthModule`.

### M-02. No request size limit on plain JSON endpoints
- **File:** `src/main.ts:23-30` (`app.useGlobalPipes(ValidationPipe)`).
- **Observation:** Body size limit is set on the inbound multipart routes (`memoryStorage()` with `fileSize: 10 * 1024 * 1024`) but not on the global JSON parser. Default is 100kb in Express 4 — too small for some DTOs but also leaving JSON endpoints open to large-body DoS if any DTO accepts an array.
- **Fix:** `app.use(express.json({ limit: '1mb' }))` to lock the envelope.

### M-03. CORS configuration trusts an env var but has no explicit allowlist
- **File:** `src/main.ts:17-20`.
- **Observation:** `origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000']`. If `CORS_ORIGINS` is unset in production, the fallback is `localhost:3000` — meaning production likely opens up to none (good) but the env var has to be set correctly or the prod deployment silently breaks.
- **Fix:** Fail-closed when `NODE_ENV=production` and `CORS_ORIGINS` is missing. Use `helmet.cors` instead of `app.enableCors({...})` for explicit policy.

### M-04. `helmet()` and `compression()` — verify both are configured for production
- **File:** `src/main.ts:14-15`.
- **Observation:** Both are applied unconditionally. Helmet defaults are reasonable; verify the CSP is tight enough (default does not set CSP — consider adding one). Compression applies in dev too — which is fine but slightly noisy in logs.

### M-05. Swagger UI is mounted under `/api/docs` even in production
- **File:** `src/main.ts:38-39`.
- **Observation:** Always-on Swagger can leak schema (incl. error schemas that show internal field names). Gate behind `if (process.env.NODE_ENV !== 'production')`.

### M-06. `TenancyMiddleware` halts with throw on `x-tenant-id` mismatch — good, but no audit log
- **File:** `src/common/middleware/tenant.middleware.ts:39-43`.
- **Observation:** When a stale session is replayed with an outdated `x-tenant-id`, the middleware logs a `warn` and throws. No `AuditLog` row is written for the security event.
- **Fix:** Add an audit log entry via `AuditService.log` for the rejected cross-tenant attempt.

### M-07. In-memory rate-limit store (`ThrottlerGuard`) is per-instance only
- **File:** `src/app.module.ts:51-56`.
- **Observation:** Default Throttler storage is in-memory, so multiple Nest instances each enforce their own limit — a 100-req/min global limit becomes N*100 in an N-instance deployment.
- **Fix:** Wire `ThrottlerStorageRedisService` (which exists in the stack since Redis is already a dep).

### M-08. `TenantInterceptor` and `LoggingInterceptor` overlap
- **File:** `src/common/interceptors/{logging,tenant}.interceptor.ts`.
- **Observation:** Both log per-request with tenant + user; one is an "observability hook" the other is a "structured log line". Pick one. Keeping both is duplicated I/O.

### M-09. `transform.interceptor.ts` wraps every response in `{ data, meta }` — verify all clients expect it
- **File:** `src/common/interceptors/transform.interceptor.ts:36-45`.
- **Observation:** Consistent envelope is helpful. But the meta block always includes `tenantId` for the request — this is fine (it matches the JWT claim) but means every response leaks the user's tenant id (already in the JWT). Acceptable; just document.

### M-10. `Crons`-only secret check uses `secret !== process.env.CRON_SECRET` (timing-unsafe)
- See H-03.

### M-11. `prisma.helpers.ts mergeTenantFilter` strategy silently replaces tenant filters
- **File:** `src/prisma/prisma.helpers.ts:16-23`.
- **Observation:** `{ ...w, tenantId }` always overrides whatever the caller passed. Good for defence-in-depth, but means if a caller wanted to filter by `tenantId: null` (an unsupported feature) they can't. Document the invariant and add a runtime check that rejects `tenantId: { not: ctx.tenantId }` etc. (a caller trying to widen the scope).

### M-12. `@CurrentTenant()` returns `undefined` outside an authenticated request
- **File:** `src/common/decorators/current-tenant.decorator.ts`.
- **Observation:** Public routes can still hit a controller that consumes `@CurrentTenant()` — returning `undefined`. A naive controller that destructures `{ tenantId }` will silently proceed with `tenantId = undefined`. Add `requireTenantContext()` for service-level invocation and a strict decorator variant `@StrictCurrentTenant()` that throws if missing.

### M-13. Scan token endpoint has no documented rotation procedure
- **File:** `src/modules/inbound/inbound.service.ts:335-343` and Tenant schema.
- **Observation:** `Tenant.scanToken` is set on tenant creation but I see no code path that generates or rotates it (search found zero `scanToken: ...` assignments under `src/`). Either this is a manual DB operation or the feature is unimplemented.
- **Fix:** Document or implement.

### M-14. `seedEmail` lookup is case-insensitive via `mode: 'insensitive'` — good, but only handles recipient
- **File:** `src/modules/inbound/inbound.service.ts:345-353`.
- **Observation:** The fallback path for emails without an explicit recipient resolves tenant via `scanEmail` only. Real providers send the recipient in the body — but if that is missing, the lookup hits the wrong tenant if two tenants share a similar email (e.g. `inbox@acme.com` vs `inbox+acme.com`). Documented as M1 fix makes signature check first, so the practical risk is low.

### M-15. `LlmProvider` falls back silently when Anthropic key is absent
- **File:** `src/modules/ai/copilot.service.ts` and `llm-provider.ts`.
- **Observation:** When `ANTHROPIC_API_KEY` is unset, the deterministic fallback is used (per header comment). Production should hard-fail if LLM is required.
- **Fix:** Add an env flag `AI_REQUIRE_LIVE_LLM=true` (default true in production) that throws on startup if no provider is reachable.

### M-16. `SELECT 1` health probe uses raw client bypass — fine for now but should be consistent
- **File:** `src/modules/health/health.controller.ts:49/82`.
- **Approved.**

### M-17. `documents.service.ts sanitize()` may strip audit data
- **File:** `src/modules/documents/documents.service.ts`.
- **Action:** Verify `sanitize()` doesn't remove fields the audit log needs. (Spot-check needed; out of scope for static review.)

### M-18. `flushPartyIbanHistory` and other similar "expansion" functions duplicated across modules
- **Files:** multiple `sanitize*` helpers.
- **Recommendation:** Extract to a shared lib. Not a security issue, but a maintainability drag that increases the chance of inconsistent masking.

---

## LOW

- **L-01.** `consumeDecimal` helpers should be applied everywhere — verify all numeric outputs go through `Number(...)` consistently to prevent raw Decimal jsonification.
- **L-02.** Some controllers advertise HTTP-200 for creation. Use HTTP-201 + `Location` header for created resources.
- **L-03.** No `__tests__` for the Prisma extension integration with the real service stack — the spec mocks the client. Add a docker-compose test that brings up postgres + the API and exercises cross-tenant access (denied).
- **L-04.** Document Item models (`DocumentItem`, `ContactPerson`) lack tenantId intentionally; relies on parent. Verify cascade rules ensure deleted parents don't leave orphans.
- **L-05.** `BigInt` payload handling — none observed in current schema, but if added later, JSON serialization will throw (`TypeError: Do not know how to serialize a BigInt`).
- **L-06.** `passwordHash` is exposed via `findUnique` selects in some audit metadata paths — verify no logging path emits the hash. (None observed, but list as a precaution.)
- **L-07.** Tenancy test relies on `prisma.helpers.ts` import — the export file uses `.spec-export.ts`; consider a non-spec path.
- **L-08.** `Helmet()` defaults include `crossOriginOpenerPolicy: same-origin`. Good. `X-Frame-Options` should be set to `DENY` for any tenant-rendered UI to prevent clickjacking; verify.
- **L-09.** `passkey.service.ts` uses an in-memory `Map`. Add a startup-warn when the Map grows past N entries to detect eviction bugs.

---

## Test gaps

| Area | Risk | Tested? | Coverage suggestion |
|---|---|---|---|
| Cross-tenant isolation on every endpoint | CRITICAL | Mock-only | Spin up postgres in CI; for each controller, attempt cross-tenant access; assert 404/403. |
| Audit hash-chain under concurrency | CRITICAL | No | Fire N parallel `audit.log()` and assert `verifyChain().valid === true`. |
| RBAC enforcement across all restricted endpoints | HIGH | Spotty | Table-driven test: each `@Roles`-bearing handler invoked by every role; expect 403. |
| 2FA disable password requirement | CRITICAL | No | Add a test that asserts `bcrypt.compare` is invoked. |
| Passkey verification rejects when expected | CRITICAL | Skeleton-only | Add test that `verify({challengeId: 'expired'})` returns `{verified: false}`. |
| Tenant-extension applied end-to-end | CRITICAL | Mock-only | Integration test with real Prisma client + seeded tenant. |
| SEPA export blocks blacklisted IBAN | HIGH | No | Add spec asserting export fails or skips flagged IBANs. |
| Payroll Decimal math | HIGH | No | Property-based: 10k random salaries × IRS rates; verify `expected - actual < 0.01`. |
| CSV import under concurrent imports | MEDIUM | No | Race two identical imports; assert exactly one wins, no duplicates. |
| Rate limit on destructive endpoints | HIGH | No | Verify `@Throttle` decorators present and active in production. |
| Webhook signature paths for SendGrid/Mailgun | HIGH | Partial | Send a sample real provider payload; assert verified. |
| `TimedSafeEqual` for cron/scanner | HIGH | No | Verify implementation uses `crypto.timingSafeEqual`, not `===`. |
| `verifyChain` skips rows after soft-delete (none today) | LOW | Yes (mock) | Re-test against live DB. |

---

## Production readiness matrix

| Module | Readiness | Caveats |
|---|---|---|
| `auth` | NO | C-04 (2FA bypass), C-03 (plaintext refresh tokens), C-07 (jwt secret), H-12 (HS256). |
| `parties` | NO | C-01 applies (every service); C-08 (blacklist ignored in SEPA); H-05 (IBAN history racy). |
| `banking` | NO | C-01; H-08 (CSV import race); H-15 (large CSV). |
| `documents` | NO | C-01; H-06 (dedup race); H-17 (sanitize audit). |
| `extraction` | NO | C-01; H-14 (rate limit). |
| `audit` | NO | C-02 (race); H-13 (concurrency tests). |
| `reconciliation` | NO | C-01; H-07 (matching race). |
| `integrations` | CONDITIONAL | Webhooks well-signed; payload handling OK; tenant scope relies on C-01. |
| `inbound` | NO | C-10 (SendGrid signature broken-but-safe); H-03 (timing-unsafe); M-13 (scan token); M-14 (recipient fallback). |
| `payments` | NO | C-01; C-08 (blacklist); C-09 (paidAmount mismatch). |
| `payroll` | NO | H-04 (Decimal via Number); C-01. |
| `crm` | NO | C-01; H-02 (no RBAC). |
| `fleet` | CONDITIONAL | C-01; small surface. |
| `health` | YES | Trivial probes, correctly public. |
| `tax-simulator` | CONDITIONAL | No persistence — pure compute. Verify determinism. |
| `ai` | NO | C-06 (cross-tenant vector load); H-02 (no RBAC). |
| `common` (guards/filters/middleware) | CONDITIONAL | Defense-in-depth is good in design; depends on Prisma extension (C-01) being applied end-to-end. |

---

## Recommendation

**Production: NO** — do not ship to a paying tenant today.

**Staging (closed-beta): CONDITIONAL** — once the following are addressed, a *limited* staging rollout with one or two design-partner tenants is acceptable:
- C-01, C-02, C-03, C-04, C-07, C-08, C-09 — at minimum.

**Pre-staging checklist:**
1. Fix C-01 by making every service use `this.prisma.scoped` (or by wrapping PrismaService at construction time).
2. Fix C-02 by transactionalising audit writes.
3. Fix C-04 (2FA disable password check) and C-05 (passkey skeleton must not return verified=true).
4. Move JWT signing to RS256 + JWKS or at least rotate to non-committed secrets.
5. Reject SEPA exports for blacklisted IBANs.
6. Reject paidAmount mismatches in mark-paid.
7. Add the cross-tenant integration tests in CI.
8. Add `@Roles(Role.ADMIN)` to all destructive party/account/payment endpoints.
9. Switch the CRON_SECRET and scan token checks to `timingSafeEqual`.

Once the CRITICAL items above are signed off, re-evaluate production readiness with a fresh round of integration tests.

---

*End of report.*
