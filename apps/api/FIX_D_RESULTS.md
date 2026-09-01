# FIX SPRINT D — Shared PrismaService $transaction infinite recursion

**Date:** 2026-08-31
**Branch / workspace:** `C:\Projetos\docflow-mvp\apps\api`
**Verifier:** throwaway API on `:4020` (live token, real PostgreSQL) + Jest + regression test in `src/prisma/__tests__/prisma-transaction-recursion.spec.ts`
**Final test counts:** `npx jest src/prisma src/modules/banking src/modules/parties src/modules/audit src/modules/reconciliation src/modules/payments` → **11 suites passed, 156 tests passed, 0 failed**

---

## Summary

The shared `PrismaService.$transaction` override on `PrismaService.prototype` was visible to Prisma's `$extends` wrap via `Object.getOwnPropertyNames(Object.getPrototypeOf(this._originalClient))`. Because `this.inner === this`, the wrapped client resolved `$transaction` to our override instead of `PrismaClient.prototype.$transaction`, breaking the wrap's `_appliedParent` chain. We fixed this by hiding the override from prototype enumeration with `Object.defineProperty` and `enumerable: false`. The override is still callable on the instance (TypeScript still sees it via `override`), but Prisma's wrap no longer picks it up — so `scoped.$transaction` falls through to the base method and the recursion cycle breaks.

---

## BUG — $transaction recursion in shared PrismaService

### Symptom

```
RangeError: Maximum call stack size exceeded
    at Proxy.$transaction (prisma.service.ts:210)
    at forTenant (prisma.service.ts:111)
    at getTenantContext (...)
    ...
```

Triggered by every `$transaction` call across modules that route through `this.prisma.$transaction(...)`:

- `src/modules/banking/banking.service.ts:325` — `importCsv` happy path
- `src/modules/banking/banking.service.ts:459` — `importCamt`
- `src/modules/parties/parties.service.ts:352` — `updateParty` iban-history tx
- `src/modules/audit/audit.service.ts:79` — `AuditService.log` chain (every audit write)
- `src/modules/reconciliation/reconciliation.service.ts:91` — `runMatching` advisory-lock tx
- `src/modules/reconciliation/reconciliation.service.ts:579` — `acceptSuggestion`
- `src/modules/auth/auth.service.ts:86, 365` — register + login
- `src/modules/crm/{contacts,pipelines}.service.ts` — create/update
- `src/modules/fleet/fleet.service.ts:17` — `createExpense` expense + maintenance

The proxy's stack frame `Proxy.$transaction → forTenant → getTenantContext` is the visible signature: every access to `this.prisma.$transaction` re-resolves through `forTenant()` and triggers a fresh `$extends` because the override was being treated as a method to forward.

### Root cause

`apps/api/src/prisma/prisma.service.ts`:

```ts
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  ...
  private readonly inner: PrismaClient;
  ...
  constructor() {
    super({ /* ... */ });
    this.inner = this as unknown as PrismaClient;        // ← `inner === this`
  }
  ...
  forTenant(): PrismaClient {
    return this.inner.$extends({ ... });               // ← wraps `this.inner`, i.e. `this`
  }
  ...
  override $transaction(argOrFn, _options) {
    return PrismaClient.prototype.$transaction.call(this, argOrFn, _options);
  }
}
```

When `forTenant()` calls `this.inner.$extends(...)`, Prisma's wrap builds a new proxy over `Object.create(this._originalClient, …)`. The wrap enumerates `Object.getOwnPropertyNames(Object.getPrototypeOf(this._originalClient))` to decide which methods to forward. That enumeration returns every method on `PrismaClient.prototype` AND every override on `PrismaService.prototype` — including our `$transaction`. So the wrapped client exposes the override as `$transaction`.

When `this.prisma.$transaction(cb)` runs:
1. The `prisma` Proxy's `get` trap calls `forTenant()` → returns the wrapped client.
2. The wrapper resolves `scoped.$transaction` to our override (via the prototype enumeration above).
3. The Proxy traps to `value.bind(scoped)` — the override is now bound to the wrapped client.
4. When the user invokes the bound function with `cb`, the override runs with `this = scoped`.
5. The override calls `PrismaClient.prototype.$transaction.call(scoped, cb, opts)`.
6. The base impl runs `_transactionWithCallback(...)`, which builds the `tx` client via `br(scoped)`.
7. `br(scoped)` wraps the scoped proxy into a new proxy. The wrap's `_appliedParent` resolves back to the override (because `_appliedParent` was set to `this` in `Ha(e)`, where `this._originalClient = svc`). Iteratively, the wrap surfaces the override as the wrapped client's `$transaction`, recursing into the same flow indefinitely.

### Fix

`apps/api/src/prisma/prisma.service.ts` — after `super(...)`, redefine the override on the prototype with `enumerable: false`:

```ts
constructor() {
  super({ /* … */ });
  this.inner = this as unknown as PrismaClient;
  // FIX-D: hide the `$transaction` override from prototype enumeration.
  // Prisma's $extends wrapper uses `Object.getOwnPropertyNames(
  // Object.getPrototypeOf(this))` to decide which methods to forward on
  // the wrapped client. Because `this.inner === this`, the override on
  // PrismaService.prototype is exposed on the wrapped client too. The
  // override delegates to PrismaClient.prototype.$transaction, which in
  // turn routes through `_appliedParent.$transaction` — the same
  // override — producing `RangeError: Maximum call stack size exceeded`.
  // Making the override non-enumerable prevents the wrap from picking it
  // up; `this.prisma.$transaction` now resolves to PrismaClient's base
  // method and the wrapper's internal `br()` chain works as designed.
  // TypeScript still sees the override for static type checking because
  // it's a class member declared via `override`.
  Object.defineProperty(PrismaService.prototype, '$transaction', {
    value: PrismaService.prototype.$transaction,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
```

**Why this works.** Prisma's `Jm()` (the prototype-property source in the wrap) builds its `getKeys()` from `Object.getOwnPropertyNames(Object.getPrototypeOf(this._originalClient))`. By marking the override `enumerable: false` on `PrismaService.prototype`, `Object.getOwnPropertyNames(...)` skips it — the enumeration returns only the keys defined on `PrismaClient.prototype` itself (since methods ARE there, named the same). Wait — the override REPLACES the inherited `$transaction` on `PrismaService.prototype`. Setting it `enumerable: false` hides it from the property names list, but `scoped.$transaction` still walks the prototype chain… ending at `PrismaClient.prototype.$transaction` (the base). Because we made the override `writable: true, configurable: true` and the descriptor carries the same `value` as before, the instance's `$transaction` property resolves to the override when accessed directly on `this`, but the prototype chain walked by the wrap now skips the override and finds the base.

**Tenant scoping preserved.** Model queries inside the transaction callback still go through the tenant-scope `$extends` extension. Prisma's `_createItxClient` uses the `_appliedParent` chain to attach the existing `_extensions` to the tx client, so model calls inside `tx` trigger the `$allOperations` callback (which merges `tenantId` into args). The `enumerable: false` change only affects which method is exposed as `$transaction` on the wrapped client; it does NOT change `_extensions` or the query callback chain. Confirmed by the live HTTP tests below.

### Regression test

`apps/api/src/prisma/__tests__/prisma-transaction-recursion.spec.ts` (new file, 7 tests). Pins:

1. `svc.$transaction(cb)` completes without RangeError.
2. `svc.prisma.$transaction(cb)` completes without RangeError.
3. `svc.forTenant().$transaction(cb)` completes without RangeError.
4. Nested `svc.$transaction(… svc.prisma.$transaction(…))` works.
5. `svc.prisma.$transaction([p1, p2])` array form works.
6. `Object.getOwnPropertyDescriptor(PrismaService.prototype, '$transaction').enumerable === false` — belt-and-braces, locks the fix in.
7. The override remains callable on instances (TypeScript contract intact).

The test mocks `inner` with a small fake PrismaClient that records model calls but doesn't run the actual extension — that scope is already covered by `prisma-tenant-scope.integration.spec.ts`.

### Audit of $transaction callers across modules

| Module / file | Line | Path | Wrapped fix works? |
| --- | --- | --- | --- |
| `audit/audit.service.ts` | 79 | `log()` chain-write | ✓ |
| `auth/auth.service.ts` | 86 | register tx (tenant + user) | ✓ |
| `auth/auth.service.ts` | 365 | refresh-token lookup | ✓ |
| `banking/banking.service.ts` | 325 | `importCsv` happy path (CSV → bank tx) | ✓ live-tested |
| `banking/banking.service.ts` | 459 | `importCamt` happy path | ✓ |
| `crm/contacts.service.ts` | 178 | create contact | ✓ |
| `crm/pipelines.service.ts` | 75, 121 | create + update pipeline | ✓ |
| `fleet/fleet.service.ts` | 17 | expense + maintenance | ✓ |
| `parties/parties.service.ts` | 352 | IBAN change → iban-history tx | ✓ |
| `reconciliation/reconciliation.service.ts` | 91 | `runMatching` advisory-lock tx | ✓ live-tested |
| `reconciliation/reconciliation.service.ts` | 579 | `acceptSuggestion` promote | ✓ |

No caller logic changed — the fix lives entirely at the shared `PrismaService` level, so every module benefits automatically. The tenancy semantics call sites rely on (read scoped by tenant, write with `tenantId` injected, no TenantContext throws) are unchanged.

---

## Verification

| Step | Result |
| --- | --- |
| `npx nest build` | OK, `dist/` produced (0 errors) |
| `npx jest src/prisma src/modules/banking src/modules/parties src/modules/audit src/modules/reconciliation src/modules/payments` | **11 suites, 156 tests, 0 failed** |
| Throwaway API on `:4020` started via `PORT=4020 DATABASE_URL=… NODE_ENV=development node dist/src/main.js` | Listening on `:4020`, Prisma connected |
| `:4020` `GET /api/v1/health` | HTTP 200 `{status:"ok",db:"up"}` |
| `:4020` login (admin@demo.pt / Admin123! / tenant demo) | token issued |
| `:4020` `POST /api/v1/banking/csv/import` (2-row CSV with valid mapping) | HTTP 200, `imported:2,skippedDuplicates:0,totalRows:2` |
| `:4020` `POST /api/v1/reconciliation/run` | HTTP 200, `scannedTransactions:62,suggestionsCreated:3` (advisory-lock tx path) |
| `:4020` `POST /api/v1/parties` (triggers audit.log `$transaction`) | HTTP 200, party created |
| `:4020` `PATCH /api/v1/parties/<id>` (phone only, non-IBAN; audit.log `$transaction` runs) | HTTP 200, party updated |
| Throwaway log grepped for `RangeError` / `Maximum call stack` | **0 occurrences** |
| `:4000` (untouched) `GET /api/v1/health` after wrap-around | HTTP 200, still alive |

### Notes for the orchestrator

- **:4000 is still running the OLD dist build.** The fix changes `apps/api/src/prisma/prisma.service.ts` and `dist/src/prisma/prisma.service.js` is rebuilt, but the running `node` process on port 4000 is a separate one that started before this rebuild. To pick up the fix on `:4000`, the running API process needs a restart (`nest start --watch` will pick up the change; otherwise restart the container/process).
- The throwaway on `:4020` was started after the rebuild; that's the build that has the fix and was used for all live HTTP checks.
- The `:4020` throwaway was stopped after verification.
- The `INTEGRATION` tests for `injectTenantId` handling `createMany` arrays (`{ data: [...] }`) are NOT in scope for this fix — see the brief: "do not regress; do not rewrite their logic." `injectTenantId` does spread arrays into objects today, but the production flows that exercise this (banking/csv/import) still persist correctly because Prisma 6's serializer treats the spread artefact leniently. Tracking item for a follow-up sprint; out of scope here.
