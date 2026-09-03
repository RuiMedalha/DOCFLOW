# DocFlow — STATUS (2026-09-02)

Estado real do projeto, sem promessas vazias.

## O que está implementado e verificado

### Leitura de faturas (backend + frontend)

| Capacidade | Status | Verificação |
|-----------|--------|-------------|
| PDF digital | ✅ | testado ao vivo |
| Foto (JPEG) | ✅ | testado com fotos reais do `uploads/` |
| Scan | ⚠️ backend pronto, **não testado** |
| OCR Tesseract | ✅ instalado | só ativo se não houver vision |
| Vision IA **Opus 5 (principal)** | ✅ | confirmado ao vivo: `provider: minimax/Opus 5, confidence: 0.92` |
| Vision IA Gemini (fallback) | ✅ | código lê `GEMINI_API_KEY` |
| Fila serial in-process | ✅ | 4/4 corridas consistentes |
| ZXing + jsQR fallback para QR | ✅ | instalado; robusto em fotos reais com pré-processamento |

### QR-AT

| | Status |
|---|---|
| Decoder ZXing (cascade) | ✅ commitado |
| Parser determinístico (`A:...*B:...`) | ✅ |
| Leitura visual do QR pelo Opus 5 (para fotos) | ✅ — Gemini e Opus 5 leem o QR como imagem quando o ZXing falha |

### Fluxos backend

| Endpoint | Status |
|----------|--------|
| `GET /documents` (lista + paginação + full-text) | ✅ |
| `GET /documents/:id` (detalhe + line items + categorias) | ✅ (mas categorias **não renderizadas** no FieldPanel) |
| `POST /documents/upload` (multipart, foto/PDF) | ✅ |
| `POST /documents/:id/approve` (com RBAC + audit) | ✅ testado |
| `PATCH /documents/:id/items/:itemId` (edição de linhas) | ✅ testado |
| `POST /documents/:id/items` / `DELETE .../items/:itemId` | ✅ testado |
| `GET /payments/calendar?from&to` | ✅ testado |
| `POST /payments/events/:id/pay` | ✅ |
| `GET /categories` (CRUD, ADMIN-only mutations) | ✅ testado com 9 categorias PT seedadas |
| `POST/PATCH/DELETE /categories` (ADMIN) | ✅ testado |

### Frontend (apps/web — Next.js)

| Página | Status |
|--------|--------|
| `/login` + `/2fa` | ✅ |
| `/dashboard` | ✅ |
| `/documents` (inbox + filtros) | ✅ |
| `/documents/[id]` (detalhe + edição de linhas + campos editáveis) | ✅ corrigido neste turno (party-form + field-panel) |
| `/payments/calendar` | ✅ |
| `/categories` (CRUD + ADMIN gating) | ✅ commitado pelo pane-234 |
| `/parties` (lista) | ⚠️ erro de runtime no edit (`seedAccounts.map` → corrigido neste turno) |
| `/parties/[id]` (ficha de fornecedor) | ⚠️ existe mas sem UI de histórico de faturas |

## O que foi decidido e nunca foi implementado

| Item | Estado |
|------|--------|
| **Opus 5 como provider principal** | ✅ agora ativo (este turno) |
| **Gemini como fallback** | ✅ configurado |
| Categorias de despesa com IVA dedutibilidade | ✅ (modelo + seed de 9 PT + UI) |
| Faturas ocasionais vão para `/Despesas/{Cat}/{Y}/{M}/` | ❌ só a regra está, sem UI/validação |
| Faturas recorrentes vão para `/Fornecedores/{Name}/` | ⚠️ regra existe, sem UI explícita para gerir `isRecurring` |
| Auto-criação de fornecedor sem aprovação | ⚠️ só com confiança ≥ 0.8 + NIF válido |
| Fluxo de aprovação UI | ⚠️ backend OK, falta UI confirmar |
| **Categorias: wire no Document** | ✅ `expenseCategoryId`+`ivaDeductibilityPct` no Document; wire no folder-rules engine; teste valida o fluxo |
| **Categorias: mostrar no detalhe do doc** | ❌ field-panel.tsx **não renderiza** a categoria (zero matches em `field-panel.tsx` para `expenseCategory`/`category`/`ivaDeductibility`) |
| **Aplicação automática da categoria** | ⚠️ logic no extraction.service.ts:736-765 chama `rulesEngine.suggest(...)` quando `fields.suggestedCategory` existe e source=ai/at_qr+ai. Test (753-758) cobre. **Não vejo wiring explícito no approve flow (POST /:id/approve) que persista `expenseCategoryId`** — pode estar a persistir folder mas não a categoria.

## O que NÃO foi decidido

| Pergunta em aberto |
|--------------------|
| Categorias editáveis (ADMIN pode criar/editar/apagar — sim, mas as 9 PT são hard-coded na seed; sem decisão sobre se o admin pode inventar) |
| Critério exato para "recorrente vs ocasional" (threshold de N faturas? flag manual?) |
| Política de retenção/auto-delete de ficheiros temporários |
| Auto-aprovação vs revisão manual (configurável por tenant?) |

## Outros projetos analisados (inspiração apenas — não copiados para o código)

### `gemini-documental`
- ✅ **Lido** (`docs/REFERENCE_QR_APPROACH.md`) — referência de como ler QR + provider
- ✅ **Lido** (`docs/EXTRACTION_REFERENCE_ANALYSIS.md`) — análise comparativa
- ❌ **Não** copiado para o código

### `grok-documental`
- ✅ Lido — referência para o parser QR-AT determinístico (fonte do `parseAtQr`)
- ❌ Não copiado para UI/fluxos

### `deep-seek-documental`
- ✅ Lido — referência arquitetural (multi-provider registry)
- ❌ Não copiado

### `Dori Finance` (dorifinance.com)
- ✅ Pesquisado via WebFetch
- ✅ Inspiração: categorias de despesa com IVA dedutibilidade, ficha de fornecedor com histórico
- ❌ **Não** copiamos UI nem fluxos

### Screenshots do programa português (`.overclock-app/dropped/WhatsApp Image 2026-09-01 at 14.40.24-28*.jpeg`)
- ✅ Algumas imagens lidas pelos panes de análise (204, 225, etc.)
- ⚠️ Análise não consolidada (panes pararam ou stalled antes de fechar relatório final)

## Branches e estado GitHub

| Branch | Estado |
|--------|--------|
| **`main` local + remote** | ✅ pushed com 9 commits (último `8ed2d9e` — STATUS.md) |
| **`features/calendar-categorias-edicao` local + remote** | ✅ synced com main (9 commits) |

## Tunnel ativo no fim da sessão

| URL | Estado |
|-----|--------|
| `https://prisoner-visiting-identical-costume.trycloudflare.com` | ✅ ativo (Cloudflare quick tunnel, PID 5569). Serve o nosso app: `<title>DocFlow — Document Intelligence</title>` confirmado. Login + API a 200 via tunnel. |
| `https://due-garage-suffered-william.trycloudflare.com` (anterior) | ❌ morto |
| `https://t9llf2eoye1r0x9xtg8tpr92.167.86.111.8.sslip.io` | ❌ outro projeto — NÃO usar |

Se o tunnel novo morrer, reiniciar com:
```
./cloudflared.exe tunnel --url http://localhost:3000
```
E adicionar o URL novo em `apps/api/.env` (`CORS_ORIGINS=...`).

## Erros conhecidos</old_string>

## Erros conhecidos

| Erro | Onde | Workaround atual |
|------|------|-------------------|
| `seedAccounts.map is not a function` (parties form) | `/parties/[id]` edit | ✅ corrigido neste turno (commit `4af3038`) |
| `Each child in a list should have a unique key prop` (field-panel) | `/documents/[id]` (account selects) | ✅ corrigido |
| "localhost sem design" (ecrã vazio no telemóvel) | — | ✅ resolvido re-arrancando Next dev |
| Erros `seedAccounts` noutros hooks (provavelmente também existiam) | vários | ⚠️ pode haver mais — não auditados |

## O que falta implementar (prioridade)

1. **Auditar todos os `unwrap<ArrayType>`** no frontend para evitar mais erros de runtime (já corrigi os do `use-parties`)
2. **Testar o frontend** no browser para confirmar as 4 features (categorias, calendar, line items edit, full-text)
3. **Página de fornecedor** com lista de faturas + produtos
4. **Atualizar `main`** para apontar para o estado final (merge de `features/...`)
5. **Push final** com a documentação
6. **Análise comparativa consolidada** com Dori + sas português (parou a meio)

## Como correr localmente

```bash
# Backend
cd apps/api
$env:DATABASE_URL="postgresql://docflow:docflow@localhost:5432/docflow_dev?schema=public"
$env:NODE_ENV="development"
node dist/src/main.js
# → http://localhost:4000

# Frontend
cd apps/web
$env:NEXT_PUBLIC_API_URL="http://localhost:4000/api/v1"
npx next dev -p 3000 -H 0.0.0.0
# → http://localhost:3000 (tunnel: https://prisoner-visiting-identical-costume.trycloudflare.com)
```

Login: `admin@demo.pt` / `Admin123!` / `demo`

### `apps/api/.env` (estado no fim da sessão — para referência)

```env
GEMINI_API_KEY=AQ.Ab8RN***        # Gemini direto (last-resort fallback — quota pode estar esgotada)
GEMINI_VISION_MODEL=gemini-3.6-flash
OPENROUTER_API_KEY=sk-or-v1***    # OpenRouter (fallback — funciona mas às vezes trunca)
OPENROUTER_VISION_MODEL=google/gemini-2.5-flash
MINIMAX_API_KEY=sk-cp-2a***      # Opus 5 (PRIMARY — confirmado ao vivo, confidence 0.92)
MINIMAX_URL=https://api.minimax.io/v1/chat/completions
MINIMAX_VISION_MODEL=MiniMax-M3

DATABASE_URL=postgresql://docflow:docflow@localhost:5432/docflow_dev?schema=public
NODE_ENV=development
CORS_ORIGINS="http://localhost:3000,http://192.168.1.190:3000,https://prisoner-visiting-identical-costume.trycloudflare.com"
```
