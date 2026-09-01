# Document Extraction — Reference Analysis

Consolidated comparison of the document reading / OCR / AI extraction code across the
three reference projects and DocFlow. Goal: make DocFlow's document reading near‑100 %
across scanner / photo / PDF / image, borrowing the best of each reference.

Analysed 2026‑08‑31 by reading the extraction sources directly.

---

## 1. Per‑project summary

### 1.1 `gemini-documental` — **best AI prompt**
- **Entry point:** `apps/api/src/app.service.ts::analyzeWithGemini()` + web route
  `apps/web/src/app/api/documents/analyze/route.ts`.
- **Approach:** single **multimodal Gemini Vision** call. Sends the file as
  `inline_data` (base64 + mimeType) with a **domain‑specific accountant prompt**, and
  requests `response_mime_type: 'application/json'`, `temperature: 0.1`.
- **Model:** `gemini-2.0-flash` (endpoint `v1beta/.../gemini-2.0-flash:generateContent`).
- **Fields extracted:** supplierName, supplierNif (incl. **intra‑EU VAT** e.g. `FR04540090727`),
  docType (FT/FR/FS/NC/ND), docNumber, docDate, dueDate, atcud, netAmount, taxAmount,
  totalAmount, cashDiscountRate, **isEuIntracommunity**, **suggestedCategory** (SNC folders),
  and **line items** (code/description/quantity/unitPrice/total).
- **Strengths:** the prompt is the richest — it frames the model as the buyer company's
  senior accountant, handles PT/FR/ES/EU, extracts line items and an SNC category, strips
  `data:` prefix, strips ```json fences on the web side.
- **Weaknesses:** no OCR/regex fallback (if Gemini key missing → hard error); in‑memory only
  (no DB persistence in the sample service); hardcoded to one company NIF; single provider.

### 1.2 `deep-seek-documental` — **best architecture (multi‑provider + dedicated OCR module)**
- **Entry points:** `apps/api/src/ai/ai.service.ts` (LLM classification) and
  `apps/api/src/ocr/ocr.service.ts` + `ocr/qrcode-at.service.ts` (OCR pipeline). OCR is a
  **dedicated NestJS module**, auto‑triggered from the email processor.
- **Approach:** two layers — (a) a **provider‑agnostic LLM abstraction** (`getAiProviders()`)
  supporting **OpenAI, Anthropic, Gemini, Ollama, LM Studio, OpenRouter, and a custom URL**,
  each toggled by env var, with per‑provider request/response shaping and a tolerant
  `parseAiResponse()` (regex‑extracts the first `{...}` block); (b) an OCR service that
  routes by mimeType (`extractTextFromPdf` / `extractTextFromImage`), regex‑parses invoice
  fields, detects document type, and persists to `document.metadata.ocrText` + fields.
- **Fields extracted:** nif, documentDate, dueDate, total, iva, supplier, invoiceNumber,
  **iban** (`\bPT\d{23}\b`), currency, plus a confidence accumulator.
- **Strengths:** the multi‑provider abstraction is excellent and lets any model be swapped by
  env; clean separation of OCR vs LLM; auto‑OCR on email ingest; document‑type detection;
  persists ocrText for later re‑classification.
- **Weaknesses:** `extractTextFromPdf`/`extractTextFromImage` are **mocks** (comment says "em
  produção usar pdf-parse / Tesseract") — real text extraction never implemented; the LLM
  classify prompt is thin; no multimodal (sends OCR text only, not the image).

### 1.3 `grok-documental` — **best deterministic PT fiscal path**
- **Entry point:** `apps/api/src/extraction/extraction.service.ts` +
  `extraction/at-qr.parser.ts`.
- **Approach:** **regex heuristics on text**, but with a first‑class **AT QR‑code parser**.
  If a line looks like an AT payload (`isLikelyAtQr`), it parses the QR (`parseAtQr` →
  `atQrToDocumentFields`) and returns with **confidence 0.95** — deterministic, free, exact.
  Otherwise it runs labelled regexes for NIF, invoice number, dates (doc + due), total, IVA,
  supplier, with a **weighted confidence score** (nif +0.25, total +0.25, docNumber +0.15,
  date +0.1, supplier +0.05).
- **Fields extracted:** supplier, customer, nif, docNumber, docDate, dueDate, total, iva,
  currency, confidence, rawHints.
- **Strengths:** the AT‑QR parser is the cleanest of the set (typed `AtQrParsed`, doc‑type map,
  money/date parsers, IVA breakdown by region); good weighted confidence; auto‑links a Party
  by NIF (`matchOrCreate`). Honest about the OCR gap.
- **Weaknesses:** no AI at all; **OCR is an explicit placeholder** (`OCR placeholder … integrate
  Tesseract/Textract`); PT‑centric regexes (no robust foreign VAT / `1,234.56` decimals).

---

## 2. Best practices to adopt (the "best of each")

| Capability | Best reference | What to take |
|---|---|---|
| **AI vision prompt** | gemini-documental | Domain‑framed "senior accountant of <buyer NIF>" prompt, **line‑item extraction**, `isEuIntracommunity`, `suggestedCategory` mapped to SNC folders, `response_mime_type: application/json`, `temperature: 0.1`. |
| **Multi‑provider abstraction** | deep-seek | Env‑toggled provider registry (OpenAI/Anthropic/Gemini/Ollama/LM Studio/OpenRouter/custom) + tolerant JSON extraction (`match(/\{[\s\S]*\}/)`). |
| **Dedicated OCR module** | deep-seek | Separate OCR service that routes by mimeType and persists `ocrText` for re‑classification. |
| **AT QR‑code first** | grok | Parse the AT QR before anything else → confidence 0.95, zero cost, exact PT fiscal data. |
| **Weighted confidence** | grok | Accumulate a 0–1 confidence from which fields were found (drives the review queue). |
| **Auto Party linking** | grok | `matchOrCreate` a supplier by extracted NIF and link it to the document. |
| **JSON fence stripping** | gemini (web) | `rawJson.replace(/```json/g,'').replace(/```/g,'').trim()` before `JSON.parse`. |

---

## 3. Specific code patterns / prompts / field lists worth porting

### 3.1 The Gemini accountant prompt (gemini-documental) — richer than DocFlow's
Add to DocFlow's `SYSTEM_PROMPT`:
- **Line items** array (`code, description, quantity, unitPrice, total`) — DocFlow captures
  `ivaBreakdown` but **not line items**; accountants need them.
- **`isEuIntracommunity`** boolean + **`suggestedCategory`** mapped to the tenant's SNC/PGC
  folders — turns extraction into auto‑filing.
- **`cashDiscountRate`** (desconto de pronto pagamento) — common in PT supplier invoices.

### 3.2 Tolerant JSON parsing (deep-seek `parseAiResponse`)
```ts
const m = content.match(/\{[\s\S]*\}/);
return m ? JSON.parse(m[0]) : { text: content };
```
DocFlow already strips fences; also add the "first `{...}` block" fallback for models that
wrap JSON in prose.

### 3.3 Multi‑provider registry (deep-seek `getAiProviders`)
DocFlow's `VisionService` already supports anthropic/openai/gemini by env. Port deep-seek's
extra providers so the user can use models they have direct access to: **OpenRouter,
Ollama/LM Studio (local), custom URL**. Keep DocFlow's rule (OpenRouter only for models not
available directly).

### 3.4 AT QR parser (grok `at-qr.parser.ts`)
DocFlow already has an equivalent (`parseAtQr` in `@docflow/shared`). Confirm parity: grok's
`DOC_TYPE_MAP` (FT/FR/FS→fatura, NC/ND→outro, RC/RG→recibo) and per‑region `ivaBreakdown` are
worth diffing against DocFlow's mapping.

### 3.5 IBAN regex (deep-seek)
`\bPT\d{23}\b` for PT; DocFlow already generalised to any‑country MOD‑97 — keep DocFlow's.

---

## 4. Gaps in DocFlow's current extraction vs the best of the references

DocFlow is **already the most complete** of the four: it has the multi‑provider `VisionService`
(anthropic/openai/gemini) with a hard 30 s timeout, real `pdf-parse` text extraction, AT‑QR
deterministic path, regex fallback, `mergeVisionWithRegex`, a keyword `classifyDocumentType`,
and a rich JSON schema (supplier/VAT/IBAN/country/ivaBreakdown/documentType/confidence).
Remaining gaps, ranked:

1. **Stale default Gemini model.** `vision.service.ts` defaults `geminiModel` to
   **`gemini-1.5-flash`**; gemini-documental uses `gemini-2.0-flash`, and (per the live test in
   this project) `gemini-2.0-flash` / `1.5-flash` are **discontinued → use `gemini-3.6-flash`**.
   The env `GEMINI_VISION_MODEL` is already wired; update the **default** so it works without env.
   *(High — silent wrong model = failed AI calls.)*
2. **No line‑item extraction.** References (gemini) pull `items[]`; DocFlow's schema stops at
   `ivaBreakdown`. Add `lineItems` to the schema + prompt for accountant‑grade output. *(High.)*
3. **No auto‑category / SNC filing from AI.** gemini's `suggestedCategory` + `isEuIntracommunity`
   drive automatic folder assignment; DocFlow classifies only document *type*, not accounting
   category. *(Medium.)*
4. **Image‑only / scanned PDF OCR.** DocFlow reads the PDF **text layer** (pdf-parse) and sends
   images to vision, but a **scanned PDF with no text layer** still depends on the vision model
   rasterising it. Confirm scanned‑PDF and phone‑photo paths: rasterise first page to an image
   before the vision call when `textSource==='none'`, and keep tesseract as the offline fallback.
   *(High for the "100 % reading, incl. scanner/photo" goal.)*
5. **Local/offline providers absent.** deep-seek supports Ollama/LM Studio/OpenRouter/custom;
   DocFlow's `VisionService` has only the 3 cloud providers. Adding local providers gives a
   no‑cost fallback and privacy option. *(Medium.)*
6. **Confidence not consistently surfaced for the review queue.** grok's weighted score gates the
   review UI. DocFlow stores `aiConfidence`/`ocrConfidence` — ensure the inbox sorts/flags by it
   so low‑confidence docs are reviewed first. *(Low.)*

### Bottom line
DocFlow's architecture already surpasses all three references. To hit "near‑100 % reading" the
highest‑leverage changes are: **(1) fix the default Gemini model to `gemini-3.6-flash`**,
**(4) guarantee the scanned‑PDF / photo path rasterises to an image for the vision model**, and
**(2) add line‑item extraction**. Category auto‑filing (3) and local providers (5) are strong
follow‑ups.
