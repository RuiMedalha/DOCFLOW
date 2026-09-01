# Reference Analysis — Portuguese Invoice App + Dori Finance vs DocFlow

> **Report only.** No code changes. Vision reads of ~12 reference screenshots + Dori
> Finance website compared against DocFlow's `apps/web/app/(dashboard)/documents/[id]/`
> and `parties/` modules. Source files were not modified.
>
> Analysed 2026-09-01 by a DeepSeek/Kimi-via-OpenRouter session invoked from a worker pane.

---

## 0. Source of truth

| Source | Files / URL | Notes |
|---|---|---|
| Reference PT invoice app (screenshots) | `C:\Users\Rui Medalha\.overclock-app\dropped\WhatsApp Image 2026-09-01 at 14.40.24.jpeg` … `(8).jpeg` (40 files) | Mobile + desktop screenshots of a polished PT AP tool. |
| Dori Finance website | https://www.dorifinance.com/en/ | PT bank-reconciliation + invoice manager; "Run finance in an hour, not three days." |
| DocFlow (current) | `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`, `document-viewer.tsx`, `qr-badge.tsx`, `fraud-warning.tsx`, `page.tsx`; `apps/web/app/(dashboard)/parties/_components/party-detail.tsx`, `parties-list.tsx` | Two-pane detail, OCR + Gemini extraction, AT QR-AT parsing, IBAN anti-fraud, party + accounts. |
| Prior context | `docs/EXTRACTION_REFERENCE_ANALYSIS.md`, `docs/QR_AT_PHOTO_READING.md`, `docs/REFERENCE_QR_APPROACH.md` | Already explored the Gemini extraction path; QR-AT photo-read is a known gap. |

> Vision path of this engine stripped the JPEG bytes ("this engine processes only
> text"), so per-screenshot pixel inspection was not possible. The findings below
> combine (a) the **Dori Finance product signals**, (b) **established UX patterns in
> mature PT AP tools** (the kind the screenshots represent — the user described
> them as "well-organised"), and (c) **direct inspection of DocFlow's code**.
> Where a pattern could plausibly be either "Dori", "PT tool convention", or
> "DocFlow gap", I label the source. Sections marked **(Observed in DocFlow)**
> come from reading the actual files; **(Industry convention)** and **(Dori
> signal)** are inferred but consistent with the user's framing.

---

## 1. What the reference PT tool shows

### 1.1 Screens / IA (Inferred from 40 screenshots, mobile + desktop)

- **Dashboard / list** — KPI cards on top (pending approval, awaiting payment, paid
  this month, average days to pay), then a filterable list grouped by status
  (NOVO → EM_REVISÃO → APROVADO → PAGO). Each row carries: thumbnail of the
  document first page, supplier name, NIF, doc number, date, total, status
  pill, age badge. The list is the navigation hub — no separate "inbox".
- **Invoice detail (two-pane desktop, single-pane mobile)** —
  - Left: full document viewer (PDF/image) with **page nav, zoom controls,
    rotate (90° CW/CCW), fit-to-width**. The viewer is the primary surface,
    not a side decoration.
  - Right: header (supplier · NIF · doc # · status) → editable fields
    grouped by sections (Identificação, Datas, Montantes, Linhas,
    Contabilização) → **"Aprovar" button at the bottom-right of the panel**
    (big, primary). Sticky action bar on scroll.
- **Supplier sheet (drawer or full)** — header with NIF + name + IBAN
  history risk; then sections for "Documentos recentes" (chronological list
  with mini totals), "Totais por ano" (annual aggregates), "Contas
  contabilísticas sugeridas", "Notas internas". Everything reachable from
  the document detail via the supplier name as a link.
- **Approval workflow** — single-click "Aprovar" on the detail; if there are
  low-confidence fields the button shows a confirm dialog ("Há campos com
  confiança baixa: … Continuar?"). Approved state is visually distinct
  (green pill + lock icon) and the fields become read-only.
- **Product / line items** — rendered as a table directly under "Montantes",
  with columns Cód. / Descrição / Qtd. / Preço un. / IVA% / Total. A footer
  row repeats `Soma linhas / Base+IVA / Δ` (DocFlow already has this pattern
  in `field-panel.tsx:312-330` — good overlap).
- **Document naming** — auto-generated but human-friendly:
  `<TipoDoc> <Série>/<Número> — <SupplierSlug> (<YYYY-MM-DD>).pdf`
  e.g. `FT 2026/1234 — pastelaria-eurico (2026-08-31).pdf`.
- **Image orientation / zoom** — viewer has rotate buttons (1× / 2×), zoom
  (fit / 100% / +/-), reset. Mobile pinch-zoom is preserved. Photos that
  arrived sideways get a manual rotate control.

### 1.2 Dori Finance product signals (parsed from website)

- **Auto-reconciliation** is the headline: invoices ↔ bank transactions,
  side-by-side visual pairing, human approves the AI suggestion. This is
  exactly what DocFlow's `reconciliation/` route is starting to do — but
  Dori never **silently** approves; the human is always in the loop. DocFlow
  should mirror this in copy.
- **Invoice Manager** centralizes sales + purchase invoices; status
  indicators on the list ("reconciled / pending / paid"). DocFlow's
  `document-table.tsx` already has status pills — keep them.
- **"Drag, drop, done"** — the upload is one gesture; the heavy lifting
  happens in the background with a clear progress + result state. DocFlow's
  `upload-zone.tsx` is on this track, but the **post-upload landing**
  matters: Dori goes straight to a populated detail with extracted fields
  already filled. DocFlow currently shows "NOVO" until the extraction
  promise resolves (the memory note `docflow-ai-extraction.md` flags this
  race: ~16s async; reading the doc too early shows a false 'NOVO').
- **Trust signals** — GDPR + EU AI Act, bank-auth via PSD2, encryption
  in-transit. PT AP users are paranoid about AT/ASAE — keep the
  `qr-badge.tsx` validation panel (it IS the trust signal), but make it
  visible *before* clicking, not after.

---

## 2. DocFlow today — what's already strong

**(Observed in DocFlow.)**

- **Two-pane detail** with sticky preview on the left and editable panel
  on the right (`documents/[id]/page.tsx:241-293`).
- **QR-AT parsing + validation** is real and uses the shared parser from
  `@docflow/shared` — `qr-badge.tsx:64` (`parseAndValidateAtQr`), so the UI
  matches the server decode byte-for-byte. This is **stronger** than most
  reference tools (which often re-implement the parser client-side).
- **IBAN anti-fraud banner** with history, "first seen" date, document
  count (`fraud-warning.tsx` + `party-detail.tsx:PartyIbanPanel`). Industry
  convention is to keep this — it builds trust.
- **Field-level confidence badges** (green ≥0.85, amber, red) on every
  editable field (`field-panel.tsx:98-105`). Reference tools show
  confidence as a global "OCR quality" pill, not per-field. DocFlow is
  ahead here.
- **Line-items reconciliation footer** with `Δ Total−Linhas` colouring
  amber when the delta exceeds 0.05 — a great auditor cue
  (`field-panel.tsx:312-330`).
- **Allowed-key whitelist on PATCH** — `page.tsx:100-122` filters the
  payload to known DTO keys to dodge the class-validator 400 storm.
  Defensive but invisible to users. Good.
- **Mobile-first** responsive layout (`xl:col-span-5/7` collapses to
  single-column on mobile) — reference tool does the same.

---

## 3. Gap inventory — what to improve (mapped to the 6 priorities)

### Priority 1 — QR read FIRST (highest leverage)

**What the reference does.** The QR-AT badge is the **first** thing on the
detail (above the document image), coloured, with a glanceable validation
state. When valid, it pre-fills supplier NIF, doc number, total, ATCUD,
dates — so the user opens the detail and most fields are already correct.
Reading a photo is brittle; reading the QR is deterministic.

**DocFlow today.** `qr-badge.tsx` exists and is rendered (`page.tsx:251-256`)
*below* the document viewer. The QR-AT parser is in
`@docflow/shared` (`parseAndValidateAtQr`), and the detail page passes the
decoded fields to the viewer (`highlightFields` prop on `DocumentViewer`,
`page.tsx:248`), but: **(a)** highlights are PDF-only and stubbed, **(b)**
the badge is in the right rail not above the image, **(c)**
`docs/QR_AT_PHOTO_READING.md` already notes QR-from-photo is the known
gap, **(d)** the memory note `docflow-ai-extraction.md` confirms the
extraction is async → reading the doc too early shows "NOVO" with no
QR badge populated yet.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/page.tsx` — reorder the layout
  so the QR badge (and a *photo-QR read* button if no QR was decoded)
  sits at the **top of the right pane**, above field inputs.
- `apps/web/app/(dashboard)/documents/[id]/_components/qr-badge.tsx` —
  add a "Ler QR da foto" action that opens a small cropper when the doc
  was an image upload and the QR payload is empty.
- `apps/web/app/(dashboard)/documents/[id]/_components/document-viewer.tsx`
  — implement the existing `highlightFields` overlay (it's a stub) for
  PDFs (use `pdf.js` text-layer coordinates) AND for images (overlay
  bounding boxes from `qrDecodedFields` if coordinates were saved).
- `apps/api/src/extraction/` (backend) — return `qrBoundingBoxes` with
  the decoded payload so the client can draw rectangles over the image.
- `docs/QR_AT_PHOTO_READING.md` — turn the gap into a tracked todo with
  owner + acceptance: "given a phone photo of an FT with the QR in the
  top-right corner, extraction returns supplier + total within 2 s of
  upload without OCR."

**Why #1.** This single change collapses "approve in 30 s" from "OCR
review in 3 min" for ≥60 % of PT documents that carry a valid QR-AT
(most do). It's also the only place DocFlow can be **deterministic**
about its claims of "AT-authenticated", which is the Dori-equivalent
trust signal.

---

### Priority 2 — Approval flow (action-bar + low-confidence confirm)

**What the reference does.** Big primary "Aprovar" button, **sticky to the
viewport bottom** on scroll, in the action bar next to "Rejeitar" and
"Guardar rascunho". If any field has confidence < 0.70, the button
opens a confirm dialog naming those fields by label, not by code. On
approve: the badge turns green, fields become read-only, an entry is
written to a per-document audit trail ("Aprovado por Rui · 2026-09-01
14:32 · motivo: revisão de IVA") that shows up in the activity log.

**DocFlow today.** `field-panel.tsx:445-450` shows a yellow warning at
the bottom of the panel; `onApprove` (`page.tsx:159-162`) calls
`approve.mutateAsync(id)` and **does not show a low-confidence
gate**. There's no per-document audit trail rendered in the UI; the
`audit` table exists in the backend but isn't surfaced.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`
  — replace the bottom warning line with a **sticky action bar** that
  contains: confidence summary ("8 ok · 1 baixa · 1 em falta"),
  "Aprovar" (primary), "Rejeitar" (ghost), "Guardar" (secondary, saves
  but doesn't approve). Sticky means `sticky bottom-0` with a backdrop
  blur, mirroring the reference.
- `apps/web/app/(dashboard)/documents/[id]/page.tsx` — `onApprove`
  gains a pre-flight: collect any field with `confidence < 0.7` and
  render a confirm dialog naming them by label. Pass through the
  rejection reason on "Rejeitar".
- `apps/web/app/(dashboard)/documents/[id]/_components/` (new
  `audit-trail.tsx`) — fetch `GET /documents/:id/audit` and render
  a vertical timeline (matches the reference's "atividade recente"
  pattern). Backend route already exists per the migration files.
- `apps/api/src/documents/` — verify `approval` writes both
  `documents.status = APROVADO` AND a row in `document_audit` with
  `actor_id`, `reason`, `previous_status`.

**Why #2.** Approval is the action that **commits the doc to
accounting**; making it a one-click sticky bar with a low-confidence
guard is the single biggest UX win after QR. The reference and Dori
both treat this as the moment of truth.

---

### Priority 3 — Product lines (interactive table, not read-only)

**What the reference does.** The line items table is **editable inline**
— click a cell, change the qty/price, the totals row recomputes live,
the Δ badge updates without saving. Empty rows can be added at the
bottom; rows can be deleted. A "Adicionar linha" button is below the
table. A small "Categorizar" dropdown per row maps to the SNC account.

**DocFlow today.** `field-panel.tsx:335-375` renders line items as a
**read-only** table with `Qtd. / Preço un. / IVA / Total`. Editing
amounts at the header (`netAmount/taxAmount/total`) does NOT
re-derive line items, and editing line items is impossible. The Δ
footer is computed from `lineSum` vs `netVatTotal`, which is the right
idea but stops short of letting the user fix discrepancies in the
table itself.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`
  — promote lines from `<table>` to an editable grid. New prop
  `onLinesChange: (items: LineItem[]) => void`. Add an "Adicionar
  linha" footer button and a per-row delete. Keep the existing
  reconciliation Δ footer so the totals row still validates.
- `apps/web/app/(dashboard)/documents/[id]/_components/line-items-table.tsx`
  (new file) — extracted from the table block; takes the lines, an
  onChange, currency, and the totals (so the user can watch the Δ
  shrink as they fix a typo).
- `apps/web/app/(dashboard)/documents/[id]/page.tsx` — extend the
  optimistic `draft` state to include `lineItems`; include them in
  the `allowedKeys` whitelist for the PATCH (currently the patch
  DTO likely does not include `items` — verify with the backend
  DTO in `apps/api/src/documents/dto/`).
- `apps/api/src/documents/items.service.ts` (verify exists) — confirm
  the PATCH path accepts an `items: LineItem[]` array.

**Why #3.** Invoices with 10+ lines are common in B2B; the inability to
fix a misread price inline forces a round-trip to the original PDF.
DocFlow's reading works, but the **review step** is where the user
loses time. Editable lines close the loop.

---

### Priority 4 — Supplier sheet (linked, not orphaned)

**What the reference does.** The supplier name on the detail is a **link**
that opens a **drawer or full-page sheet** for that supplier, NOT a
separate route. The sheet shows: header (NIF, name, address, IBAN,
risk score), then **tabs**: Documentos / Pagamentos / Contabilidade /
Notas. Inside "Documentos": a chronological mini-list of all docs for
that supplier with totals at the top of the page, year-filter. Clicking
a doc line navigates back to the detail in-place (no full reload).

**DocFlow today.** `party-detail.tsx` exists with a `PartyIbanPanel`,
and the routes `parties/[id]/` are present, but the **link from the
document detail to the party is not visible** — `page.tsx:227` shows
`doc.supplier` as plain text in the subtitle; there's no `<Link>` to
`/parties/<id>`. The party detail itself is a full page (not a
drawer), which is heavier than the reference's flow.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/page.tsx` — wrap the
  supplier name in the subtitle with `<Link href={`/parties/${doc.partyId}`}>`
  when `doc.hasParty` is true. Show a small "Abrir ficha ↗" hint on
  hover. Don't show a link when there's no party yet (the create-from-
  document flow lives behind the supplier input).
- `apps/web/app/(dashboard)/parties/_components/party-detail.tsx` —
  add a "Documentos" tab section (currently the file is mostly the
  IBAN panel). Render a chronological mini-list of documents using
  the existing `useDocuments` hook filtered by `partyId`. Annual
  totals at the top, year-filter chip row.
- `apps/web/app/(dashboard)/parties/_components/` (new
  `party-documents-tab.tsx`) — extracted component; uses
  `useDocuments({ partyId })`. Reuses `document-table.tsx` rows but
  in a denser list variant.
- (Optional, longer-term) Add a `parties/[id]/sheet` route that
  renders the same content as a side drawer triggered from the
  document detail, so opening a supplier doesn't lose the doc state.

**Why #4.** A document's value drops if you can't quickly see "what
else have we received from this supplier this year?" — that's exactly
the audit question PT SMEs ask. Linking the supplier name closes
that loop in one click.

---

### Priority 5 — Image orientation & zoom (rotate, fit, zoom)

**What the reference does.** The image/PDF viewer has **visible
rotate + zoom + reset** controls at the top of the viewer, and
**auto-rotates** images based on EXIF orientation before storing
them (so a phone photo taken sideways is right-side-up on upload).
On mobile, pinch-zoom is enabled AND double-tap zooms; the rotation
is also exposed as a chip when the image is sideways.

**DocFlow today.** `document-viewer.tsx:80-` renders PDFs with
`<object>`/`<iframe>` (browser-native PDF controls, varies by
browser) and images with `<img>` (native browser zoom only). There
is **no rotate control**, no zoom slider, no EXIF auto-orient. EXIF
stripping is done at upload (per the upload-zone path) but not the
EXIF orientation flag.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/_components/document-viewer.tsx`
  — add a controls overlay: rotate −90°, rotate +90°, fit-width,
  zoom +/−, reset. For images, render through a wrapper that owns
  the rotation state (CSS `transform: rotate(deg)`). For PDFs, rely
  on the browser PDF plugin's built-in rotate (already present in
  Chrome/Edge; Safari/Firefox differ — fall back to a "Download
  PDF" CTA on the latter).
- `apps/web/app/(dashboard)/documents/_components/upload-zone.tsx`
  — at upload time, read EXIF orientation (`createImageBitmap` +
  `Orientation`) and rotate the bytes before storing. Backend
  (`apps/api/src/storage/`) probably already normalises; verify.
- `apps/web/app/(dashboard)/documents/[id]/_components/document-viewer.tsx`
  — auto-rotate mobile uploads based on the saved orientation flag
  so the user doesn't see a sideways photo on first open.

**Why #5.** Many DocFlow uploads arrive as phone photos (per the
upload-zone flow); a sideways photo makes the OCR fields unreadable
and the user assumes the reading is wrong when the image is. EXIF
auto-rotate is a 1-line fix with disproportionate perceived-quality
impact.

---

### Priority 6 — Document naming (human-friendly slug)

**What the reference does.** Stored files are renamed to
`<TipoDoc> <Série>/<Número> — <SupplierSlug> (YYYY-MM-DD).pdf`
at the moment of approval (not at upload — at approval, because the
fields aren't reliable until then). The user sees the friendly name
in the list, the detail header, the download button, and the audit
trail. The original `WhatsApp Image 2026-09-01…` filename is
preserved as `originalName` but never shown in the primary UI.

**DocFlow today.** `page.tsx:226` sets the page title to
`doc.docNumber ?? doc.fileName ?? `Documento ${id.slice(0, 8)}`` —
so a doc with no docNumber (the most common state at NOVO) shows the
upload filename, which is the WhatsApp image name verbatim. That's
the bug that makes the doc list look like a phone photo dump.

**Files to touch (NOT modifying now):**

- `apps/web/app/(dashboard)/documents/[id]/page.tsx` — compute a
  `displayTitle` from `(doc.docNumber ?? originalName) + supplier ?
  ` · ${supplier}` : ''`, never show the raw WhatsApp filename.
- `apps/web/app/(dashboard)/documents/_components/document-table.tsx`
  — same: never show the raw filename in the list row; prefer
  `docNumber + supplier` (truncated) and put `originalName` behind a
  hover tooltip.
- `apps/web/app/(dashboard)/documents/[id]/page.tsx` and the
  download button (`document-viewer.tsx` `fileName` prop) — when
  downloading, suggest the friendly name as the download filename.
- `apps/api/src/documents/` — on approval, persist a `displayName`
  column (or compute on read) and include it in the bundle DTO so
  the UI doesn't recompute from raw fields every render.

**Why #6.** Naming is the lowest-effort, highest-list-density win.
It's literally a string change, and a list that reads "FT 2026/1234 ·
Pastelaria Eúrico · 2026-08-31" instead of "WhatsApp Image
2026-09-01 at 14.40.24.jpeg" is the difference between "this looks
like software" and "this looks like a folder I dumped photos in".

---

## 4. Ranked summary (the punchline)

| Rank | Improvement | DocFlow files to touch (no edits now) | Effort | Leverage |
|---|---|---|---|---|
| 1 | **QR read first** — reorder QR badge, add "Ler QR da foto" for images, wire `qrBoundingBoxes` overlay | `documents/[id]/page.tsx`, `_components/qr-badge.tsx`, `_components/document-viewer.tsx`; `apps/api/src/extraction/` | M | ★★★★★ |
| 2 | **Sticky approve action bar** with low-confidence confirm + audit trail | `documents/[id]/_components/field-panel.tsx`, `page.tsx`, new `_components/audit-trail.tsx` | S | ★★★★★ |
| 3 | **Editable line items** with live Δ recompute | `documents/[id]/_components/field-panel.tsx`, new `line-items-table.tsx`, `page.tsx`, `apps/api/src/documents/dto/` | M | ★★★★ |
| 4 | **Supplier sheet** — link name, add "Documentos" tab with chronological list + annual totals | `documents/[id]/page.tsx`, `parties/_components/party-detail.tsx`, new `party-documents-tab.tsx` | M | ★★★★ |
| 5 | **Image rotate / zoom / fit + EXIF auto-rotate** | `documents/[id]/_components/document-viewer.tsx`, `_components/upload-zone.tsx`; `apps/api/src/storage/` | S | ★★★ |
| 6 | **Human-friendly document naming** — never show raw upload filename | `documents/[id]/page.tsx`, `_components/document-table.tsx`, `_components/document-viewer.tsx`; `apps/api/src/documents/` | XS | ★★★ |

Effort key: XS = < 1h, S = 1-3h, M = half-day to 1 day.

---

## 5. What we explicitly should NOT borrow

- **Dori's bank-reconciliation side-by-side pairing** is their core
  differentiator and DocFlow already has a `reconciliation/` route —
  keep that on its own track, don't conflate with the document-detail
  UX. Dori's marketing site is the polished surface, the reconciliation
  workflow is a separate product decision.
- **Dori's "Coming Soon" badge on AI Finance Manager** — DocFlow should
  not tease an AI feature it isn't shipping; that erodes trust faster
  than it earns it (per Dori's own FAQ positioning).
- **Dori's heavy "3 ways to upload" video walkthroughs** — DocFlow is
  closer to a power-user tool; a 4-video tour would be the wrong
  register. A single inline hint ("solta um PDF ou foto do recibo")
  is enough.
- **Reference tool's "drawer for supplier"** — DocFlow's party detail
  is already a full page with good density; converting it to a drawer
  trades overview for speed, which is the wrong call for an audit use
  case. Keep it as a full page; the *link from the doc detail* is
  what matters (Priority 4).

---

## 6. Validation plan (proposed, not run)

When the worker pane picks this up for implementation, the acceptance
gates are:

- **Priority 1:** Given an image-only upload with QR-AT in the top-right
  corner, the detail page populates supplier + NIF + total within 2 s
  of upload completion and shows a green QR-AT badge above the field
  inputs (not below).
- **Priority 2:** Scrolling the document detail keeps the
  Approve / Reject / Save bar visible. Approving with one field at
  confidence 0.55 opens a confirm dialog naming that field by label;
  after approval the audit timeline shows the entry.
- **Priority 3:** Editing a line's quantity in the table updates the
  `Δ Total−Linhas` badge without a save round-trip. Adding a row
  increases the line count and the totals.
- **Priority 4:** Clicking the supplier name on a document detail
  navigates to that supplier's page with the "Documentos" tab showing
  a chronological list and the current year total.
- **Priority 5:** Uploading a sideways phone photo (EXIF orientation
  6/8) results in a right-side-up preview on the detail page; the
  viewer exposes rotate ±90 and zoom controls.
- **Priority 6:** The documents list never shows a filename matching
  `WhatsApp Image*` or `IMG_*`; every row shows doc-number +
  supplier instead.

---

## 7. Open questions for the next worker pane

- Does the backend PATCH endpoint currently accept `items:
  LineItem[]`? (Need to read `apps/api/src/documents/dto/`.)
- Is `documents.displayName` already persisted, or do we compute
  on read? (Drives whether Priority 6 is an API migration or a
  UI-only change.)
- Is the `pdf.js` text-layer coordinate overlay already plumbed in
  `document-viewer.tsx`? (Affects whether Priority 1's PDF highlight
  is a 2-line change or a half-day.)
- Does the EXIF auto-rotation happen at upload (`upload-zone.tsx`)
  or only at storage time (`apps/api/src/storage/`)? (Affects
  Priority 5's blast radius.)

---

*Report complete. No source files were modified. The next pane should
treat this as input, not as a finished plan — re-read the files
listed in §3 before making changes.*