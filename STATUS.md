# DocFlow — STATUS

Reescrito do zero na **Fase 0 (2026-09-11)**. Tudo o que está aqui foi verificado por testes, build, API do Coolify ou SSH ao VPS nessa data. Documentação em `docs/*` anterior a esta data está desatualizada — o código e os testes são a verdade.

Missão em curso: Bloco A (Fases 0–7) do prompt mestre. Cliente: HotelEquip / Nov Ousado Unipessoal Lda (NIF 515208566).

---

## Funciona (verificado 2026-09-11)

### Produção (Coolify, projeto `documentsfill`, ambiente `production`, VPS 167.86.111.8)

| Item | Estado |
|------|--------|
| App Coolify `docflow-production` (uuid `d20uxq2vlknrluxbbcqaw0tt`) | build pack **docker-compose** a partir de `RuiMedalha/DOCFLOW` branch **`main`**, `docker-compose.yml` na raiz |
| Commit em produção | `d01ad38` (Fase 3). Deploy 2026-09-11 (migrations `20260911050000` + `20260911050001` aplicadas pelo entrypoint; backup `/root/backups/docflow/docflow-20260911-0415-pre-fase3.sql.gz`) |
| Containers | `api`, `web`, `postgres:17-alpine`, `redis:7-alpine`, `minio` (RELEASE.2025-09-07), `minio-init` (one-shot, exit 0) |
| API | `https://r122tccopibb6pov1fmrau9v.167.86.111.8.sslip.io/api/v1/health` → 200 `{db:up, storage:up, storageDriver:s3}`; `/health/full` → `{db, redis, storage}` |
| Web | `https://dt8htz3dc2cxv7pz2au7l1tm.167.86.111.8.sslip.io/` → 307 para `/login` (200) |
| Migrations | `entrypoint.sh` corre `prisma migrate deploy` no arranque (24 migrations, última `20260911050001_fase3_fiscal_key_unique_index`) |
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
| `apps/api` `pnpm test` | **1193 verdes / 1193** (109 suites) |
| `apps/api` `pnpm build` | ✅ verde |
| `apps/web` `next build` | ✅ compila + typecheck + 43 páginas. Só o passo `standalone` (cópia de symlinks) falha **no Windows local** por EPERM — no Docker (Linux) funciona, prova é a produção |
| Node / pnpm locais | Node 24.12.0; pnpm **11.10.0** (também nos Dockerfiles). Overrides em `apps/*/pnpm-workspace.yaml`. O `pnpm build` da web falha localmente por `ERR_PNPM_IGNORED_BUILDS sharp` — usar `npx next build` |
| Estrutura | **Não é workspace pnpm**: `apps/api` e `apps/web` têm `package.json` + `pnpm-lock.yaml` próprios; `packages/shared` ligado por `file:../../packages/shared` |

### Funcionalidades existentes (por código + testes; smoke em produção fica para a Fase 1)

- Upload multipart (PDF/JPEG/PNG/**HEIC→JPEG**), hash SHA-256 com `@@unique([tenantId, fileHash])`, PDF derivado de fotos.
- Pipeline assíncrono `RECEIVED → EXTRACTING → ENRICHING → ROUTING → COMPLETED` com SSE (`/documents/:id/processing/stream`).
- QR-AT: decoder ZXing cascade + jsQR fallback (em worker thread) + parser determinístico; em PDFs sem QR no texto rasteriza pág. 1 (@2/@3) e última. QR lido pela IA só é aceite com cross-check (`isAiQrConsistent`). Benchmark: `docs/READING_BENCHMARK.md` (19/19).
- Vision IA: gateway {URL, TOKEN, MODEL} por provider (Gemini, OpenRouter, MiniMax, OpenAI, Anthropic), ordem por `VISION_PROVIDER_ORDER` (default Gemini primeiro), 2.ª opinião quando confidence < `VISION_SECOND_OPINION_CONFIDENCE` (0,7). Em produção só OpenRouter tem token.
- Fornecedores (`Party`) com resolução por NIF, enriquecimento, categorias por fornecedor (`party-categories`), regras de pastas.
- Categorias de despesa (9 PT seedadas, `ivaDeductibilityPct`).
- Validade fiscal determinística (`fiscalStatus` FISCAL/NAO_FISCAL/INDETERMINADO + `fiscalReason`, `extraction/fiscal-status.ts`), tipos PROFORMA/ORCAMENTO/AVISO_PAGAMENTO/EXTRATO_FORNECEDOR/FATURA_SIMPLIFICADA, duplicados por chave fiscal (NIF + nº normalizado | ATCUD) → `DUPLICADO` ligado ao original; índice único parcial `documents_fiscal_key_unique`. NAO_FISCAL e DUPLICADO fora do apuramento de IVA.
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
| 11 | ~~Sem `fiscalStatus`/tipos/dedup fiscal~~ **Resolvido na Fase 3** (`577c99c`, `4e86b28`, `ea1145a`, `d01ad38`). Faturas estrangeiras ficam `INDETERMINADO (vies_pending)` até a Fase 4 ligar o VIES | schema | ✅ |
| 17 | `prisma migrate diff` local mostra drift **pré-existente** em `approvals`/`document_field_confirmations` (FKs/`updatedAt` default) — não tocado; rever na Fase 7 | schema | Fase 7 |
| 18 | 11 dos 13 `qrPayload` guardados em produção eram read-backs da IA sem Q/R (antes do cross-check). Já não são usados como QR (só payloads completos contam), mas as linhas mantêm o texto antigo até à próxima re-extração | prod | Fase 7 (limpeza opcional) |
| 12 | `Party` sem `vatNumber/vatRegime/currency/paymentTermsDays/directDebit/viesValidatedAt…` | schema | Fase 4 |
| 13 | ~~HEIC não é aceite~~ **Resolvido na Fase 2** (`813c93d`, heic-convert) — falta um HEIC real para smoke (ver Bloqueios) | api | ✅ |
| 14 | `/storage/tree` mostra vazio na raiz: as chaves são `_inbox/<tenantId>/…` e `fornecedores/…`, mas o browser lista `<tenantId>/…`. Comportamento pré-existente (também com driver local) | api | Fase 7 (ou quando a UI de pastas for revista) |
| 15 | ~~PDF 4 páginas sem total~~ **Resolvido na Fase 2** (QR rasterizado: 6,7 s, total certo). Fotos continuam ≈ 2 min (cascade a várias escalas + vision) — já não bloqueia a API | extraction | Fase 7 (otimização opcional) |
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
2. **Um HEIC real** (foto de iPhone) para o smoke de produção do caminho HEIC→JPEG — só testei a rejeição de um HEIC inválido (400 claro) e o conversor com stub. Enviar para `samples/`.
3. Benchmark comparativo com `gemini-documental` depende da mesma `GEMINI_API_KEY`.

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

## Fase 2 — Leitura robusta — 2026-09-11
Feito: HEIC/HEIF → JPEG no upload/email/scanner (`813c93d`); QR-AT determinístico em PDFs digitalizados por rasterização (pág. 1 @2/@3 + última) antes da vision; IBAN da IA só com MOD-97; gateway {URL,TOKEN,MODEL} por provider + `VISION_PROVIDER_ORDER` (Gemini principal) + 2.ª opinião < 0,7; QR lido pela IA só com cross-check contra os campos da própria IA e só persiste se aceite (`8c164d9`, `bb1d98b`); cascade de QR em worker thread + healthcheck tolerante (`1d97ba6`). Docs: `docs/READING_BENCHMARK.md`.
Verificado em produção: benchmark das 19 amostras reais → **19/19 com NIF + total + data corretos (100 %)**, 11 PDFs com QR descodificado deterministicamente (6 scans), 3 faturas espanholas por IA com NIF-IVA correto, fotos direitas (EXIF) e lidas; upload de HEIC inválido → 400 com mensagem clara; `/health/full` ok durante toda a corrida depois do worker (antes o Traefik devolveu "no available server" a meio).
Testes: 1161 verdes / 1161 (api). Build api ✅, web typecheck ✅.
Falhou / adiado: comparação com `gemini-documental` — sem `GEMINI_API_KEY` não corre (documentado no benchmark, sem código a portar). Fotos demoram ~2 min (não bloqueia). Primeira corrida do benchmark deu 79 % e revelou os dois defeitos corrigidos acima (QR alucinado como autoridade; event loop bloqueado).
Bloqueios (preciso do Rui): `GEMINI_API_KEY` (Gemini principal + benchmark comparativo); um HEIC real para smoke.
Próximo: Fase 3 — Validade fiscal, tipos e duplicados.

## Fase 3 — Validade fiscal, tipos e duplicados — 2026-09-11
Feito: schema + 2 migrations à mão (enums/colunas e índice único parcial em transações separadas, porque o Postgres não deixa usar um valor de enum novo na mesma transação); módulo puro `fiscal-status.ts` (QR-AT válido → FISCAL, palavras-chave → NAO_FISCAL com tipo, estrangeira → FISCAL só com VIES, resto INDETERMINADO; nunca a partir de QR lido pela IA); dedup por (NIF + nº normalizado) ou ATCUD com fallback P2002; ATCUD deixa de ser usado como nº de documento; `qrPayload` guardado só conta se for QR completo; IVA exclui NAO_FISCAL/DUPLICADO; badges e link ao original no frontend.
Verificado em produção: backup `pg_dump` antes do deploy; migrations aplicadas pelo entrypoint (`_prisma_migrations` + `documents_fiscal_key_unique` confirmados por SQL); smoke 8/8: proforma sintética da Miranda & Serra → `NAO_FISCAL / PROFORMA` (não duplicada da fatura real), Miranda FT 2026A92/6384 → `FISCAL (qr_at_valid)`, foto IKEA #2 → `DUPLICADO` da foto #1, Clima Hostelería (ES) → `INDETERMINADO (vies_pending:ESB06612386)`.
Testes: 1193 verdes / 1193 (api). Build api ✅, web typecheck ✅.
Falhou / adiado: 1.º deploy falhou no build Docker (chave `FS` duplicada no aliasMap — o build local incremental não a apanhou; corrigido em `4e86b28`, tsbuildinfo agora limpo antes do build). Smoke de proforma feito com PDF sintético — não há proforma real nas amostras.
Bloqueios (preciso do Rui): nenhum novo (GEMINI_API_KEY e HEIC real continuam pendentes).
Próximo: Fase 4 — Fornecedores completos.

---

## Próxima fase

**Fase 4 — Fornecedores completos.** Ordem prevista:
1. Migration `Party`: country, vatNumber, vatRegime (PT | UE_REVERSE_CHARGE | EXTRA_UE), currency, paymentTermsDays, directDebit, defaultCategoryId, billingEmail, contacts, notes, viesValidatedAt/viesName/viesAddress; `PartyCategoryStat(partyId, categoryId, approvedCount)`; `Document.amountEur`.
2. Serviço VIES (REST oficial da CE, cache 30 dias) + ligação ao `fiscal-status` (`viesValidated`) → faturas ES passam a FISCAL.
3. Câmbio BCE à data da fatura para moeda ≠ EUR (`amountEur`).
4. Importador CSV de fornecedores; página de fornecedor com ficha + histórico + produtos; auto-categoria após 3 aprovações.

~~**Fase 3 — Validade fiscal, tipos e duplicados.** Ordem prevista:~~
1. Migration: `fiscalStatus` (FISCAL | NAO_FISCAL | INDETERMINADO) + `DocumentType` alargado (PROFORMA, ORCAMENTO, AVISO_PAGAMENTO, EXTRATO_FORNECEDOR, FATURA_SIMPLIFICADA) + índice único parcial `(tenantId, supplierNif, docNumber, atcud)` + estado `DUPLICADO` ligado ao original.
2. Regra determinística de `fiscalStatus` (QR válido / estrangeira com NIF-IVA + nº + data / palavras-chave proforma-orçamento-aviso) com testes por regra.
3. Dedup por chave fiscal na extração (email vs papel: Miranda 6384 nativo vs scan; fotos IKEA ×2).
4. `NAO_FISCAL` fora do envio ao TOC/IVA; smoke em produção com proforma + fatura do mesmo fornecedor (pedir proforma real ao Rui ou gerar).

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
