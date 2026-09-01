# DocFlow — Gestão documental + fiscal PT com IA

Sistema de gestão documental para PMEs portuguesas, com leitura por IA (Gemini 2.5-flash via OpenRouter), parser determinístico do QR-AT, OCR, conciliação bancária, SEPA, e arquivo automático por categoria/fornecedor.

> **Branch atual:** `base` — versão estável (leitura com IA, QR, aprovação, linhas, fornecedor, naming).
> **Próxima branch:** `features/calendar-categorias-edicao` — calendário de pagamentos, categorias editáveis, edição de produtos, funcionalidades Dori pendentes.

---

## Estado atual (branch `base`)

Funcionalidades **verificadas ao vivo**:

- Leitura de faturas (PDF, foto, scan) com IA
  - Provider principal: Gemini 2.5-flash via OpenRouter (`MiniMax-M3` na config)
  - QR-AT lido deterministicamente (ZXing + jsqr + 3 escalas × 3 rotações)
  - Fila serial in-process (uploads concorrentes não se perdem)
  - Orientação EXIF corrigida (fotos upright)
  - Montantes reconciliam (total = net + IVA); IVA discriminado por taxa; estrangeiros (IVA=0); descontos
  - Descontos de linha + global
  - Moeda multi-país
  - Linhas de produtos (lineItems)
  - Fornecedor auto-criado/ligado por NIF; "comprador vs fornecedor" resolvido pelo teu próprio NIF
  - **Nome semântico** nos ficheiros (ex.: `AMERICO-ALVES-COMERCIO-INTERNACIONAL-SA_2026-07-31_FT-2026A76-1751.pdf`)
  - Imagem guardada como PDF
  - Auditoria hash-chained (AuditService)
  - Reconciliação dinheiro (P-02, C-09): rejeita datas/valores absurdos; deriva de ivaBreakdown

- Frontend (Next.js 15)
  - Login com refresh automático de token (401 → refresh → retry)
  - Inbox, detalhe de documento, edição de campos, guardar
  - Aprovação (botão + estado + toast + re-fetch otimista)
  - Linhas de produtos (tabela com totais)
  - Ficha de fornecedor (link + página)
  - Acessível via túnel Cloudflare (web + API proxy same-origin)

- Backend (NestJS 11 + Prisma 6)
  - Multi-tenant com Prisma extension (scoping automático)
  - JWT + roles + guard de tenant
  - 8 endpoints de documentos, 2 de extração, e os de parties/banking/reconciliation/etc.
  - Migrations Prisma aplicadas
  - Seed (admin@demo.pt, tenant demo, fornecedores PT, contas SNC, regras de pasta)

- Testes
  - **221+ testes Jest** verdes (extraction, AI, documents, parties, etc.)
  - API estável em :4000, Web em :3000, túnel Cloudflare (`trycloudflare.com`)

---

## Stack

- **Backend:** NestJS 11, Prisma 6, PostgreSQL 17
- **Frontend:** Next.js 15 (App Router), React 19, TanStack Query, Tailwind, shadcn-style
- **IA/Visão:** OpenRouter (Gemini 2.5-flash), config {URL, token, model} por provider (gateway)
- **Shared:** `packages/shared` com fiscal utils PT (parseAtQr, NIF, IBAN, IVA, QR-AT)

---

## Como correr (local)

```bash
# 1. DB local
docker run -d -p 5432:5432 -e POSTGRES_USER=docflow -e POSTGRES_PASSWORD=docflow -e POSTGRES_DB=docflow_dev postgres:16-alpine
# 2. Backend
cd apps/api
pnpm install
cp .env.example .env        # preenche GEMINI_API_KEY ou OPENROUTER_API_KEY
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm start:dev               # http://localhost:4000
# 3. Frontend
cd apps/web
pnpm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1" > .env.local
pnpm dev                     # http://localhost:3000

# 4. Túnel público (para aceder do telemóvel)
cloudflared tunnel --url http://localhost:3000
```

### Credenciais demo (seed)
- Email: `admin@demo.pt`
- Password: `Admin123!`
- Tenant: `demo`

---

## Variáveis de ambiente (backend, apps/api/.env)

```env
# IA visão (OpenRouter — provider principal)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_VISION_MODEL=google/gemini-2.5-flash

# Ou Gemini direto (alternativa, se quota disponível)
# GEMINI_API_KEY=...
# GEMINI_VISION_MODEL=gemini-3.6-flash

# MiniMax (modelo OpenRouter alternativo testado — opcional)
# MINIMAX_API_KEY=...
# MINIMAX_URL=https://api.minimax.io/v1/chat/completions
# MINIMAX_VISION_MODEL=MiniMax-M3

# DB
DATABASE_URL=postgresql://docflow:docflow@localhost:5432/docflow_dev?schema=public
NODE_ENV=development
```

---

## Estrutura

```
docflow-mvp/
├── apps/
│   ├── api/                       # NestJS 11 + Prisma 6
│   │   └── src/modules/
│   │       ├── auth/              # JWT, refresh, 2FA stub
│   │       ├── documents/         # upload, detail, approve, items
│   │       ├── extraction/        # pdf-parse, regex, QR (ZXing+jsqr), vision
│   │       ├── ai/                # VisionService (gateway providers)
│   │       ├── parties/           # fornecedores
│   │       ├── banking/           # CSV/CAMT.053
│   │       ├── reconciliation/    # matching 3-tier
│   │       ├── payments/          # SEPA, payables
│   │       └── ...
│   └── web/                       # Next.js 15
│       └── app/(dashboard)/
│           ├── documents/         # inbox, detail
│           ├── parties/           # supplier sheet
│           └── ...
├── packages/
│   └── shared/                    # fiscal utils PT
│       └── src/portuguese/
│           ├── qr-at.util.ts      # parseAtQr (A:...*B:...)
│           ├── nif.util.ts
│           └── iban.util.ts
├── docs/                          # arquiteturas, análises, fluxo
│   ├── FOREIGN_INVOICE_FLOW.md
│   ├── QR_AT_PHOTO_READING.md
│   ├── REF_ANALYSIS_*.md          # 3 modelos diferentes
│   └── PRIORIDADES_6_MELHORIAS.md
└── README.md
```

---

## Próxima branch (a desenvolver)

- `features/calendar-categorias-edicao`:
  - Calendário de pagamentos
  - Categorias de despesa editáveis (refeições, combustível, etc.) com regras de dedutibilidade IVA
  - Edição de produtos (lineItems editáveis)
  - Pesquisa full-text nos documentos
  - Outras features Dori Finance que ficaram em `REF_ANALYSIS_*.md`

---

## Notas técnicas

- A leitura de IA **demora ~20-30s** por foto (Gemini vision). É normal — espera antes de consultar o documento.
- A fila serial processa um doc de cada vez (uploads concorrentes não se perdem).
- Os totais **sempre reconciliam** (`total = net + IVA`); se vês null, é porque a extração está a correr ou falhou (precisas de re-tentar ou ver o needs_review).

---

## Licença / Estado

Em desenvolvimento ativo. O utilizador (Rui) está a testar o sistema com faturas reais.
