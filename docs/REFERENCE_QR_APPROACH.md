# How the 3 reference projects read the AT QR + fill invoice data

**Task:** understand exactly how gemini-documental, grok-documental, deep-seek-documental read the AT QR and fill fields (esp. the supplier NAME, which the QR does NOT contain) — so DocFlow can copy the simplest working approach.

## The crucial fact about the AT QR payload
The QR-AT string (`A:...*B:...*F:...*O:...`) contains the supplier **NIF** (field A), NOT the supplier **NAME**. So NO project can get the supplier name from the QR alone. Every project that shows a supplier name gets it from somewhere else: the printed text (OCR/vision) or a suppliers lookup by NIF.

---

## Per-project findings

### 1. gemini-documental — **AI (Gemini Vision) is the field-filler; jsQR is only a PDF-side helper**
- **QR read from photo?** No jsQR on phone photos. jsQR runs ONLY in the browser on a **PDF page rendered to canvas at 3.0x scale** (`apps/web/src/app/page.tsx` ~L400-420). If it finds a `*`-payload it keeps it as `qrData`, but that's a bonus text source.
- **QR-only / AI-only / QR+AI?** Effectively **AI-only**. The real extraction is one Gemini Vision call: `POST .../gemini-2.0-flash:generateContent` with `contents:[{parts:[{text:prompt},{inline_data:{mime_type,data:base64}}]}]`, `generationConfig:{response_mime_type:'application/json', temperature:0.1}` (in BOTH `apps/api/src/app.service.ts` analyzeWithGemini AND `apps/web/src/app/api/documents/analyze/route.ts`).
- **How supplier NAME is filled:** the Gemini prompt asks for `"supplierName": "Nome exato da entidade emissora"` — **Gemini reads the printed name off the image**. It does NOT decode it from the QR and does NOT look it up. This is why it "always fills everything": the vision model reads the whole invoice like a human.
- **No QR decode gate.** Gemini is ALWAYS called on the image; the QR is never a reason to skip the AI.

### 2. grok-documental — **QR parsed for fiscal fields; supplier NAME from OCR text, NOT QR**
- **QR read from photo?** Yes, but via a **LIVE CAMERA** stream: `AtQrScanner.tsx` uses `getUserMedia` → draws each video frame to canvas → `jsQR(imageData...)` on a loop until it locks on. That's why it "always reads" — it's continuous live scanning, not a one-shot static photo.
- **Parser:** clean `at-qr.parser.ts` maps A=issuerNif, B=buyerNif, D=type, F=date, G=docId, H=ATCUD, O=total, N=tax, I/J/K = per-region VAT breakdown. Solid, deterministic.
- **QR-only / AI-only / QR+AI?** **No AI at all.** Pure QR + regex OCR.
- **How supplier NAME is filled:** `atQrToDocumentFields()` returns **`supplier: undefined`** — the QR gives only the NIF. The name is filled by a **regex heuristic over the OCR'd text** in `extraction.service.ts` (a "line near NIF / company pattern"). So when the QR is the ONLY source (no readable text), grok ALSO has no supplier name.

### 3. deep-seek-documental — **QR decode is a STUB; AI is text-only**
- **QR read from photo?** No. `qrcode-at.service.ts` `simulateQrCodeExtraction()` literally `return null` with a comment "Em produção: extrair QR Code real da imagem". It's a mock that always falls back to OCR/AI.
- **QR-only / AI-only / QR+AI?** AI-only in practice, and the AI call is **text-only** (`contents:[{parts:[{text:prompt}]}]` — no image sent). Multi-provider registry (OpenAI/Anthropic/Gemini/Ollama/OpenRouter) but all text.
- **How supplier NAME is filled:** AI prompt returns `"supplier": ""` from OCR'd text. No image, no QR name.

---

## Answers to the 5 questions

1. **QR from photo vs text:** gemini = jsQR only on rendered PDF pages (not phone photos); grok = jsQR on a LIVE camera stream (not static photos); deep-seek = stub (none). **None of them decodes a QR from a static uploaded phone photo** — grok relies on live-camera scanning, gemini on the vision model.
2. **QR-only / AI-only / QR+AI:** gemini = AI-only (vision). grok = QR + OCR (no AI). deep-seek = AI text-only (QR stubbed).
3. **Supplier NAME source:** gemini = **Gemini Vision reads the printed name** (the winning approach). grok = OCR-text regex heuristic (undefined if no text). deep-seek = OCR-text AI. **NONE gets the name from the QR** — impossible, the QR has only the NIF.
4. **Simplest/cleanest to copy → gemini-documental's approach:** send the image to a vision model with a strict-JSON prompt (temperature 0.1) and let it read EVERYTHING off the image — supplierName included. No jsQR needed for photos, no QR-decode gate. This is exactly why the user's gemini app "fills all the data" from a photo.

## THE ANSWER to the user's question ("why must the QR pass through Gemini?")
It doesn't have to — but the SUPPLIER NAME is never in the QR. gemini-documental gets the name because **Gemini Vision reads the printed invoice**, independent of the QR. In DocFlow the bug was: when the QR decoded, the code took a "QR-only" path and SKIPPED the vision model, so there was nothing to read the supplier NAME → supplier=null. The fix (already in progress) = always run vision on the image; use the QR only to make the fiscal numbers authoritative. That matches gemini-documental exactly: **vision always reads the image; the QR is a bonus, never a reason to skip vision.**

## Concrete snippet worth copying (gemini-documental, the field-filler)
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=KEY
body: {
  contents: [{ parts: [ {text: PROMPT}, {inline_data:{mime_type, data: base64}} ] }],
  generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
}
```
PROMPT asks for supplierName, supplierNif, docType, docNumber, docDate, dueDate, atcud, netAmount, taxAmount, totalAmount, cashDiscountRate, isEuIntracommunity, suggestedCategory, items[]. The model reads the supplierName off the image — that is the piece DocFlow's QR-only path was missing.

grok's `at-qr.parser.ts` is the cleanest deterministic QR field parser (A/B/D/F/G/H/N/O + I/J/K VAT regions) and is worth mirroring for the authoritative fiscal numbers — but it deliberately leaves `supplier: undefined`, confirming the name must come from vision/OCR.
