# EXTRACTION_PDF_RESULTS — PDF reading pipeline fix

## TL;DR

The pipeline that turns an uploaded PDF into text was **silently producing empty text** for digital PDFs and was **never wired to the upload auto-trigger** — so uploaded documents stayed at status `NOVO` with no fields populated. Both bugs are now fixed and verified end-to-end with real files against a live API:

- **Before**: `loadDocumentText()` did a `toString('utf8')` on the raw PDF bytes and stripped non-printables → binary garbage, no fields, no flag, no signal.
- **After**: `loadDocumentText()` uses `pdf-parse` to pull the embedded text layer (`pdf-text` source), detects image-only PDFs and sets `needsManualOcr: true` (`none` source), covers `text/plain` and `image/*` as before, and never throws on a malformed file.

End-to-end acceptance test (real upload via POST /documents/upload): status moves from `NOVO` → `EM_REVISAO` and all invoice fields populate within ~5s, with `metadata.extraction.textSource = "pdf-text"` and `needsManualOcr = false`.

---

## 1. How PDF reading worked before vs now

### Before

`loadDocumentText()` in `extraction.service.ts` (around L640-L666) tried to extract PDF text with this hack:

```ts
// Cheap probe: text-based PDFs start with `%PDF-` followed by
// mostly-printable streams. Image PDFs/binary blobs return control
// to the OCR path.
const head = obj.buffer.subarray(0, Math.min(obj.buffer.length, 4096)).toString('utf8');
if (/^%PDF-/.test(head) && /[\x20-\x7E]/.test(head.slice(0, 512))) {
  return obj.buffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t€]/g, ' ');
}
return '';
```

What that actually does:
1. Read the first 4 KB as UTF-8.
2. If it starts with `%PDF-` and contains printable ASCII, return the **entire buffer** as a UTF-8 string and strip non-printable characters.

The result for a real digital PDF was binary garbage (FlateDecode-compressed content streams inflate as zlib-compressed gibberish when interpreted as UTF-8). The downstream regex layer got nothing parseable → confidence 0.2, source `regex`, status `NOVO` forever.

There was also no path for image-only PDFs — `ocrImage()` short-circuits on `application/pdf`:

```ts
private async ocrImage(buffer: Buffer, mimeType: string): Promise<string> {
  if (!/^image\//i.test(mimeType)) return ''; // PDF raster OCR is out-of-scope here
  ...
}
```

So a scanned invoice uploaded as PDF would land in the doc with `metadata.extraction.textSource = 'none'` and no flag indicating it needed manual intervention.

### After

`loadDocumentText()` now returns a typed `LoadedText` record that captures source, page count, manual-OCR need, and a free-form reason:

```ts
export interface LoadedText {
  text: string;
  source: TextSource; // 'pdf-text' | 'ocr' | 'none' | 'filename' | 'preloaded'
  needsManualOcr: boolean;
  pageCount?: number;
  reason?: string;
}
```

Pipeline:
1. `text/plain` → return as UTF-8.
2. `application/pdf` → `ExtractionService.parsePdfText()` using `pdf-parse` (wraps `pdfjs-dist` v5). Strips page-marker noise (`-- N of M --`) and uses a 50-char threshold to decide whether the PDF has a real text layer. If yes → `pdf-text`; if no → `none` + `needsManualOcr: true` + reason `pdf_has_no_text_layer`. Malformed/encrypted PDFs → `none` + reason `pdf_parse_failed:<error>`.
3. `image/*` → tesseract OCR (unchanged).
4. Unknown mimetype → `none` with reason `unsupported_mimetype:<mimetype>`.
5. Storage read failure → `filename` with reason `storage_read_failed:<error>`.

The function **never throws on a malformed file** — every error path returns a structured `LoadedText` instead.

`composeMetadata()` now writes `textSource`, `needsManualOcr`, `pageCount`, and `textLoadReason` into `metadata.extraction` so the operator UI and the `/documents/:id` GET response can show exactly why a doc ended up with low confidence.

`ExtractionJobResult` (the queue worker contract) gained `textSource`, `needsManualOcr`, and `pageCount` so background jobs surface the same diagnostics.

---

## 2. Files changed

```
apps/api/package.json                                                       (+ pdf-parse dep, NODE_OPTIONS for tests)
apps/api/src/modules/extraction/extraction.service.ts                        (PDF text extraction; LoadedText; metadata)
apps/api/src/modules/extraction/extraction.service.spec.ts                   (+8 new test cases)
apps/api/src/modules/extraction/extraction.constants.ts                      (ExtractionJobResult gains text fields)
apps/api/src/modules/documents/documents.module.ts                           (import ExtractionModule explicitly — fix for RC #1)
apps/api/src/modules/documents/documents.service.ts                          (extraction injection now mandatory; loud diagnostics)
apps/api/src/modules/documents/documents.service.spec.ts                     (ExtractionService stub for tests)
apps/api/scripts/make-test-pdfs.mjs                                         (NEW — fixtures for the tests)
apps/api/scripts/verify-pdf-parse.mjs                                        (NEW — quick smoke-test for PDF parsing)
apps/api/scripts/invoice-digital.pdf                                        (NEW — test fixture)
apps/api/scripts/invoice-imageonly.pdf                                      (NEW — test fixture)
apps/api/EXTRACTION_PDF_RESULTS.md                                          (this file)
```

---

## 3. Why the document never got extracted on upload (and how it's fixed)

Even with `loadDocumentText` working correctly, a freshly uploaded PDF stayed at `NOVO` with all fields `null` because of two independent wiring problems:

### Root cause #1 — `ExtractionService` injection silently resolved to `null`

`DocumentsService.upload()` (line 184) does:

```ts
if (this.extraction) {
  this.extraction.enqueue({ tenantId, userId, documentId: doc.id })
    .catch((err) => this.logger.warn(`auto-extract failed: ${err.message}`));
}
```

The injection was marked `@Optional()`, and although `ExtractionModule` is declared `@Global()` in `app.module.ts`, the `@Optional()` decorator made the dependency **silently resolve to `null` in some module-ordering configurations**. Result: `this.extraction` was always null, the `if` was always false, and the call never fired. The QA audit (pane-126) correctly identified this.

Fix:
- `documents.module.ts` now **explicitly imports `ExtractionModule`** so the dependency graph is unambiguous regardless of registration order.
- `documents.service.ts` constructor now requires `ExtractionService` (no more `@Optional`) — a wiring regression will now fail at boot, not silently in production.
- Removed the defensive `if (this.extraction)` since the dependency is now guaranteed.

### Root cause #2 — `loadDocumentText` didn't decompress FlateDecode content streams

As described above, `obj.buffer.toString('utf8')` on a PDF yields binary gibberish. `pdf-parse` handles FlateDecode correctly (it wraps `pdfjs-dist` which transparently inflates content streams).

### Root cause #3 — Tesseract dynamic import was already correct

The lazy `await import('tesseract.js')` already works at runtime; my testing showed it executes fine via `npm test` after `--experimental-vm-modules` is set. The fact that OCR only fired for `image/*` mimetypes (and never for `application/pdf`) meant scanned PDFs silently produced nothing — the `needs_manual_ocr` flag in `metadata.extraction.needsManualOcr` now surfaces this case instead.

---

## 4. Test results

### `npm test -- src/modules/extraction --no-coverage`

```
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
```

The 8 new tests under `describe('loadDocumentText() — PDF text layer')` and `describe('ExtractionService.parsePdfText() (static)')` cover:
- digital PDF → text + downstream regex extracts NIF/date/total/IVA/IBAN
- image-only PDF → `none` + `needsManualOcr: true` + `pdf_has_no_text_layer`
- malformed PDF → `none` + `pdf_parse_failed` (never throws)
- text/plain → pass-through
- storage failure → `filename` fallback + `storage_read_failed` reason

### `npm test -- src/modules/documents/documents.service.spec.ts --no-coverage`

```
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

### TypeScript check

`npx tsc --noEmit -p tsconfig.json` reports zero new errors in the extraction and documents modules. (Pre-existing errors in `integrations.e2e.spec.ts` and `payments.service.spec.ts` are unrelated.)

---

## 5. End-to-end live upload verification

Both tests were run against `http://localhost:4000` (NODE_ENV=development, Redis down so extraction runs in-process via the 2s enqueue timeout fallback).

### Test 1 — Digital PDF with text layer

Upload via `POST /documents/upload` with file `scripts/invoice-marker.pdf` (a copy of `invoice-digital.pdf` with a unique header marker to dodge SHA-256 dedup).

API log immediately after upload:

```
[Nest] LOG [DocumentsService] auto-extract queued for cmtgn4h8g0005g57kojb6db29
```

`GET /documents/cmtgn4h8g0005g57kojb6db29` ~5s later:

| Field | Value | Source |
|---|---|---|
| `status` | `EM_REVISAO` | (was `NOVO` before upload) |
| `supplierNif` | `500000000` | regex `NIF: 500000000` |
| `docNumber` | `IF` | regex `Fatura FT 2026/1` → matches `IF` (limitation of the regex layer, not the PDF reader) |
| `docDate` | `2026-03-15` | regex `Data: 15/03/2026` |
| `total` | `123` | regex `Total: 123,00 EUR` |
| `taxAmount` | `23` | regex `IVA: 23,00 EUR` |
| `netAmount` | `100` | total - tax |
| `iban` | `PT50000201231234567890154` | regex + MOD-97 validation |
| `metadata.extraction.textSource` | `pdf-text` | **the bug fix — this used to be missing/empty** |
| `metadata.extraction.needsManualOcr` | `false` | — |
| `metadata.extraction.pageCount` | `1` | — |
| `metadata.extraction.confidence` | `0.85` | — |

### Test 2 — Image-only PDF (no text layer)

Upload of `scripts/invoice-imgonly-marker.pdf` (image-only fixture with unique header).

`GET /documents/cmtgn4vq70009g57k8lnzs261` ~5s later:

| Field | Value |
|---|---|
| `status` | `NOVO` | (correctly **not** auto-promoted — needs manual OCR) |
| `metadata.extraction.textSource` | `none` |
| `metadata.extraction.needsManualOcr` | `true` |
| `metadata.extraction.textLoadReason` | `pdf_has_no_text_layer` |
| `metadata.extraction.pageCount` | `1` |

The operator now sees a clear signal: the file is a scanned PDF, it has no embedded text, and someone must OCR it manually (or wire up a heavier pipeline that rasterises + OCRs the PDF — out of scope for this sprint).

### Test 3 — Manual extraction trigger still works

Manual re-extraction of an already-uploaded document via `POST /extraction/documents/:id` returns:

```json
{
  "data": {
    "queued": false,
    "documentId": "cmtgms2iw0005g5d86wtc7mtg",
    "ok": true,
    "source": "ocr",
    "confidence": 0.85,
    "fieldsPopulated": ["supplierNif","docNumber","docDate","dueDate","total","taxAmount","netAmount","iban","currency"],
    "textSource": "pdf-text",
    "needsManualOcr": false,
    "pageCount": 1,
    "document": { "id": "...", "status": "EM_REVISAO" }
  }
}
```

---

## 6. Operational notes

- `npm test` and `npm run test:cov` now invoke jest with `--experimental-vm-modules` so the `pdfjs-dist` fake-worker can spin up inside ts-jest's CommonJS sandbox. This is a known Jest 30 + `pdfjs-dist` v5 limitation; the runtime Node path (not Jest) has no problem with it.
- `pdf-parse@2.4.5` was installed with `pnpm add pdf-parse --ignore-workspace --filter @docflow/api` (the same install pattern the user specified).
- Heavy OCR (rasterising a scanned PDF and running tesseract on every page) is still **out of scope** for this sprint — that work belongs in a follow-up that introduces a separate rasterisation worker. The current `loadDocumentText` correctly surfaces `needsManualOcr: true` instead of silently producing noise.
- `tsc --noEmit` does not regress any pre-existing module's types; the only errors in the project remain the pre-existing `integrations.e2e.spec.ts` and `payments.service.spec.ts` issues owned by other workers.
