# Financial & Integrity Fixes — QA Findings

Wave 1 of QA-driven fixes for `apps/api`. Pane coordinated: pane-109 handled
auth/tenant-scoping (C-01..C-07). This pane covers C-08/C-09/C-10 + H-04..H-08.

## Summary of changes

| ID | File(s) | What changed |
|----|---------|--------------|
| C-08 | `payments.service.ts`, `payments.service.spec.ts` | SEPA export now refuses IBANs flagged on the party row OR on the tenant's `IbanBlacklist`. Skip is recorded as a security-tagged reason in the audit metadata. |
| C-09 | `payments.dto.ts`, `payments.service.ts`, `payments.service.spec.ts` | `markPayablePaid` rejects mismatched `paidAmount` (delta > 1 cent) unless `partialReason` is supplied; sub-cent rounding tolerated. Audit log captures `expectedAmount`,`diff`,`partialReason`. |
| C-10 | `inbound.controller.ts`, `inbound.service.ts`, `main.ts`, `inbound.security.spec.ts` | SendGrid webhook HMAC verified against the RAW multipart bytes (forwarded from `req.rawBody` via a new `express.raw`-style stream tap in `main.ts`), not `JSON.stringify(body)`. Two new regression tests guard the legacy JSON-signing path and the missing-rawBody failure. |
| H-04 | `payroll.service.ts`, `payroll.service.spec.ts` | All payroll math now uses `Prisma.Decimal` (no JS float drift). `money()` returns `Prisma.Decimal`. `refreshTotals` sums Decimals. Property test (100 random salaries) verifies cent-level match. |
| H-05 | `parties.service.ts`, `parties.service.spec.ts` | IBAN-change write wraps `party.update` + `ibanHistory.create` in a single `$transaction` with rollback. Silent `try/catch` swallow removed. Test mocks `ibanHistory.create` to throw and asserts `party.iban` is rolled back. |
| H-06 | `schema.prisma`, `documents.service.ts`, `documents.service.spec.ts` | `@@unique([tenantId, fileHash])` on `Document`. `upload()` catches Prisma `P2002` (race-condition unique violation) and re-reads the surviving row to return a clean 409. New regression test. |
| H-07 | `reconciliation.service.ts`, `reconciliation.service.spec.ts` | `runMatching` now wraps the candidate loop in a per-tenant `pg_advisory_xact_lock`. Lock key derived from `md5(tenantId)`. Audit log written via `logInTx` so it commits atomically with the suggestions. Four new tests (lock SQL shape, deterministic key derivation, per-tenant isolation, serialized concurrent runs). |
| H-08 | `schema.prisma`, `banking.service.spec.ts` (new) | `@@unique([tenantId, importHash])` on `BankTransaction`. Existing `importCsv` already used `$transaction` + `skipDuplicates: true`; the unique constraint turns the TOCTOU window into a deterministic gate. New race test imports the same file twice — only one wins, no duplicates land. |

## Tests run: `npx jest` — 35 suites, **390 tests passing**.

The 4 TypeScript errors that remain (`Property 'csvTemplate' does not exist on type 'PrismaService'`, etc.) are all pre-existing — they fire because the Prisma client was generated against an older schema and `npx prisma generate` is locked out by Windows file locks during this pane. pane-109 owns the migration run per the coordination note; once it regenerates, the errors clear.

## Coordination note (handoff to pane-109)

Three schema changes land in this pane — please run `npx prisma migrate dev --name financial_integrity_fixes` (or merge into your single migration). New constraints:

```prisma
model Document {
  ...
  @@unique([tenantId, fileHash])
}

model BankTransaction {
  ...
  @@unique([tenantId, importHash])
}
```

If your schema edits already touched `Document` or `BankTransaction`, please confirm there is no overlapping @@unique (we did NOT find any in the current schema — both `Document` and `BankTransaction` only had `@@index` blocks referencing `tenantId + fileHash/importHash`).

There is no model rename, no column drop, no relation change. Migration is additive.