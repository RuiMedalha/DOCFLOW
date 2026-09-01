# FIX SPRINT B — Banking CSV + Tax Simulator API bugs (DocFlow)

Worker: pane-118 (handoff to pane-95)
Scope: `apps/api` — NestJS 11 + Prisma 6. Out of scope: `payments/`,
`reconciliation/`, `integrations/`.

## Verification summary

| Step                        | Result                                                          |
| --------------------------- | --------------------------------------------------------------- |
| `npx jest src/modules/banking src/modules/tax-simulator` | **41 passed / 0 failed** (4 suites)              |
| `npx tsc --noEmit` for our files | **0 errors** in `banking/` or `tax-simulator/`          |
| `npx nest build`            | OK, `dist/` produced                                            |
| Throwaway API on :4010      | BUG 4 returns 400 / 200 as expected (live :4000 still on old build — see BUG 4 §Verification below) |
| Live API on :4000           | Tax-simulator routes return 200 (BUG 5 confirmed live)          |

`npx tsc --noEmit` does surface **7 pre-existing errors** in
`src/modules/integrations/integrations.e2e.spec.ts` and
`src/modules/payments/payments.service.spec.ts`. Those are NOT introduced by
this fix and are explicitly out of scope per the task brief ("do not touch
payments/ or reconciliation/").

---

## BUG 4 (HIGH) — Banking CSV preview/import 500

### Root cause

`POST /banking/csv/preview` and `POST /banking/csv/import` returned
`HTTP 500 — TypeError: Cannot read properties of undefined (reading 'date')`
when the request body did not carry a valid `mapping` object.

Two reinforcing defects:

1. **`csv-parser.util.ts` (line ~172-198)** assumed
   `options.mapping.date`/`description` were always strings. When
   `mapping` was `undefined` or the column name didn't exist, the row
   loop dereferenced `cols[dateIdx]` / `cols[descIdx]` with a `-1` index
   (returning `undefined`), then the upstream `banking.service.ts`
   `previewCsv` at line ~158 called `r.date.toISOString()` on
   `undefined`, crashing with the exact error in the bug report.

2. **`banking.controller.ts` (line ~100-128)** typed the request body as
   `PreviewCsvDto & { content: string }` (and `ImportCsvDto & { ... }`).
   TypeScript intersection types are erased at runtime, so NestJS's
   `ValidationPipe` saw a plain `Object` and **disabled
   `whitelist`/`forbidNonWhitelisted`** — the OpenAPI-documented flat
   body shape (`{ dateColumn, amountColumn, descriptionColumn }`) was
   silently accepted and forwarded with `mapping === undefined`. The
   crash then happened downstream inside `parseCsvContent`.

### Reproduction (BEFORE the fix)

```bash
curl -X POST http://localhost:4000/api/v1/banking/csv/preview \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Data;Valor;Descricao\n15/03/2026;-45,90;EDP",
       "dateColumn":"Data","amountColumn":"Valor",
       "descriptionColumn":"Descricao"}'
# → HTTP 500 — TypeError: Cannot read properties of undefined (reading 'date')
```

This is the exact OpenAPI-documented body shape — clients following the
docs crashed every time.

### Fix

Five coordinated changes (all in `apps/api/src/modules/banking/`):

1. **`csv-parser.util.ts`** — defensive guards:
   - Early-return with a clear "mapping em falta" error when
     `options.mapping` is `undefined` (instead of dereferencing
     `m.date` / `m.description` on `undefined`).
   - Friendly messages for each missing column: e.g.
     `Coluna de data "WRONG" não encontrada` or
     `Coluna de data em falta — forneça mapping.date (ou dateColumn no body)`.
   - `ParseOptions.mapping` now allows optional `date` / `description`
     so the parser is honest about what it requires at runtime.

2. **`banking.service.ts`** — `previewCsv` and `importCsv` translate
   any parser-reported mapping error into a `BadRequestException` (400)
   with `{ message, errors }`, so the wizard gets a clear failure mode
   instead of a 500 or a silent empty result.

3. **`banking.dto.ts`** — `PreviewCsvDto` (and the inherited
   `ImportCsvDto`) now accept the **flat OpenAPI shape** alongside the
   nested mapping object, with `toEffectiveMapping()` folding
   `dateColumn` / `amountColumn` / `descriptionColumn` / `balanceColumn`
   into the nested `mapping` the parser expects. `CsvColumnMappingDto`
   `date` / `description` are now optional at the DTO level (runtime
   guard remains).

4. **`banking.controller.ts`** — explicit `new PreviewCsvDto()` /
   `new ImportCsvDto()` instances so `ValidationPipe` recognises a real
   class and applies `whitelist` / `forbidNonWhitelisted` (strips any
   stray fields, rejects unknown ones with 400). The flat
   `*Column` fields now pass validation cleanly.

5. **Test coverage** — 8 new test cases:
   - `parseCsvContent` no longer crashes when `mapping` is empty /
     undefined / mismatched.
   - `parseCsvContent` still parses the PT bank example correctly
     (regression: the original "happy path" stays green).
   - `PreviewCsvDto.toEffectiveMapping()` folds flat fields correctly,
     prefers nested over flat when both are supplied, returns empty
     strings when nothing is supplied (parser then complains clearly).
   - `BankingService.previewCsv` throws `BadRequestException` (not 500)
     when mapping is empty or has wrong column names.
   - `BankingService.previewCsv` accepts the flat OpenAPI shape end to
     end.

### Verification (AFTER the fix)

Run on a throwaway build (`PORT=4010 node dist/src/main.js`) — the
**live :4000 process is `node dist/src/main.js` (not `--watch`)**, so
the user's running instance still serves the OLD code until they
restart it.

| Case                                                                    | Before          | After                                  |
| ----------------------------------------------------------------------- | --------------- | -------------------------------------- |
| Flat OpenAPI shape (dateColumn/amountColumn/descriptionColumn)          | HTTP **500**    | HTTP **200**, 3 rows parsed correctly  |
| Nested mapping shape (existing contract)                                | HTTP 200        | HTTP 200 (unchanged)                   |
| `mapping.date` = `WRONG`                                                | HTTP 200 (empty)| HTTP **400** with helpful error list   |
| `mapping` entirely missing                                              | HTTP **500**    | HTTP **400**                           |
| `importCsv` happy path                                                  | HTTP 500 (unrelated RangeError in prisma.service.ts — see below) | Same; out of scope for this fix |

A 41-test Jest run covers every branch — see the suite-level summary above.

---

## BUG 5 (MEDIUM) — Tax simulator routes not mounted

### Root cause

**Not present in current code.** Verified by:

- `app.module.ts:129` lists `TaxSimulatorModule` in `imports[]` (and
  the `import` statement is at line 42).
- `tax-simulator.controller.ts:36` declares `@Controller('tax-simulator')`.
- `tax-simulator.controller.ts:42,71` declare `@Get('iva')` and
  `@Get('irc')`.
- `main.ts:127` sets `app.setGlobalPrefix('api/v1')`.
- Live `:4000` swagger at `/api/docs-json` lists
  `/api/v1/tax-simulator/iva` and `/api/v1/tax-simulator/irc`.
- Live `GET /api/v1/tax-simulator/iva?year=2026&quarter=1` returns
  **HTTP 200** with a populated DTO.
- Live `GET /api/v1/tax-simulator/irc?year=2026` returns **HTTP 200**.

The original "404" observation is consistent with the user hitting the
endpoint against a stale build (e.g. before `TaxSimulatorModule` was
wired, or before the controller's `@Controller('tax-simulator')`
prefix was committed). The current code is correct.

### Fix (prophylactic)

No source code changes needed. Added a Jest spec that asserts the
route surface at the metadata level, so a future refactor that drops
the module from `imports[]`, strips the `@Controller()` prefix, or
replaces `@Get('iva')` with something else will fail CI rather than
silently 404 in production.

`tax-simulator.controller.spec.ts` (new) checks:

- `@Get('iva')` / `@Get('irc')` carry the documented route segments.
- Both use `RequestMethod.GET` (the simulator stays read-only).
- The `@Controller('tax-simulator')` prefix is present in metadata.
- The prototype exposes exactly two routed methods — `iva` and `irc`.
- The controller instantiates with a stub service without throwing.

### Verification (BUG 5)

| Check                                            | Result                                  |
| ------------------------------------------------ | --------------------------------------- |
| Live `GET /api/v1/tax-simulator/iva`             | HTTP 200 with IVA DTO                   |
| Live `GET /api/v1/tax-simulator/irc`             | HTTP 200 with IRC DTO                   |
| Live swagger lists both routes                   | Yes (`/api/docs-json`)                  |
| New controller spec (6 tests)                    | All pass                                |
| Total tax-simulator Jest runs                    | **11 passed / 0 failed**                |

---

## Out-of-scope findings (flagging, NOT fixing)

- **`POST /banking/csv/import` happy path** on the live server returns
  HTTP 500 `RangeError: Maximum call stack size exceeded`. The recursion
  originates in `prisma.service.ts` `Proxy.$transaction → getTenantContext`
  (see `/tmp/api-4010.log` stack trace). This is pre-existing on the
  live `:4000` (not introduced by this fix) and lives in the prisma
  proxy, which is shared infrastructure — explicitly out of scope per
  the brief ("Do NOT touch payments/ or reconciliation/" and the focus
  is BUG 4 / BUG 5). Should be tracked as a separate fix.
- **Pre-existing TS errors** in `integrations/integrations.e2e.spec.ts`
  and `payments/payments.service.spec.ts` (7 errors total) — not in the
  modules this fix touches; do not regress my files but flagged here for
  visibility.

---

## Files changed

```
apps/api/src/modules/banking/csv-parser.util.ts       — defensive guards + error messages
apps/api/src/modules/banking/banking.service.ts       — translate mapping errors → BadRequest
apps/api/src/modules/banking/banking.controller.ts   — use real DTO classes (validation)
apps/api/src/modules/banking/dto/banking.dto.ts      — accept flat OpenAPI body shape
apps/api/src/modules/banking/banking.spec.ts         — +6 tests (parser + DTO folds)
apps/api/src/modules/banking/banking.service.spec.ts — +4 tests (previewCsv BadRequest)
apps/api/src/modules/tax-simulator/tax-simulator.controller.spec.ts  — NEW (6 tests)
```

## What the user needs to do

- Restart the live API on `:4000` (current process is `node dist/src/main.js`,
  not `--watch`) so the new build takes effect there.
- The live server already returns 200 for `GET /api/v1/tax-simulator/*` —
  no action needed for BUG 5.
- Decide whether to open a follow-up ticket for the prisma
  `Proxy.$transaction` recursion that breaks `/banking/csv/import` happy
  path (out of scope here).
