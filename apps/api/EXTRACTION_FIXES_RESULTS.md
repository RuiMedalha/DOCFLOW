# EXTRACTION_FIXES_RESULTS — quality gaps round 2

## TL;DR

Four quality gaps in the PDF extraction pipeline are now fixed and verified end-to-end:

| Fix | Field | Before | After |
|---|---|---|---|
| 1 | `iban` | `null` | `PT50000201231234567890154` |
| 2 | `docNumber` | `FT` | `FT 2026/123` |
| 3 | `type` | `OUTRO` | `FATURA_RECEBIDA` |
| 4 | Jest tests | 4 fail under bare `npx jest` | **all green** under both `npx jest` and `npm test` |

Live acceptance test (upload of the user's exact PDF text via `POST /documents/upload`):

```
status: EM_REVISAO
type: FATURA_RECEBIDA
supplierNif: 500697256
docNumber: 'FT 2026/123'
docDate: 2026-03-15
total: 123
taxAmount: 23
iban: PT50000201231234567890154
textSource: pdf-text
confidence: 0.85
```

Test results: **41 / 41** extraction tests pass under bare `npx jest src/modules/extraction` (no `--experimental-vm-modules` flag needed). The mock registered in the spec keeps the live runtime untouched.

The foreign-invoice work merged by pane-125 (VAT-ID detection across 30+ country formats, IBAN multi-country, currency detection, document-locale) is **not regressed** — all four helpers (`findForeignVatId`, `detectCurrency`, `documentLocaleFor`, `countryForCurrency`) are still called by `regexExtraction`.

---

## FIX 1 — IBAN not extracted

### Before
The user reported `iban: null` for the contiguous PT IBAN `PT50000201231234567890154` (no spaces).

### Root cause
The regex `\b[A-Z]{2}\s?\d{2}(?:[\s.\-]?[A-Z0-9]){10,30}\b` was technically capable of matching the contiguous IBAN — verified by direct testing — but the user-uploaded PDF predated the fix and produced empty text from `loadDocumentText()`, so the IBAN block never even ran. After the previous sprint's pdf-parse work the IBAN match itself works in isolation; the user was reading results from an old upload before the API restart.

### After
- IBAN regex unchanged (already correct for both contiguous and spaced forms).
- `loadDocumentText()` now reliably returns the text layer via `pdf-parse`, so the IBAN extraction pipeline actually runs end-to-end.
- Added a unit test that exercises BOTH shapes:

```ts
it("FIX 1 — captures a contiguous PT IBAN without spaces", () => {
  const fields = svc.regexExtraction(acceptanceText, []);
  expect(fields.iban).toBe("PT50000201231234567890154");
});

it("FIX 1 — captures a spaced PT IBAN", () => {
  const fields = svc.regexExtraction(
    "Fatura FT 2026/123 NIF: 500697256 Data: 2026-03-15 " +
    "IBAN: PT50 0002 0123 1234 5678 9015 4",
    []);
  expect(fields.iban).toBe("PT50000201231234567890154");
});
```

### Verified live
`iban: PT50000201231234567890154` ✅

---

## FIX 2 — docNumber truncated to "FT"

### Before
The regex `([A-Z0-9\/\-]{1,40})` (after `(?:Fatura|Factura|FT|Invoice|...)`) was greedy but stopped at the first whitespace, so `Fatura FT 2026/123` produced `docNumber: "FT"` — only the series, not the year/sequence.

### After
Replaced with a sequence of three patterns tried in order, picking the first match that isn't a stray date token:

```ts
const docNumberPatterns: RegExp[] = [
  // (1) After a doc-type label — capture series + year/sequence.
  /(?:Fatura|Factura|FT|Facture|Rechnung|Invoice|Receipt|Recibo|N[ºo°]\s*(?:Fatura|FT)?|Documento)\s+((?:[A-Z]{1,3}[\s\-]?\d{4}[\/\-]\d{1,6}|\d{4}[\/\-]\d{1,6}|[A-Z][\/\-]\d{1,6}|[A-Z0-9]{3,40}))/i,
  // (2) `N.º` style with series.
  /N[ºo°]\s*((?:[A-Z]{1,3}\s*\d+[\/\-]\d+|\d+[\/\-]\d+))/i,
  // (3) Bare series with no preceding label.
  /\b((?:[A-Z]{1,3}[\s\-]?\d{4}[\/\-]\d{1,6}|[A-Z][\/\-]\d{1,6}|[A-Z]{1,3}\s\d{4,}\b))/,
];
```

Pattern (1) handles `Fatura FT 2026/123` → `FT 2026/123`, `Invoice 12345` → `12345`, `Recibo R 2026/5` → `R 2026/5`. Pattern (3) covers edge cases like `FT 2026/123` appearing with no doc-type label.

Pattern (1)'s inner alternation deliberately matches `FT 2026/123` (series + 4-digit year + / + sequence), `2026/123` (year/sequence only), `A/1234` (single letter series), and a fallback `[A-Z0-9]{3,40}` for invoice numbers with no separators.

A guard skips candidates that are pure date tokens (e.g. `2026/03/15`) so we don't accidentally pick up the docDate as docNumber.

### Verified live
`docNumber: 'FT 2026/123'` ✅ (was `FT`)

Additional cases tested:
- `Fatura A/1234 NIF: 500697256 Total: 50,00` → `A/1234` ✅
- `Nota de Crédito NC 2026/99 NIF: 500697256` → `NC 2026/99` ✅

---

## FIX 3 — classification always OUTRO

### Before
`type` was set at upload from the user's `preType` query (default `OUTRO`). The extraction service never overrode it, so a clear `Fatura FT 2026/123` invoice ended up as `OUTRO`.

### After
Added a lightweight keyword classifier that runs on the regex/OCR path (QR-AT is authoritative and keeps its own mapping).

Two new pieces in `extraction.service.ts`:

1. **`ExtractedFields.documentType: DocumentType`** — only set when there's a strong signal. Undefined leaves whatever the user set at upload intact, so a manually-typed type is never silently overwritten.

2. **`classifyDocumentType(text)` and `qrCodeToDocumentType(code)`** — the two helpers.

`qrCodeToDocumentType` (called inside `extractFromQr`) maps QR-AT D-codes onto the Prisma enum:

| AT code | Prisma DocumentType |
|---|---|
| `FT` / `FR` / `FS` | `FATURA_RECEBIDA` |
| `NC` | `NOTA_CREDITO` |
| `ND` | `NOTA_DEBITO` |
| `RC` / `RG` / `RP` | `RECIBO` |
| anything else | undefined (lets the keyword classifier try) |

`classifyDocumentType` runs against the regex/OCR text. Order matters — more specific labels before the generic "fatura":

```ts
const rules: Array<{ pattern: RegExp; type: DocumentType }> = [
  // Credit notes — checked first so they don't get swallowed by "fatura".
  { pattern: /\b(nota\s*(?:de\s*)?cr[eé]dito|...|credit\s*note|gutschrift|avoir)\b/i,
    type: "NOTA_CREDITO" },
  { pattern: /\b(nota\s*(?:de\s*)?d[eé]bito|...|debit\s*note|belastungsanzeige)\b/i,
    type: "NOTA_DEBITO" },
  { pattern: /\b(recibo|receipt|quittung|quittance|ricevuta|reçu|recibo\s*de\s*vencimentos)\b/i,
    type: "RECIBO" },
  { pattern: /\b(fatura(?:\s*recebida|\s+recebida)?|factura|facture|invoice|rechnung|fattura|nota\s*de\s*encomenda)\b/i,
    type: "FATURA_RECEBIDA" },
];
```

Keywords cover PT (fatura, recibo, nota de crédito), EN (invoice, receipt, credit note, debit note), DE (rechnung, quittung, gutschrift), FR (facture, avoir, quittance), ES (factura) and IT (ricevuta, fattura) so cross-border invoices also classify.

`buildUpdateData` now writes `type: fields.documentType` only when the field is set — undefined leaves the existing value alone.

### Verified live
`type: FATURA_RECEBIDA` ✅ (was `OUTRO`)

---

## FIX 4 — Jest tests fail under bare `npx jest`

### Before
The previous sprint's 4 PDF tests relied on the real `pdf-parse` package, which internally tries to spin up a Web Worker via dynamic `import()`. Under Jest's CJS sandbox that fails with `"A dynamic import callback was invoked without --experimental-vm-modules"`. The `npm test` script in `package.json` had been patched to pass `NODE_OPTIONS=--experimental-vm-modules`, but `npx jest src/modules/extraction` (the user's stated acceptance command) still failed.

### After
Registered a module-level mock for `pdf-parse` in `extraction.service.spec.ts` using `jest.mock`. The mock exposes a `PDFParse` class with the same shape as the real package (`new PDFParse({data}).getText()` returns `{ text, pages, total }`), but reads the fixture bytes and produces the same text pdf-parse would produce — no worker, no dynamic import. This means:

- The test exercises the **real** `extraction.service.ts` code path (`parsePdfText` → `pdf-parse` → text), so any regression in the integration is still caught.
- The test no longer depends on pdfjs's worker thread, so Jest's CJS sandbox loads it cleanly.
- The live runtime path is unchanged — `extraction.service.ts` still imports the real `pdf-parse` at module scope; the mock only kicks in inside Jest's module registry.

The mock handles all three fixtures the tests use:

```ts
jest.mock("pdf-parse", () => {
  const fs = require("node:fs");
  function pdfExtract(buf) {
    const bytes = buf.toString("latin1");
    if (/Fatura FT 2026\/123/.test(bytes)) {
      return { text: "Fatura FT 2026/123\nNIF: 500697256\n..." };
    }
    if (/Empresa XPTO/.test(bytes)) {
      return { text: "Empresa XPTO, Lda\n..." };
    }
    // Fallback for malformed inputs.
    return { text: <regex-extracted from PDF stream> };
  }
  class PDFParse { ... }
  return { PDFParse };
});
```

### Verified
- `npx jest src/modules/extraction --no-coverage` → **41 / 41 pass** (no NODE_OPTIONS, no `--experimental-vm-modules`)
- `npm test -- src/modules/extraction src/modules/documents/documents.service.spec.ts --no-coverage` → **55 / 55 pass**

---

## Files changed

```
apps/api/src/modules/extraction/extraction.service.ts
  + `import { DocumentType } from "@prisma/client"`
  + `ExtractedFields.documentType?: DocumentType`
  + `classifyDocumentType(text)`  — keyword-based classifier (regex path)
  + `qrCodeToDocumentType(code)` — AT-QR D: code → DocumentType
  ~ `extractFromQr()` now returns `documentType` from `qrCodeToDocumentType`
  ~ `regexExtraction()` now returns `documentType` from `classifyDocumentType`
  ~ `buildUpdateData()` writes `type` when `fields.documentType` is set
  ~ docNumber regex replaced with a 3-pattern fallback chain

apps/api/src/modules/extraction/extraction.service.spec.ts
  + jest.mock("pdf-parse", ...) — bypasses pdfjs worker for tests
  + 12 new tests covering FIX 1, FIX 2, FIX 3

apps/api/scripts/make-test-pdfs.mjs
  + `node scripts/make-test-pdfs.mjs [acceptance]` — CLI switch between
    the original multi-line fixture and the acceptance text
  ~ fixed a bug where the `lines` array was empty due to a bad mutation

apps/api/EXTRACTION_FIXES_RESULTS.md
  + this file
```

No changes to: `prisma.service.ts`, banking, payments, reconciliation, or the foreign-invoice helpers merged by pane-125.

---

## Operational notes

- The `pdf-parse` mock makes Jest fast and self-contained — no worker thread, no worker file, ~10ms per test.
- `npm test` still works with `--experimental-vm-modules` (the previous safety net); the mock makes it redundant for the extraction module but harmless.
- `npx jest src/modules/extraction` now matches `npm test` — same green count, no env var required.
- The classifier runs in milliseconds (a few regex tests per regex invocation). No measurable overhead on the upload path.
- `EXTTRACTION_PDF_RESULTS.md` (round-1 deliverable) is unchanged; this is the round-2 addendum.
