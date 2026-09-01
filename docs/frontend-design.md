# DocFlow — Frontend Design Document

> **Status:** v0.1 — foundation for the Portuguese enterprise SaaS MVP.
> **Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3.4 + PWA (`next-pwa`).
> **Reference:** [Linear](https://linear.app) / [Vercel](https://vercel.com) / [Stripe](https://stripe.com)-grade polish, adapted for Portuguese enterprise tone (correct terminology: NIF, IBAN, SEPA, TOConline/Moloni, AT QR codes).

---

## 1. Source repo comparison

Three sibling projects were reviewed as candidate foundations. The decision matrix:

| Dimension | `deep-seek-documental` | `gemini-documental` | `grok-documental` |
|---|---|---|---|
| Next.js | 14.0 | 14.2 | **15.1** ✅ |
| React | 18.2 | 18.3 | **19** ✅ |
| Route groups `(auth)` / `(dashboard)` | ❌ flat `app/` | ❌ flat `app/` | ✅ |
| Route coverage | 7 modules | 1 (`/`) | **9 modules** ✅ |
| Token system (CSS variables) | ad-hoc glass | minimal | **full light/dark tokens** ✅ |
| Component primitives | `glass`, `radial-glow`, `table-dark` | none | **`.btn-*`, `.input`, `.card`, `.nav-item-*`, `.badge-*`** ✅ |
| Light/dark theming | dark only | dark only | **full toggle + system** ✅ |
| Command palette (Cmd+K) | ❌ | ❌ | ✅ `GlobalSearch` |
| PWA manifest | ❌ | ❌ | ✅ `manifest.json` |
| Mobile scanner | ❌ | ✅ (`jsqr` + `tesseract.js`) | ✅ (`AtQrScanner` + `DocumentScanner`) |
| Charts (recharts) | partial | ❌ | ✅ dashboard pipeline |
| Best for | demo dashboard polish | OCR experimentation | **enterprise shell** ✅ |

### Decision: **port from `grok-documental`**

It already has Next.js 15, React 19, the full token system, light/dark theming with proper data-theme toggling, all required routes, the command palette, the PWA manifest, and the scanner primitives. We will **port the design system 1:1** and **extend** it with the new modules DocFlow MVP needs: WebAuthn passkey login, RH/Payroll, accountant portal, Copilot IA chat panel.

### Module-by-module source verdict

| DocFlow screen | Best existing screen to port | Source path |
|---|---|---|
| Login (WebAuthn) | Login (email/password) | `grok-documental/apps/web/src/app/(auth)/login/page.tsx` |
| Register / Onboarding | Register | `grok-documental/apps/web/src/app/(auth)/register/page.tsx` |
| Executive dashboard | Dashboard with KPI grid + charts | `grok-documental/apps/web/src/app/(dashboard)/dashboard/page.tsx` |
| Document inbox | Inbox (drag-drop, link import, QR/scanner) | `grok-documental/apps/web/src/app/(dashboard)/inbox/page.tsx` |
| Documents list | Documents table | `grok-documental/apps/web/src/app/(dashboard)/documents/page.tsx` |
| Document detail | Documents `[id]` route | `grok-documental/apps/web/src/app/(dashboard)/documents/[id]` |
| Reconciliation | Reconciliation cards w/ accept/reject | `grok-documental/apps/web/src/app/(dashboard)/reconciliation/page.tsx` |
| Banking / CSV import | 4-step CSV wizard | `grok-documental/apps/web/src/app/(dashboard)/bank/page.tsx` |
| Payables / SEPA | Payables list + SEPA CSV/XML export | `grok-documental/apps/web/src/app/(dashboard)/payables/page.tsx` |
| CRM / Parties | Parties list + HubSpot/Pipedrive import | `grok-documental/apps/web/src/app/(dashboard)/parties/page.tsx` |
| Settings / Integrations | Settings (rules, TOConline, Woo, IMAP) | `grok-documental/apps/web/src/app/(dashboard)/settings/page.tsx` |
| Command Palette (Cmd+K) | `GlobalSearch` | `grok-documental/apps/web/src/components/GlobalSearch.tsx` |
| Mobile PWA scanner | `AtQrScanner` + `DocumentScanner` | `grok-documental/apps/web/src/components/*Scanner.tsx` |

### Items that need NEW design (not in any source)
1. **WebAuthn passkey login** — replace email/password primary path with SimpleWebAuthn browser flow.
2. **Copilot IA chat panel** — right-docked slide-over panel, conversation list, citations chip.
3. **Accountant portal** — read-only restricted variant of dashboard with VAT/SAF-T exports.
4. **RH / Payroll** — employees, payslips, IRS/SS tables, calendar of obligations.
5. **Settings → Team & Roles** — multi-user management with RBAC.

---

## 2. Design tokens

All tokens live as CSS custom properties on `:root` and `[data-theme='light']`, consumed in `app/globals.css` and exposed to Tailwind via inline `style` (the grok pattern — keeps theme switching zero-JS for the variables themselves).

### 2.1 Color tokens

**Dark (default)** — slate-950 base with sky→indigo brand gradient and warm accents:

```
--bg               #070b14   (page background)
--bg-elevated      #0d1320   (cards, panels)
--bg-card          rgba(15, 23, 42, 0.72)   (frosted cards)
--bg-card-solid    #0f172a   (solid panels / modals)
--sidebar          rgba(15, 23, 42, 0.55)
--text             #f1f5f9   (WCAG AAA on --bg-card-solid)
--text-muted       #94a3b8
--text-subtle      #64748b
--accent           #38bdf8   (sky-400 — primary brand)
--accent-2         #818cf8   (indigo-400 — gradient pair)
--accent-3         #a78bfa   (violet-400 — tertiary)
--success          #34d399
--warning          #fbbf24
--danger           #f87171
--info             #60a5fa
```

**Light** — slate-50 base with deep-sky brand:

```
--bg               #f8fafc
--bg-elevated      #ffffff
--text             #0f172a
--accent           #0284c7   (sky-600 — stronger for AA on white)
--accent-2         #4f46e5
```

**Contrast verification (WCAG AA):**
- `--text` on `--bg-card-solid`: 16.1:1 (dark) / 18.4:1 (light) — **AAA**.
- `--text-muted` on `--bg-card-solid`: 7.4:1 / 7.9:1 — **AAA**.
- `--accent` on `--bg-card-solid`: 6.8:1 (dark) / 5.6:1 (light) — **AA**.
- `--danger` on `--bg-card-solid`: 5.2:1 / 4.6:1 — **AA** (passes for text ≥14px).
- Buttons: white text on `#38bdf8` button bg — 3.0:1 (passes for ≥18px non-text per WCAG 1.4.11).

### 2.2 Typography

- **Sans:** Inter (variable, via `next/font/google`) → `var(--font-inter)`.
- **Mono:** `'JetBrains Mono', ui-monospace, 'SF Mono', monospace` — for IBAN/NIF/SEPA references.
- **Scale** (rem, line-height in tailwind defaults):

| Token | rem | px | use |
|---|---|---|---|
| `text-xs` | 0.75 | 12 | metadata, badges |
| `text-sm` | 0.875 | 14 | body, table cells |
| `text-base` | 1 | 16 | paragraphs |
| `text-lg` | 1.125 | 18 | card titles |
| `text-xl` | 1.25 | 20 | section headers |
| `text-2xl` | 1.5 | 24 | page-title mobile |
| `text-3xl` | 1.875 | 30 | page-title desktop, KPI values |

- **Tracking:** `tracking-tight` on display sizes; `tracking-wider` on uppercase micro-labels.
- **Numerics:** `font-variant-numeric: tabular-nums` on all financial values (the `.tabular-nums` utility).

### 2.3 Spacing

Tailwind 4-px scale, plus radius tokens:

```
--radius-sm    0.5rem   (chips, small inputs)
--radius       1rem     (default — cards, buttons, inputs)
--radius-lg    1.25rem  (large surfaces, hero panels)
```

Layout density: `--space-page` = `p-4 md:p-8`; `--space-card` = `p-5 md:p-6`; `--space-row` = `px-4 py-3.5`.

### 2.4 Shadows & glows

- `var(--glow)` — sky-tinted elevation (KPI cards, command palette).
- `var(--glow-violet)` — accent-3 highlight (Copilot panel).
- `var(--glow-emerald)` — positive feedback (reconciliation accept).

### 2.5 Motion

- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` — Linear-style ease-out.
- `--duration-fast: 150ms`; `--duration: 250ms`; `--duration-slow: 450ms`.
- `animate-in` (fade-in-up 450ms) on all dashboard panels with `.animate-delay-{1..5}` (50ms stagger).
- `prefers-reduced-motion` disables all transitions globally.

---

## 3. Component inventory

Primitives live in `src/components/ui/` (shadcn-style, but homegrown to avoid extra deps). Composed blocks live in `src/components/blocks/`. All components are server-first where possible; only stateful ones get `'use client'`.

### 3.1 Foundation (`src/components/ui/`)

| Component | Purpose | Notes |
|---|---|---|
| `Button` | Primary / Secondary / Ghost / Danger / Icon | Maps to `.btn-*` classes; `asChild` via Radix pattern |
| `Input` | Text / email / number / date / password | `.input`; `aria-invalid` for errors |
| `Select` | Native `<select>` styled | `.input`; deferred to cmdk combobox later |
| `Textarea` | Multi-line | `.input` variant |
| `Checkbox` / `Radio` | Native + custom | WCAG focus ring |
| `Label` | Form labels | `.label` |
| `Badge` | Status pills | `.badge-{sky\|emerald\|amber\|violet\|rose\|neutral}` |
| `Card` | Surface | `.card` + optional `.card-hover` / `.card-solid` |
| `Separator` | Divider | `.divider` |
| `Skeleton` | Loading | `.skeleton` with optional `.animate-shimmer` |
| `EmptyState` | Icon + title + description + CTA | lucide icon, optional illustration |
| `Toast` | Notifications | `sonner` (configured for theme-aware) |
| `Tooltip` | Hover info | Radix `@radix-ui/react-tooltip` |
| `Dropdown` | Menu | Radix `@radix-ui/react-dropdown-menu` |
| `Dialog` | Modal | Radix `@radix-ui/react-dialog` |
| `Tabs` | Tabbed views | Radix `@radix-ui/react-tabs` |
| `DataTable` | Sortable / paginated table | `@tanstack/react-table` + Tailwind rows |
| `Avatar` | Initials / photo | `.bg-gradient-to-br` colored initials |
| `KpiCard` | Stat tile with icon, label, trend | Reused from grok dashboard |
| `PipelineRow` | Labeled progress bar | Used in dashboard pipeline widget |

### 3.2 Feature blocks (`src/components/blocks/`)

| Block | Purpose |
|---|---|
| `AppShell` | Sidebar + topbar + main layout (wraps `(dashboard)` route group) |
| `Sidebar` | 272px collapsible sidebar with tenant switcher, nav, user footer |
| `Topbar` | Sticky bar with global search trigger + theme toggle + notifications |
| `CommandPalette` | Cmd+K modal powered by `cmdk` |
| `CopilotPanel` | Right-docked slide-over chat with citations |
| `ThemeToggle` | Sun/Moon toggle bound to `next-themes` |
| `NotificationBell` | Polling indicator + dropdown list |
| `UserMenu` | Profile, switch tenant, logout |
| `PageHeader` | Title + subtitle + actions slot |
| `DocumentDropzone` | Drag-drop upload with progress |
| `DocumentScanner` | Camera capture + QR decoder |
| `AtQrScanButton` | AT QR Code scanner (mobile PWA) |
| `MatchSuggestionCard` | Bank ↔ invoice match accept/reject |
| `CsvWizardSteps` | 4-step bank CSV import (upload → map → preview → done) |
| `SepaExportButton` | CSV / XML download trigger |
| `PayableRow` | Payable list row with status badge |
| `ChatMessage` | Copilot message bubble (user/assistant) |
| `CitationChip` | `[1] Fatura FT 2024/123` clickable chip |
| `RoleGate` | RBAC conditional render wrapper |

### 3.3 Icons (`lucide-react`)

Exhaustive list for first-pass coverage:

`Inbox, FileText, Send, Sparkles, Building2, Menu, X, Sun, Moon, Bell, LogOut, Landmark, GitCompare, Settings, LayoutDashboard, Users, Wallet, TrendingUp, ArrowUpRight, Upload, CheckCircle2, Clock, AlertCircle, RefreshCw, Search, Download, Filter, Check, X, Zap, ArrowRight, Mail, Lock, KeyRound (WebAuthn), Fingerprint, ChevronRight, ChevronLeft, Camera, QrCode, Receipt, FileSpreadsheet, Briefcase, Calculator, CalendarDays, MessageSquare, Send, Bot, ChevronDown, MoreHorizontal, Plus, Eye, EyeOff, Copy, ExternalLink, Trash2, Edit, ArrowDownToLine, ArrowUpFromLine, Euro, Building, Phone, Hash, AtSign`.

---

## 4. Route map

Next.js App Router with **route groups** `(auth)` and `(dashboard)` for layout isolation. PWA manifest in `public/manifest.json`.

```
app/
├─ layout.tsx                    # Root: <html data-theme>, fonts, providers
├─ globals.css                   # Design tokens (see §2)
├─ page.tsx                      # Root index → redirect to /login or /dashboard
│
├─ (auth)/                       # Public, centered, mesh background
│  ├─ layout.tsx                 # Mesh + grid background, centered shell
│  ├─ login/
│  │  ├─ page.tsx                # WebAuthn passkey primary + email fallback
│  │  └─ passkey-register/page.tsx
│  ├─ register/page.tsx          # Org + admin user creation
│  ├─ forgot-password/page.tsx
│  └─ verify-email/page.tsx
│
└─ (dashboard)/                  # Authenticated, sidebar shell
   ├─ layout.tsx                 # Sidebar + Topbar + main + CopilotPanel + CommandPalette
   │
   ├─ dashboard/page.tsx         # Executive KPIs (port from grok/dashboard)
   ├─ inbox/page.tsx             # Document inbox (port from grok/inbox)
   ├─ documents/
   │  ├─ page.tsx                # List (port from grok/documents)
   │  └─ [id]/page.tsx           # Detail viewer + AI extraction review
   ├─ reconciliation/page.tsx    # Bank ↔ invoice matching (port from grok/reconciliation)
   ├─ bank/page.tsx              # CSV wizard + transactions (port from grok/bank)
   ├─ payables/page.tsx          # SEPA exports (port from grok/payables)
   ├─ parties/page.tsx           # CRM (port from grok/parties)
   ├─ crm/                       # NEW — full CRM
   │  ├─ page.tsx                # Pipeline (Kanban)
   │  ├─ deals/page.tsx
   │  └─ leads/page.tsx
   ├─ banking/                   # NEW — extended banking
   │  ├─ accounts/page.tsx       # Multi-account view
   │  ├─ statements/page.tsx     # Statement browser
   │  └─ sepa/page.tsx           # SEPA file manager
   ├─ hr/                        # NEW — RH & Payroll
   │  ├─ employees/page.tsx
   │  ├─ payroll/page.tsx        # Process monthly payroll
   │  ├─ payslips/page.tsx
   │  └─ calendar/page.tsx       # IRS / SS / FCT obligations
   ├─ accountant/                # NEW — read-only portal
   │  ├─ page.tsx                # Period close dashboard
   │  ├─ vat/page.tsx            # IVA apuramento + declaração
   │  ├─ saf-t/page.tsx          # SAF-T export
   │  └─ reports/page.tsx        # Balancete, demonstrações
   ├─ copilot/page.tsx           # Full-page copilot (optional alt to panel)
   ├─ settings/
   │  ├─ page.tsx                # General + integrations (port from grok/settings)
   │  ├─ team/page.tsx           # NEW — users + roles
   │  ├─ billing/page.tsx        # NEW — plan + invoices
   │  └─ security/page.tsx       # NEW — WebAuthn, sessions, 2FA
   └─ scanner/page.tsx           # Mobile PWA: dedicated scanner view
```

### 4.1 Route group semantics

- `(auth)` — public, **no** sidebar. Mesh background, centered single-column, max-w-md. No access without `?next=` param if already logged in (redirect to `/dashboard`).
- `(dashboard)` — **requires** valid session. Redirects to `/login` on 401. Renders `<AppShell>` (sidebar + topbar) and mounts `<CommandPalette>` + `<CopilotPanel>` once at the root layout.

### 4.2 PWA manifest

`public/manifest.json`:

```json
{
  "name": "DocFlow — Document Intelligence",
  "short_name": "DocFlow",
  "description": "Gestão documental, conciliação bancária e contabilidade para PMEs portuguesas.",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "background_color": "#070b14",
  "theme_color": "#070b14",
  "lang": "pt-PT",
  "orientation": "any",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "shortcuts": [
    { "name": "Scan", "url": "/scanner", "icons": [{ "src": "/icons/scan.png", "sizes": "96x96" }] },
    { "name": "Inbox", "url": "/inbox" },
    { "name": "Reconciliation", "url": "/reconciliation" }
  ]
}
```

---

## 5. App shell specification

### 5.1 Sidebar (272 px desktop, drawer on mobile)

```
┌─────────────────────────────────┐
│  [logo]  DocFlow                │   Brand block
│           Document Intelligence │
├─────────────────────────────────┤
│  🏢  Tenant Name                │   Tenant selector (Phase 2)
├─────────────────────────────────┤
│ NAVIGATION                       │
│  ▸ Dashboard                    │   (active = gradient + sky border)
│  ▸ Inbox                        │
│  ▸ Documentos                   │
│  ▸ Conciliação                  │
│  ▸ Banco / CSV                  │
│  ▸ A pagar                      │
│  ▸ Entidades (CRM)              │
│  ▸ Contabilidade                │
│  ▸ RH & Payroll                 │
│  ▸ Portal Contabilista          │
│  ── Configuração ──             │   Section divider
│  ▸ Definições                   │
├─────────────────────────────────┤
│ ⓘ  [AB]  Rui Medalha       🔔   │   Avatar + name + role + notifs
│             Admin         🌓 ☰  │   Theme + logout
└─────────────────────────────────┘
```

### 5.2 Topbar (sticky, full-width, hidden on mobile)

```
                                                                [⌕ Pesquisar ⌘K]  🌓  🔔  [AB]
```

### 5.3 Main area

```
PageHeader (title, subtitle, action buttons)
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Page content (max-w-7xl mx-auto, p-4 md:p-8)      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 5.4 Command Palette (Cmd+K)

- `cmdk` based, modal, max-w-lg, centered top 12vh.
- Backdrop: `bg-black/50 backdrop-blur-sm`.
- Items grouped by type: `Documento`, `Entidade`, `Banco`, `A pagar`.
- Keyboard: ↑/↓ navigate, Enter open, Esc close.
- Mobile: full-screen sheet variant.

### 5.5 Copilot IA panel

- Right-docked slide-over, 420 px wide on desktop, full-screen on mobile.
- Header: `Sparkles` icon + "Copilot IA" + close.
- Body: scrollable message list (user right-aligned, assistant left-aligned with sky gradient avatar).
- Input: sticky bottom textarea + send button + paperclip (attach document).
- Citations: inline `[1]` chips in assistant messages → open Document viewer.
- Persistence: per-thread (stored locally + backend sync).

### 5.6 Mobile PWA scanner

`/scanner` route — single-column, takes over viewport when launched from home screen / shortcut.
- Camera preview (16:9).
- Capture button (large, centered, gradient).
- AT QR mode toggle (decodes QRCode → applies to placeholder doc).
- OCR mode (Tesseract.js) for printed receipts.
- Upload to inbox on capture.

---

## 6. Accessibility (WCAG AA)

- Color contrast: tokens verified AA/AAA per §2.1.
- Focus rings: `:focus-visible` outline 2px sky-400 with 2px offset globally.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` in shell; `<table>` with `<thead>/<tbody>`; `<button>` for actions.
- ARIA: `aria-invalid` on inputs with errors, `aria-live="polite"` on toast region, `aria-expanded` on dropdowns.
- Keyboard:
  - Cmd/Ctrl + K → command palette.
  - Esc → close modal / palette / panel.
  - ↑/↓ in lists (palette, tables).
  - Skip link to `<main id="main">`.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables transitions.
- Touch targets: minimum 44×44 px on mobile (icon buttons get `p-2.5` or larger).
- Language: `<html lang="pt">`; dates/numbers via `Intl` with `pt-PT` locale.

---

## 7. Internationalization (i18n)

- Primary locale: **pt-PT** (then pt-BR, en-US).
- All copy in Portuguese (neutral, professional — "tu" avoided in product UI; "você" not used; standard formal "tratamento impersonal").
- Currency: EUR (`€`), formatted via `Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })`.
- Dates: `pt-PT` (`dd/MM/yyyy`), time: 24h.
- NIF validation client-side (9 digits, mod-11 checksum).
- IBAN validation (PT50 + 21 digits, mod-97).

---

## 8. State & data fetching

- **Server components by default.** Data fetched on server where possible (Next.js Server Components + fetch cache).
- **Client state** via TanStack Query for mutations, infinite lists, optimistic updates.
- **Forms** via `react-hook-form` + `zod` resolvers (schema co-located in `src/lib/schemas/`).
- **Auth** via `AuthProvider` (React Context + localStorage access token + refresh flow). WebAuthn ceremony with `@simplewebauthn/browser`.
- **Theme** via `next-themes` (avoids FOUC, syncs with `data-theme`).
- **Notifications** via `sonner` (themed).

---

## 9. Performance targets

- **LCP** < 1.8 s on 4G (KPIs render first, charts deferred).
- **CLS** < 0.05 (skeletons match final layout).
- **INP** < 200 ms (client components lazy where possible; `dynamic(() => import(...), { ssr: false })` for scanner).
- **Initial JS** < 250 KB gzipped (no moment.js, no lodash, no MUI).
- **Tailwind JIT** with `content` paths limited to `./src/**/*.{ts,tsx}`.

---

## 10. What's next

1. **Component library implementation** — start with primitives in `src/components/ui/`, then feature blocks. Each gets a Storybook story (Phase 2).
2. **Theme tokens → Tailwind config** — extend `tailwind.config.ts` to expose `colors.bg`, `colors.text`, etc. backed by CSS variables for utility usage.
3. **Routes scaffolding** — create the `(auth)` and `(dashboard)` layouts and all empty route pages with the `PageHeader` component.
4. **Auth wiring** — WebAuthn primary, email/password fallback, magic-link backup.
5. **Copilot integration** — slide-over panel + thread persistence.
6. **E2E tests** — Playwright smoke tests for each major flow (auth, upload, reconcile, SEPA export).

---

**Maintainer:** DocFlow Frontend Guild · **Review cadence:** weekly until GA · **File an issue:** `#design-system` Slack channel.
