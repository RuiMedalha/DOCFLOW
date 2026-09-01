# Near-100% Document Reading — Gap Backlog

Consolidated from: orchestrator code audit + reference analysis (EXTRACTION_REFERENCE_ANALYSIS.md) + independent review by Kimi K2.6 (pane-147).

## In progress (this round)
- **pane-145** (Opus 5): route IMAGES + SCANS to Gemini vision (not just PDF); rasterise image-only PDFs; fix stale `gemini-3.6-flash` default.
- **pane-146** (Opus 5): richer prompt (senior PT accountant) + line items + `suggestedCategory` (SNC) + auto-filing into the right folder.

## Additional gaps found by Kimi K2.6 (do next round)
1. **HEIC unsupported** — iPhone photos are HEIC by default. `ocrImage`/vision path must accept `image/heic` + `image/heif` (convert to JPEG/PNG before sending to Gemini, or confirm Gemini accepts HEIC inline). HIGH — phone photos are a primary input.
2. **Single-floor merge logic** — mergeVisionWithRegex uses one confidence floor (0.6) for all fields; per-field logic would be better (e.g. always trust regex for a valid MOD-97 IBAN or a QR-AT NIF even if AI is unsure; trust AI for free-text supplier name). MEDIUM.
3. **No retry on low confidence** — when Gemini returns confidence < threshold, there is no re-prompt or escalation to a stronger model. Add one retry (re-prompt, or a second provider) before accepting a weak read. MEDIUM.

## Already covered / good
- QR-AT deterministic path (grok pattern) — solid.
- Multi-provider vision service — present.
- pdf-parse text layer + regex fallback — present.
- Gemini key configured (apps/api/.env, gemini-3.6-flash) — working (~16s latency, poll for EM_REVISAO).
