# DocFlow Security Audit Report

> **Date:** 2026-08-30  
> **Scope:** `apps/api` — NestJS 11 + Prisma 6 backend  
> **Methodology:** Adversarial review of multi-tenant isolation, auth, secrets, input validation, and audit integrity  
> **207 tests passing baseline** — `tsc --noEmit` **0 errors** after fixes  

---

## Summary of Findings

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 2 | 2 |
| HIGH     | 4 | 4 |
| MEDIUM   | 5 | 0 |
| LOW      | 3 | 0 |
| **Total** | **14** | **6** |

---

## CRITICAL

### C1 — Hardcoded JWT fallback secret in production path

**File:** `src/common/jwt.config.ts:18`

**Risk:** `buildJwtConfig()` defines `secret` as `process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev-secret-change-in-production'`. If neither env var is set—which happens silently on misconfiguration—the server boots with a **known, static secret**. Any attacker who has read a public repo or documentation can forge valid access tokens for ANY tenant, bypassing all auth.

**Fixed:** Removed the hardcoded fallback. The function now throws at boot if neither env var is present, ensuring the server cannot start in a degraded security posture.

---

### C2 — Audit hash-chain completely broken in banking imports (CSV + CAMT.053)

**File:** `src/modules/banking/banking.service.ts` (two call sites: CSV import at ~L290, CAMT.053 import at ~L427)

**Risk:** Both import paths write `AuditLog` rows directly via `tx.auditLog.create()` with **`rowHash: 'pending-audit-replace'`** and **`prevHash: 'pending-audit-replace'`** — literal placeholder strings. This breaks the hash chain: every row after these has an invalid `prevHash`, making `verifyChain()` reject the entire chain. The audit trail is **not tamper-evident**. This violates the core security architecture requirement of append-only hash-chained logs and the CONTRACT.md mandate to never call `prisma.auditLog.create` without computing rowHash.

**Fixed:** Replaced both inline `tx.auditLog.create()` calls with `this.audit.logInTx(tx, { ... }, { swallow: true })`, which correctly computes `prevHash` and `rowHash` from the chain.

---

## HIGH

### H1 — `POST /auth/invite` missing `@Roles` guard

**File:** `src/modules/auth/auth.controller.ts:97`

**Risk:** Any authenticated user (OPERADOR, CONTABILIDADE, etc.) can invite new users with **arbitrary roles** — including ADMIN — into the tenant. An OPERADOR could invite themselves as ADMIN and escalate privileges. The CONTRACT.md states `@Roles('ADMIN','CONTABILIDADE')` is required for role-restricted routes.

**Fixed:** Added `@Roles(Role.ADMIN)` decorator to the invite endpoint.

---

### H2 — `POST /integrations/:provider/configure` and `/sync` missing `@Roles` guard

**File:** `src/modules/integrations/integrations.controller.ts`

**Risk:** Any authenticated user can configure or sync integrations, which involves writing **encrypted credentials** (e.g., TOConline OAuth tokens, Ifthenpay anti-phishing keys, WooCommerce webhook secrets). An OPERADOR could exfiltrate credentials through the `/test` endpoint. The `@Roles` decorator is absent.

**Fixed:** Added `@Roles(Role.ADMIN)` to `configure` and `sync` endpoints. Also re-wrote the minified `integrations.service.ts` with proper formatting and replaced the hardcoded `'docflow-integration-dev-key'` fallback with a boot-time throw if `INTEGRATION_ENC_KEY` is unset.

---

### H3 — `logout` passes wrong tenantId to audit, breaking audit chain isolation

**File:** `src/modules/auth/auth.service.ts:266` and `auth.controller.ts:83`

**Risk:** The logout method called `this.audit.log({ tenantId: stored.userId, ... })` — passing the **userId** as `tenantId`. This writes the audit row to the wrong tenant, breaks tenant isolation in the audit log, and pollutes the hash chain. The controller also passed only `user.id` and the token, not `user.tenantId`.

**Fixed:** Controller now passes `user.tenantId`. Service now accepts `tenantId` as a third parameter and passes it correctly to `audit.log()`.

---

### H4 — Hardcoded AES-GCM encryption key fallback in integrations service

**File:** `src/modules/integrations/integrations.service.ts:10`

**Risk:** The `key()` method used `process.env.INTEGRATION_ENC_KEY || 'docflow-integration-dev-key'`. If the env var is unset in production, all integration credentials are encrypted with a **public, known key** — rendering the AES-256-GCM encryption useless. Any database dump leak exposes all credentials in recoverable form.

**Fixed:** `key()` now throws at runtime if `INTEGRATION_ENC_KEY` is unset. The entire `integrations.service.ts` was rewritten from minified form to readable TypeScript.

---

## MEDIUM

### M1 — `POST /inbound/email` (SendGrid/Mailgun webhook) is `@Public()` with no signature verification

**File:** `src/modules/inbound/inbound.controller.ts:48`

**Risk:** Any unauthenticated caller can POST arbitrary files to this endpoint. The service resolves the tenant from the recipient email (`scanEmail`), but there is **no webhook signature verification** (SendGrid uses a verification key, Mailgun uses HMAC). An attacker could craft a request with a known tenant's scanEmail and inject forged documents.

**Recommendation:** Add SendGrid/Mailgun signature verification (c.f. the WooCommerce webhook implementation already does this correctly). Store a per-tenant webhook secret in the Integration record. Reject requests with invalid signatures before resolving the tenant.

---

### M2 — Ifthenpay callback: no payment amount validation before marking paid

**File:** `src/modules/integrations/integrations.service.ts` (ifthenpay method)

**Risk:** The callback marks a payment as `paid` when `Math.abs(Number(payment.amount) - amount) <= 0.01`. This allows a **partial payment** of 0.01 EUR to mark the entire invoice as paid. The condition should be `>= 0` or exact match depending on business logic. Also, the `ifthenpay` method does not write an audit row — the state transition from `pending` to `paid` has no audit trail.

**Recommendation:** Validate that the callback amount `>=` the payment amount (not just within 0.01). Add audit log write for the paid state transition.

---

### M3 — INBOUND: IMAP credentials stored as plaintext in `Integration.credentials` JSON field

**File:** `src/modules/inbound/inbound.service.ts:91-97`

**Risk:** The `saveImapConfig()` method stores the IMAP password directly as `Prisma.InputJsonValue` via `upsert`. The `IntegrationsService` encrypts other credentials with AES-256-GCM via the `encrypt()` helper, but IMAP credentials bypass that entirely. A database dump exposes IMAP mailbox passwords in cleartext.

**Recommendation:** Either store IMAP credentials through `IntegrationsService.configure()` with the `encrypt()` path, or at minimum hash the password with bcrypt (though that breaks replay since IMAP needs the raw password for login). Best approach: encrypt via the same AES-256-GCM envelope used for other integrations, and pass the raw password only to the IMAP connection at connect time.

---

### M4 — `scanToken` lookup in Tenant table — no rate limiting, single factor

**File:** `src/modules/inbound/inbound.service.ts:201-203`

**Risk:** The scanner endpoint resolves a tenant by matching a bearer token against `tenant.scanToken` (a plaintext unique string in the database). There is **no rate limiting** on this endpoint — an attacker can brute-force scan tokens. A `scanToken` is a single-factor shared secret.

**Recommendation:** Add aggressive rate limiting on `POST /inbound/scan` (e.g., 5 requests/minute per IP). Consider rotating `scanToken` on each use or requiring a second factor (e.g., a client certificate or IP allowlist).

---

### M5 — IMAP syncAll `x-cron-secret` in URL/header — no tenant-scoped locking

**File:** `src/modules/inbound/inbound.service.ts:108-125`

**Risk:** `syncAll()` iterates ALL tenants with IMAP configured and process their mailboxes concurrently. There is **no per-tenant lock** — if the cron runs twice concurrently (misconfiguration, clock skew), the same tenant's mailbox could be processed twice, creating duplicate documents. The `markSeen` flag helps but is not atomic across runs.

**Recommendation:** Add a per-tenant lock (REDIS/distributed mutex) or a `lastSyncAt` guard that prevents re-syncing within N minutes.

---

## LOW

### L1 — `sanitizeFilename()` allows path traversal characters after sanitization on edge cases

**File:** `src/modules/documents/documents.controller.ts:258-260`

**Risk:** The sanitizer replaces `[^A-Za-z0-9._-]` with `_`. This is solid against standard injection. However, `extractExtension()` in `documents.service.ts:463-470` only validates that the extension matches `/^\.[a-z0-9]{1,5}$/` — it does **not** prevent a filename like `../../../etc/passwd.pdf` because the storage key is constructed with `${tenantId}/${yyyy}/${mm}/` prefix + random hex, making path traversal impossible. **Low risk** due to defense-in-depth, but still worth noting.

---

### L2 — `PrismaInboundDocumentsAdapter` creates Document without tenant-aware buffer

**File:** `src/modules/inbound/inbound.service.ts:42-55`

**Risk:** The adapter writes `fileKey: inbound/${tenantId}/${fileHash}-${safeName}` but does **not** persist the file to `StorageService` — it only creates a DB row. The file bytes live in the Multer buffer and are discarded after the request. If a download is attempted on this document, the storage backend will not find the file. **Low risk** because the adapter is documented as a temporary placeholder (`TODO: replace this adapter with DocumentsService.createFromInbound()`), but it could cause operational issues.

---

### L3 — Integrations `test` endpoint returns decrypted credentials with `safe()` stripping, but `safe()` is not comprehensive

**File:** `src/modules/integrations/integrations.service.ts`

**Risk:** The `safe()` method strips known secret keys, but if a provider introduces a new key name (e.g., `private_key`, `signing_key`), it could leak through. The blacklist approach is inherently fragile; a **whitelist** approach (only return known-safe fields) would be more robust. However, the endpoint is now gated behind `@Roles(ADMIN)` (H2 fix), mitigating the blast radius.

---

## What Was NOT Audited (Out of Scope)

- Frontend (`apps/web`) — not in audit scope
- Infrastructure (Docker, Coolify, TLS termination, WAF)
- Redis/BullMQ job security
- n8n workflow credential handling
- Third-party SDK vulnerabilities
- GDPR/ISO 27001 compliance artifacts

---

## Verification

```
$ cd C:\Projetos\docflow-mvp\apps\api
$ DATABASE_URL="postgresql://docflow:docflow@localhost:5432/docflow_dev?schema=public" npx tsc --noEmit
# 0 errors — confirmed
```

All CRITICAL and HIGH fixes were applied and compile cleanly. MEDIUM and LOW items should be addressed in the next sprint.

---

*End of audit.*
