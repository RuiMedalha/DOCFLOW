# DocFlow — STATUS

Reescrito do zero na **Fase 0 (2026-09-11)**. Tudo o que está aqui foi verificado por testes, build, API do Coolify ou SSH ao VPS nessa data. Documentação em `docs/*` anterior a esta data está desatualizada — o código e os testes são a verdade.

Missão em curso: Bloco A (Fases 0–7) do prompt mestre. Cliente: HotelEquip / Nov Ousado Unipessoal Lda (NIF 515208566).

---

## Funciona (verificado 2026-09-11)

### Produção (Coolify, projeto `documentsfill`, ambiente `production`, VPS 167.86.111.8)

| Item | Estado |
|------|--------|
| App Coolify `docflow-production` (uuid `d20uxq2vlknrluxbbcqaw0tt`) | build pack **docker-compose** a partir de `RuiMedalha/DOCFLOW` branch **`main`**, `docker-compose.yml` na raiz |
| Commit em produção | `7afa312` (Fase 1). Deploy 2026-09-11 02:06 UTC + restart 02:14 UTC |
| Containers | `api`, `web`, `postgres:17-alpine`, `redis:7-alpine`, `minio` (RELEASE.2025-09-07), `minio-init` (one-shot, exit 0) |
| API | `https://r122tccopibb6pov1fmrau9v.167.86.111.8.sslip.io/api/v1/health` → 200 `{db:up, storage:up, storageDriver:s3}`; `/health/full` → `{db, redis, storage}` |
| Web | `https://dt8htz3dc2cxv7pz2au7l1tm.167.86.111.8.sslip.io/` → 307 para `/login` (200) |
| Migrations | `entrypoint.sh` corre `prisma migrate deploy` no arranque (14 migrations, última `20260908002000_add_accountant_role`) |
| Volumes | `docflow-pgdata`, `docflow-redisdata`, `docflow-uploads` (legado, 3 ficheiros já migrados), `docflow-minio` |
| DB de produção | 1 tenant (`demo` = NOV OUSADO UNIPESSOAL LDA), 1 user (`admin@demo.pt` ADMIN), 3 documentos (todos `EM_REVISAO`), 3 parties |
| Storage | driver **s3** → MinIO interno `http://minio:9000`, bucket `docflow`, utilizador de serviço com policy só para o bucket; presigned URLs via `https://files-docflow.167.86.111.8.sslip.io` (só API S3; console desligada) |
| Postgres/Redis/MinIO | não publicados no host (só rede interna; MinIO só via Traefik com TLS) ✅ |
| docker.sock | nenhum container DocFlow o monta ✅ (só coolify-sentinel, coolify-proxy, supabase-vector) |
| Dockerfiles | `USER docflow` (uid 10001, não-root) em api e web ✅; healthcheck interno ✅ |
| Logs api (últimas 200 linhas) | sem erros; só mapeamento de rotas + healthchecks |
| Disco VPS | 81G/194G usados (42 %) |

### Código local (`main` = `8e4f4da`)

| Item | Resultado |
|------|-----------|
| `apps/api` `pnpm test` | **1139 verdes / 1139** (103 suites) |
| `apps/api` `pnpm build` | ✅ verde |
| `apps/web` `next build` | ✅ compila + typecheck + 43 páginas. Só o passo `standalone` (cópia de symlinks) falha **no Windows local** por EPERM — no Docker (Linux) funciona, prova é a produção |
| Node / pnpm locais | Node 24.12.0; pnpm **11.10.0** (também nos Dockerfiles). Overrides em `apps/*/pnpm-workspace.yaml`. O `pnpm build` da web falha localmente por `ERR_PNPM_IGNORED_BUILDS sharp` — usar `npx next build` |
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
- Storage: `LocalFilesystemStorage` e `S3Storage` (aws-sdk v3) selecionados por `STORAGE_DRIVER`; `/storage/tree` agnóstico do driver. Script `node dist/src/scripts/migrate-local-to-s3.js [--dry-run]` idempotente.
- Health: `/health` (DB + storage) e `/health/full` (DB + Redis + storage).
- Segurança: helmet, CORS por `CORS_ORIGINS`, trust proxy, validação global. `pnpm audit --audit-level=high` **limpo** em api e web (Next 15.5.25, Nest 11.2.3, Prisma 6.19.3, multer 2.3.0). **Throttler desativado** (commit `38699a3`) — sem rate limiting em produção.

---

## Não funciona / dívida encontrada

| # | Problema | Onde | Fase que resolve |
|---|----------|------|------------------|
| 1 | ~~3 testes falham~~ **Resolvido na Fase 1** (`14ebc3a`): verificação ECDSA passou a `crypto.verify` com `ieee-p1363` (o DER manual rejeitava ~75 % das assinaturas válidas); expectativas de folder-routing atualizadas | `apps/api` | ✅ |
| 2 | `GEMINI_API_KEY` existe agora no Coolify mas **vazia** (criada na Fase 1, o compose já a passa ao `api`). Produção continua a usar OpenRouter com `google/gemini-2.5-flash` até o Rui preencher a chave | Coolify | Bloqueio → ver secção abaixo |
| 3 | Produção corre a partir de `docker-compose.yml` (Postgres + Redis dentro do compose). A DB `docflow-db` (postgres:18) e o Redis do ambiente 5 do Coolify estão `exited:unhealthy` — restos não usados | Coolify | Fase 7 (limpeza, com confirmação do Rui) |
| 4 | ~~audit high/critical~~ **Resolvido na Fase 1** (`c95e8ea`): api 0 high/critical (2 moderate restantes), web 0 high/critical (1 low) | ambos | ✅ |
| 5 | Rate limiting desligado (`ThrottlerModule` comentado em `app.module.ts`) por causa de 429s | api | Fase 7 (reativar com limites sensatos + `SkipThrottle` nas rotas de listagem) |
| 6 | **92 ficheiros-lixo commitados** na raiz de `apps/api` e `apps/web` (fragmentos de shell como `apps/api/'`, `apps/api/(k`, `apps/api/d.id)`, logs `api-debug.log.err`, `apps/web/.playwright-mcp/*`, `.overclock-app/messages.db`) | repo | Fase 7 (limpeza; não afeta build) |
| 7 | `apps/web/pnpm-workspace.yaml` foi criado automaticamente pelo pnpm 10 local durante a Fase 0 — apagado, não commitado | local | — |
| 8 | Portas do `api` (32771) e `web` (32772) são publicadas no host pelo Coolify (compose `ports: - '4000'`). Firewall bloqueia de fora (testado: timeout), mas o ideal é `expose` em vez de `ports` | compose | Fase 1 |
| 9 | Seed de demo (`admin@demo.pt` / tenant `demo`) é o único utilizador em produção | prod | Fase 7 |
| 10 | Sem backups de Postgres nem de uploads | VPS | Fase 7 |
| 11 | Sem campo `fiscalStatus`; `DocumentType` não tem PROFORMA/ORCAMENTO/AVISO/EXTRATO/FATURA_SIMPLIFICADA; dedup só por hash (há índice `[tenantId, atcud]` mas não único) | schema | Fase 3 |
| 12 | `Party` sem `vatNumber/vatRegime/currency/paymentTermsDays/directDebit/viesValidatedAt…` | schema | Fase 4 |
| 13 | HEIC não é aceite (sem `sharp`/`heic-convert` na api) | api | Fase 2 |
| 14 | `/storage/tree` mostra vazio na raiz: as chaves são `_inbox/<tenantId>/…` e `fornecedores/…`, mas o browser lista `<tenantId>/…`. Comportamento pré-existente (também com driver local) | api | Fase 7 (ou quando a UI de pastas for revista) |
| 15 | Extração do PDF de 4 páginas `FT 4 83 5638` demorou > 2 min e ficou sem `total` (NIF e nº doc certos). Fotos WhatsApp ≈ 2 min | extraction | Fase 2 |
| 16 | Volume `docflow-uploads` continua montado com os 3 ficheiros antigos (já copiados para o MinIO) — manter até ao fim do MVP como rollback; remover na Fase 7 | compose | Fase 7 |

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

1. **`GEMINI_API_KEY` no Coolify.** O prompt diz que existe; não existia. Na Fase 1 criei a variável **vazia** na app `docflow-production` e o compose já a passa ao `api`. Para a Fase 2 (Gemini como provider principal) o Rui só tem de preencher o valor em Coolify → docflow-production → Environment Variables → `GEMINI_API_KEY` e fazer redeploy. Entretanto a extração funciona via OpenRouter (`google/gemini-2.5-flash`).
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
Próximo: Fase 1 — Storage MinIO + deploy limpo.

## Fase 1 — Storage MinIO + deploy limpo — 2026-09-11
Feito: 3 testes vermelhos corrigidos (`14ebc3a`); audit high/critical a zero + pnpm 11 unificado (`c95e8ea`); `S3Storage` + factory `STORAGE_DRIVER` + health com storage + `/storage/tree` agnóstico + script de migração + MinIO/minio-init no compose (`7afa312`). Env vars criadas no Coolify: `MINIO_ROOT_USER/PASSWORD`, `S3_ACCESS_KEY/SECRET_KEY`, `S3_BUCKET`, `STORAGE_DRIVER=s3`, `S3_PUBLIC_ENDPOINT`, `GEMINI_API_KEY` (vazia), `GEMINI_VISION_MODEL` (vazia). Domínio `files-docflow.167.86.111.8.sslip.io` atribuído ao serviço `minio` (só API S3, TLS Let's Encrypt — a 1.ª emissão falhou por DNS transitório no LE; um restart da app resolveu).
Verificado em produção: deploy 1 com `STORAGE_DRIVER=local` → `minio-init` criou bucket + utilizador; migração dos 3 ficheiros existentes (`--dry-run` → live → re-run = 3 skipped); deploy 2 com `STORAGE_DRIVER=s3` → `/health/full` `{db:up, redis:up, storage:up, storageDriver:s3}`. Smoke com 6 amostras reais (Miranda e Serra 6384, AAA26_05582, FT 4 83 5638, LIZOTEL 1944, foto WhatsApp, VFV26000793): 6/6 upload 201 → objeto no MinIO → `GET /documents/:id/url` devolve presigned URL → download 200 com bytes iguais ao original (o último com TLS estrito). 5/6 com NIF do emitente e total corretos; 1 (PDF 4 págs) sem total → Fase 2. Localmente: 19/19 checks e2e contra MinIO em docker-compose (put/get/move/presign/tamper 403/list/policy do utilizador de serviço/migração idempotente).
Testes: 1139 verdes / 1139 (api). Build api ✅, web ✅ (Next 15.5.25).
Falhou / adiado: `expose` em vez de `ports` para api/web não foi alterado — o Coolify usa `ports` para descobrir a porta a rotear e a firewall já bloqueia o acesso direto; fica para a Fase 7. Chaves de storage mantidas no esquema existente (`_inbox/<tenant>/…` → `fornecedores/<slug>/<ano>/…`) em vez de `{tenantId}/{ano}/{sha256}.{ext}`: mudar o esquema partiria a relocalização na aprovação e o browser de pastas; o driver é agnóstico da chave.
Bloqueios (preciso do Rui): `GEMINI_API_KEY` continua vazia no Coolify (ver Bloqueios).
Próximo: Fase 2 — Leitura robusta.

---

## Próxima fase

**Fase 2 — Leitura robusta.** Ordem prevista:
1. HEIC/HEIF → JPEG (`sharp`/`heic-convert`) antes de vision e do PDF derivado.
2. Pipeline fixo EXIF → QR-AT (ZXing) → texto nativo → vision → merge por campo com regras (QR manda em NIF/total/IVA/ATCUD/data/nº; IBAN só com MOD-97).
3. Retry com 2.º provider quando `confidence < 0.7`; gateway `{URL, TOKEN, MODEL}` por provider.
4. Benchmark com todas as amostras vs `gemini-documental` → `docs/READING_BENCHMARK.md` (≥ 90 % NIF+total+data).

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
