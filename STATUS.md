# DocFlow — STATUS

Reescrito do zero na **Fase 0 (2026-09-11)**. Tudo o que está aqui foi verificado por testes, build, API do Coolify ou SSH ao VPS nessa data. Documentação em `docs/*` anterior a esta data está desatualizada — o código e os testes são a verdade.

Missão em curso: Bloco A (Fases 0–7) do prompt mestre. Cliente: HotelEquip / Nov Ousado Unipessoal Lda (NIF 515208566).

---

## Funciona (verificado 2026-09-11)

### Produção (Coolify, projeto `documentsfill`, ambiente `production`, VPS 167.86.111.8)

| Item | Estado |
|------|--------|
| App Coolify `docflow-production` (uuid `d20uxq2vlknrluxbbcqaw0tt`) | build pack **docker-compose** a partir de `RuiMedalha/DOCFLOW` branch **`main`**, `docker-compose.yml` na raiz |
| Commit em produção | `8e4f4da` (= `main` HEAD local). Deploy feito 2026-09-11 01:26 UTC |
| Containers | `api`, `web`, `postgres:17-alpine`, `redis:7-alpine` — todos `healthy` |
| API | `https://r122tccopibb6pov1fmrau9v.167.86.111.8.sslip.io/api/v1/health` → 200 `{db:up}`; `/health/full` → `{db:up, redis:up}` |
| Web | `https://dt8htz3dc2cxv7pz2au7l1tm.167.86.111.8.sslip.io/` → 307 para `/login` (200) |
| Migrations | `entrypoint.sh` corre `prisma migrate deploy` no arranque (14 migrations, última `20260908002000_add_accountant_role`) |
| Volumes | `docflow-pgdata`, `docflow-redisdata`, `docflow-uploads` (3 ficheiros, 1,1 MB) |
| DB de produção | 1 tenant (`demo` = NOV OUSADO UNIPESSOAL LDA), 1 user (`admin@demo.pt` ADMIN), 3 documentos (todos `EM_REVISAO`), 3 parties |
| Storage | driver **local** (`/repo/apps/api/uploads`) — sem MinIO/S3 ainda |
| Postgres/Redis | não publicados no host (só rede interna) ✅ |
| docker.sock | nenhum container DocFlow o monta ✅ (só coolify-sentinel, coolify-proxy, supabase-vector) |
| Dockerfiles | `USER docflow` (uid 10001, não-root) em api e web ✅; healthcheck interno ✅ |
| Logs api (últimas 200 linhas) | sem erros; só mapeamento de rotas + healthchecks |
| Disco VPS | 81G/194G usados (42 %) |

### Código local (`main` = `8e4f4da`)

| Item | Resultado |
|------|-----------|
| `apps/api` `pnpm test` | **1115 verdes / 1118** (102 suites, 100 verdes) — ver "Não funciona" |
| `apps/api` `pnpm build` | ✅ verde |
| `apps/web` `next build` | ✅ compila + typecheck + 43 páginas. Só o passo `standalone` (cópia de symlinks) falha **no Windows local** por EPERM — no Docker (Linux) funciona, prova é a produção |
| Node / pnpm locais | Node 24.12.0; pnpm 10 (o `pnpm build` da web falha localmente por `ERR_PNPM_IGNORED_BUILDS sharp` — usar `npx next build`; não afeta Docker que usa `--ignore-scripts`) |
| Estrutura | **Não é workspace pnpm**: `apps/api` e `apps/web` têm `package.json` + `pnpm-lock.yaml` próprios; `packages/shared` ligado por `file:../../packages/shared` |

### Funcionalidades existentes (por código + testes; smoke em produção fica para a Fase 1)

- Upload multipart (PDF/JPEG/PNG), hash SHA-256 com `@@unique([tenantId, fileHash])`, PDF derivado de fotos.
- Pipeline assíncrono `RECEIVED → EXTRACTING → ENRICHING → ROUTING → COMPLETED` com SSE (`/documents/:id/processing/stream`).
- QR-AT: decoder ZXing cascade + jsQR fallback + parser determinístico (`packages/shared/src/portuguese/qr-at.util.ts`).
- Vision IA: `VisionService` suporta Anthropic, Gemini (`GOOGLE_API_KEY`/`GEMINI_API_KEY`), OpenRouter, MiniMax; URLs configuráveis (`OPENROUTER_URL`, `MINIMAX_URL`).
- Fornecedores (`Party`) com resolução por NIF, enriquecimento, categorias por fornecedor (`party-categories`), regras de pastas.
- Categorias de despesa (9 PT seedadas, `ivaDeductibilityPct`).
- Aprovação com workflow (`PENDING_APPROVAL`/`CHANGES_REQUESTED`), RBAC, auditoria hash-chained.
- Calendário de pagamentos (`PaymentEvent`, `PaymentSchedule`, SEPA export).
- Conciliação bancária (módulo `banking` + `reconciliation`, wizard CSV).
- Módulos extra fora do âmbito do MVP: `crm`, `fleet`, `payroll`, `accounting`, `saft-export`, `tax-simulator`.
- `StorageService` interface pronta para S3 (`storage-service.interface.ts`); só existe `LocalFilesystemStorage`. `STORAGE_DRIVER` **não é lido** por código nenhum (só comentários).
- Health: `/health` (DB) e `/health/full` (DB + Redis). **Não verifica storage.**
- Segurança: helmet, CORS por `CORS_ORIGINS`, trust proxy, validação global. **Throttler desativado** (commit `38699a3`) — sem rate limiting em produção.

---

## Não funciona / dívida encontrada

| # | Problema | Onde | Fase que resolve |
|---|----------|------|------------------|
| 1 | 3 testes falham: `inbound.security.spec.ts` (assinatura ECDSA SendGrid válida rejeitada) e 2× `approve-folder-routing-flow.spec.ts` (esperam o caminho antigo `…/2026-09/ft-…pdf`, o código produz `…/2026/FT_…pdf` — teste desatualizado face ao `filename-standardizer`) | `apps/api` | Fase 1 (corrigir/atualizar testes antes do primeiro commit com código) |
| 2 | `GEMINI_API_KEY` **não existe** nas env vars do Coolify (só `OPENROUTER_API_KEY`) e o `docker-compose.yml` nem a passa ao container `api`. O prompt mestre diz que já está — **não está**. Produção usa OpenRouter com `google/gemini-2.5-flash` | Coolify + compose | Bloqueio → ver secção abaixo |
| 3 | Produção corre a partir de `docker-compose.yml` (Postgres + Redis dentro do compose). A DB `docflow-db` (postgres:18) e o Redis do ambiente 5 do Coolify estão `exited:unhealthy` — restos não usados | Coolify | Fase 7 (limpeza, com confirmação do Rui) |
| 4 | `pnpm audit --audit-level=high`: **api** 13 high + 1 critical (ex.: `multer <2.3.0` DoS via `@nestjs/platform-express`); **web** 14 high + 4 critical (`next 15.1.0` → `postcss`, `sharp`, etc.). Next.js 15.1.0 está muito atrás dos patches | ambos | Fase 1 (regra 10: audit limpo antes do deploy) |
| 5 | Rate limiting desligado (`ThrottlerModule` comentado em `app.module.ts`) por causa de 429s | api | Fase 7 (reativar com limites sensatos + `SkipThrottle` nas rotas de listagem) |
| 6 | **92 ficheiros-lixo commitados** na raiz de `apps/api` e `apps/web` (fragmentos de shell como `apps/api/'`, `apps/api/(k`, `apps/api/d.id)`, logs `api-debug.log.err`, `apps/web/.playwright-mcp/*`, `.overclock-app/messages.db`) | repo | Fase 7 (limpeza; não afeta build) |
| 7 | `apps/web/pnpm-workspace.yaml` foi criado automaticamente pelo pnpm 10 local durante a Fase 0 — apagado, não commitado | local | — |
| 8 | Portas do `api` (32771) e `web` (32772) são publicadas no host pelo Coolify (compose `ports: - '4000'`). Firewall bloqueia de fora (testado: timeout), mas o ideal é `expose` em vez de `ports` | compose | Fase 1 |
| 9 | Seed de demo (`admin@demo.pt` / tenant `demo`) é o único utilizador em produção | prod | Fase 7 |
| 10 | Sem backups de Postgres nem de uploads | VPS | Fase 7 |
| 11 | Sem campo `fiscalStatus`; `DocumentType` não tem PROFORMA/ORCAMENTO/AVISO/EXTRATO/FATURA_SIMPLIFICADA; dedup só por hash (há índice `[tenantId, atcud]` mas não único) | schema | Fase 3 |
| 12 | `Party` sem `vatNumber/vatRegime/currency/paymentTermsDays/directDebit/viesValidatedAt…` | schema | Fase 4 |
| 13 | HEIC não é aceite (sem `sharp`/`heic-convert` na api) | api | Fase 2 |

---

## Branches locais (inventário — nada foi feito merge)

`main` local = `origin/main` = `8e4f4da`. O `origin/HEAD` aponta para `features/calendar-categorias-edicao`, mas o Coolify faz deploy de **`main`**.

| Branch | Commits que `main` não tem | Conteúdo |
|--------|---------------------------|----------|
| `feat/auto-process-pipeline` | **3** (`c66dbf0`, `9adaec3`, `d069589`), 57 atrás de main | `DocumentProcessingStatus` enum + 4 campos; storage driver factory + queue abstraction + pipeline 4 estágios + SSE; frontend SSE consumer + toggle auto-approve. **Nota:** o enum e o pipeline SSE já existem em `main` (migration `20260905111132_add_processing_status`, `ProcessingController`) — provavelmente foi reimplementado; o que pode faltar em `main` é a *storage driver factory* (`STORAGE_DRIVER`). A rever na Fase 1 antes de escrever o `S3Storage` |
| `feat/inbox-multicanal` | 0 (66 atrás) | totalmente contida em `main` |
| `feat/party-360` | 0 (59 atrás) | contida |
| `feat/party-categories-and-folder-routing` | 0 (70 atrás) | contida |
| `feat/party-enrichment` | 0 (55 atrás) | contida |
| `features/calendar-categorias-edicao` (local) | 0 (31 atrás) | contida |
| `fix/categories-and-party-page` | 0 (84 atrás) | contida |
| `fix/recurring-toggle-admin` | 0 (81 atrás) | contida |
| `origin/features/calendar-categorias-edicao` (remoto) | **3** (`1c4e37f` merge de main, `2c5d300` "Configure PNPM environment in Dockerfile", `ce5216a` "Update Dockerfile") | só alterações ao Dockerfile feitas no GitHub; `main` já tem Dockerfiles a funcionar em produção. Não fazer merge sem rever |

Branches com 0 commits à frente podem ser apagadas com segurança — **aguarda OK do Rui**.

---

## Bloqueios (preciso do Rui)

1. **`GEMINI_API_KEY` no Coolify.** O prompt diz que existe; a API do Coolify mostra que não. Para a Fase 2 (Gemini como provider principal) preciso que a chave seja adicionada à app `docflow-production` no Coolify (Environment Variables → `GEMINI_API_KEY`). Vou preparar o `docker-compose.yml` para a passar ao container `api` na Fase 1. Entretanto a extração continua a funcionar via OpenRouter (`google/gemini-2.5-flash`).
2. Nenhum outro bloqueio para as Fases 1–3.

---

## Ambiente e acessos confirmados

- `ssh vps` → root@167.86.111.8 ✅
- `.coolify.env` na raiz (git-ignored ✅) com `COOLIFY_URL=https://painel.profihotel.pt` e token ✅ (API responde). Atenção: o token contém `|`, por isso o ficheiro **não pode ser `source`d** — ler com `grep`/`cut`.
- Amostras: 19 ficheiros em `C:\Projetos\docflow-mvp\samples` (17 PDF, 2 JPEG; 10 PDFs são scans sem texto; 5 PDFs nativos com ATCUD). Inventário completo em `docs/SAMPLES_INVENTORY.md`.
- Supabase self-hosted (`hotelequip-optimizer`) no mesmo VPS — **não tocar**.

---

## Histórico de fases

## Fase 0 — Baseline — 2026-09-11
Feito: inventário do repo, branches, testes, builds, audit, Coolify (apps/env/compose), VPS (containers, logs, DB, volumes, docker.sock, disco), amostras (`docs/SAMPLES_INVENTORY.md`), `STATUS.md` reescrito.
Verificado em produção: `/api/v1/health` 200 (db up), `/api/v1/health/full` (db+redis up), web `/login` 200; commit em produção = `main` HEAD.
Testes: 1115 verdes / 1118 total (3 falhas pré-existentes, detalhadas acima). Builds: api ✅, web ✅ (só standalone-symlink falha no Windows).
Falhou / adiado: nada nesta fase.
Bloqueios (preciso do Rui): `GEMINI_API_KEY` não está no Coolify (ver secção Bloqueios).
Próximo: Fase 1 — Storage MinIO + deploy limpo (corrigir os 3 testes, `S3Storage`, MinIO no Coolify, health com storage, audit high/critical, `expose` em vez de `ports`).

---

## Próxima fase

**Fase 1 — Storage MinIO + deploy limpo.** Ordem prevista:
1. Corrigir os 3 testes vermelhos (sem alterar comportamento de produção).
2. Rever `feat/auto-process-pipeline` para reaproveitar a storage driver factory se for melhor que escrever de novo.
3. `S3Storage` (aws-sdk v3, `forcePathStyle`, presigned URLs) + seleção por `STORAGE_DRIVER`.
4. MinIO no Coolify (rede interna, sem console pública) + bucket `docflow` + utilizador de serviço.
5. `scripts/migrate-local-to-s3.ts`; health com storage; env vars; `pnpm audit` limpo; deploy; smoke com 5 amostras.

---

## Como correr localmente

```bash
# API
cd apps/api
pnpm install
pnpm test
pnpm build
node dist/src/main.js          # precisa de DATABASE_URL, REDIS_URL, JWT_* no .env

# Web
cd apps/web
pnpm install
npx next build                 # (pnpm build falha no Windows local por causa do sharp/pnpm 10)
npx next dev -p 3000
```

Login demo: `admin@demo.pt` / `Admin123!` / tenant `demo`.
