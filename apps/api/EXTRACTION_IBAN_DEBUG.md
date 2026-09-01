# EXTRACTION_IBAN_DEBUG — IBAN debugability fix

## TL;DR

The live `iban: null` was **not** a regex bug or tokenisation issue. **The user's PDF text doesn't actually contain an IBAN**. What looked like iban=null was correct behaviour — the regex correctly found zero candidates because the PDF generator that produced the user's PDF omitted the IBAN value (or had it truncated by a layout issue).

What's new in this sprint:

1. **`metadata.extraction.extractedTextPreview`** (first 4 KB) — the operator can now read exactly what pdf-parse returned and confirm "the IBAN wasn't there to begin with".
2. **`metadata.extraction.extractedTextLength`** — so the operator knows if the text was truncated at 4 KB.
3. **`metadata.extraction.ibanCandidates`** — every IBAN-shaped string the regex matched, with raw form, normalised form, and whether MOD-97 accepted it. Lets the operator see "the regex matched something but it wasn't a valid IBAN".
4. **`warnings: ['iban_label_only_truncated']`** — text ends with bare `IBAN` or `IBAN:` with nothing after.
5. **`warnings: ['iban_truncated:<partial>']`** — text has `IBAN: PT500002` (truncated to a prefix only).
6. **Verified live**: re-extracting the user's failing doc now surfaces the diagnostic; the happy-path upload (PDF with full IBAN) populates `iban: 'PT50000201231234567890154'` correctly.

Tests: **48/48** extraction + **14/14** documents = **62/62** total green. Runs under both `npx jest` and `npm test`.

---

## The actual pdf-parse text for the user's failing document

The user uploaded a document whose `metadata.extraction.textSource` was already `pdf-text`, so `loadDocumentText` was returning text. After my new `extractedTextPreview` lands, the operator can read it directly:

```
$ curl /documents/cmth1y3870009g590d41m79ml | jq '.data.metadata.extraction'

{
  "source": "ocr",
  "textSource": "pdf-text",
  "pageCount": 1,
  "needsManualOcr": false,
  "warnings": ["iban_label_only_truncated"],
  "extractedTextLength": 94,
  "extractedTextPreview": "Fatura FT 2026/1788169492927 NIF: 500697256 Data: 2026-03-15 Total: 123,00 EUR IVA: 23,00 IBAN",
  "ibanCandidates": null,
  ...
}
```

Notice: **the PDF's text literally ends with "IBAN" with no value after it.** That's why the IBAN regex finds zero matches → `iban: null`. The behaviour is correct. The user's reported "The IBAN in the PDF text is PT50000201231234567890154" was based on the text they *thought* the PDF generator produced, not the actual text in the file.

I verified this by pulling the actual file from `apps/api/uploads/<tenant>/2026/08/<filekey>.pdf` and running pdf-parse against it directly:

```js
import { PDFParse } from "pdf-parse";
const buf = readFileSync("apps/api/uploads/.../1788169492936-b1929b4db9ec9e84.pdf");
const p = new PDFParse({ data: buf });
const r = await p.getText();
console.log(JSON.stringify(r.text));
// → "Fatura FT 2026/1788169492927 NIF: 500697256 Data: 2026-03-15 Total: 123,00 EUR IVA: 23,00 IBAN\n\n-- 1 of 1 --\n\n"
```

(The byte length is 512 — significantly smaller than my own happy-path test fixture of 837 bytes, suggesting the IBAN field was never laid out by the generator that produced this file.)

---

## Why the regex/validator were never the problem

The regex `\b[A-Z]{2}\s?\d{2}(?:[\s.\-]?[A-Z0-9]){10,30}\b/gi` *does* match `PT50000201231234567890154` in isolation — verified against:

- plain string (`"PT50000201231234567890154"`) → 1 match
- spaced string (`"PT50 0002 0123 1234 5678 9015 4"`) → 1 match
- newlines mid-IBAN (`"PT50\n00020101231234567890154"`) → 1 match
- `text.toUpperCase()` as the user described → 1 match

`normalizeIban(match[0])` returns `PT50000201231234567890154`. `isValidIban(...)` returns `true` (MOD-97 passes).

But none of that runs when the text doesn't contain an IBAN in the first place. `regexExtraction` correctly returned `iban: undefined`. `buildUpdateData` correctly did NOT add `data.iban`. The document row was updated without an iban. **The bug was in the user's PDF generator, not in the extraction service.**

The bigger problem wasn't the missing IBAN — it was that **the operator had no way to see what text the extractor actually saw**. They had to take the IBAN regex/validator on faith when the issue was actually upstream of those (text wasn't there). My fix makes that visible.

---

## What's persisted now (in `metadata.extraction`)

| Field | Type | Purpose |
|---|---|---|
| `textSource` | `'pdf-text' \| 'ocr' \| 'none' \| 'filename' \| 'preloaded'` | Where the text came from |
| `extractedTextLength` | number | Total chars in the extracted text (0 if no text) |
| `extractedTextPreview` | string | First 4000 chars; suffix `…[truncated, full length=N]` if longer |
| `ibanCandidates` | `Array<{ raw, normalized, valid }> \| null` | Every IBAN-shaped match the regex tried |
| `warnings` | `string[]` | Includes `iban_label_only_truncated`, `iban_truncated:<partial>`, `iban_invalid:<candidate>` |
| `needsManualOcr` | boolean | True when the PDF had no text layer |

A `GET /documents/:id` response with the new fields tells the operator, at a glance, exactly what happened:

| Scenario | iban | ibanCandidates | warnings |
|---|---|---|---|
| Happy path | populated | `[{raw, normalized, valid:true}]` | `[]` |
| Bare "IBAN" label, no value | `null` | `null` | `['iban_label_only_truncated']` |
| Partial IBAN ("IBAN: PT500002") | `null` | `null` | `['iban_truncated:PT500002']` |
| Invalid MOD-97 candidate | `null` | `[{raw, normalized, valid:false}]` | `['iban_invalid:<candidate>']` |
| No IBAN label at all | `null` | `null` | `[]` |

The user can now see which scenario applies without having to debug the regex.

---

## Live verification

### The user's failing document (re-extracted against the rebuilt API)

```
$ curl POST /extraction/documents/cmth1y3870009g590d41m79ml
{ "ok": true, "fieldsPopulated": [...], "textSource": "pdf-text" }

$ curl GET /documents/cmth1y3870009g590d41m79ml
{
  "iban": null,
  "docNumber": "FT 2026/178816",
  "type": "FATURA_RECEBIDA",
  "metadata.extraction": {
    "textSource": "pdf-text",
    "warnings": ["iban_label_only_truncated"],
    "extractedTextLength": 94,
    "extractedTextPreview": "Fatura FT 2026/1788169492927 NIF: 500697256 Data: 2026-03-15 Total: 123,00 EUR IVA: 23,00 IBAN",
    "ibanCandidates": null,
    ...
  }
}
```

The diagnostic is now visible. The user can read `extractedTextPreview` and see the text literally ends with "IBAN" — the value was never in the PDF. The warning tells the operator the IBAN field is truncated/missing.

### A different document with a partial IBAN

```
$ curl GET /documents/cmtgncxoa0005g594m7t1hs17
{
  "iban": null,
  "metadata.extraction": {
    "warnings": ["iban_truncated:PT500002"],
    "extractedTextPreview": "Fatura FT 2026/123 NIF: 500697256 Data: 2026-03-15 Total: 123,00 EUR IVA: 23,00 IBAN: PT500002"
  }
}
```

Same story, more specific: the text has `IBAN: PT500002` (only 8 chars, where a real PT IBAN needs 23 after the prefix). The operator gets a precise `iban_truncated:PT500002` warning instead of a silent null.

### Happy path (PDF with the full IBAN)

```
$ curl POST /documents/upload invoice-acc-final.pdf
$ curl GET /documents/<id>
{
  "iban": "PT50000201231234567890154",
  "docNumber": "FT 2026/1",
  "type": "FATURA_RECEBIDA",
  "metadata.extraction": {
    "textSource": "pdf-text",
    "ibanCandidates": [{ "raw": "PT50 0002 0123 1234 5678 9015 4", "valid": true, "normalized": "PT50000201231234567890154" }],
    "extractedTextPreview": "Empresa XPTO, Lda\n...IBAN: PT50 0002 0123 1234 5678 9015 4"
  }
}
```

End-to-end: upload → extract → populate → audit trail. ✅

---

## Files changed

```
apps/api/src/modules/extraction/extraction.service.ts
  + `ibanCandidates` field on `ExtractedFields`
  + IBAN section records {raw, normalized, valid} for each candidate,
    not just the first valid match
  + `iban_label_only_truncated` warning when text ends with bare IBAN
  + `iban_truncated:<partial>` warning when text has IBAN: with a
    too-short value
  + `composeMetadata` persists `extractedTextPreview`, `extractedTextLength`,
    and `ibanCandidates`

apps/api/src/modules/extraction/extraction.service.spec.ts
  + 5 new tests covering ibanCandidates audit trail, label-only
    truncation detection, partial-truncation detection, and the
    "full IBAN does not get truncated warning" guard

apps/api/EXTRACTION_IBAN_DEBUG.md
  + this file
```

No changes to: `prisma.service.ts`, banking, payments, reconciliation, or foreign-invoice helpers.

---

## Operational notes

- `extractedTextPreview` is capped at 4000 chars. Documents with longer text get a `…[truncated, full length=N]` suffix. We keep the total length so the operator knows whether truncation happened.
- `ibanCandidates` is bounded by the number of IBAN-shaped matches in the text. In practice it's 0 or 1; 2+ is rare and indicates noise.
- The new fields are additive — nothing in the existing extraction pipeline is replaced or weakened.
- The user's PDF text was always correct from pdf-parse's perspective; the user's belief that "the IBAN is PT50000201231234567890154" was based on the text they thought was uploaded. With this fix, future similar mismatches are diagnosable in one round-trip instead of three.