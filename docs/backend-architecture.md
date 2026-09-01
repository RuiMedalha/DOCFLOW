# DocFlow Backend Architecture

> **Status:** Enterprise Complete skeleton. NestJS 11 + Prisma 6 + pnpm + Turborepo. Monorepo: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (DTOs & zod schemas).

---

## 0. Source-of-truth decision matrix

Every module below is **ported from one of three source repos** and may pull best-of-breed pieces from the others. The decision matrix records why each module ends up where it does.

| Module                          | Primary port                       | Why                                                                                  | Secondary (borrowed)         |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| **prisma**                      | grok (grok-documental)             | Already on Prisma 6; tenantId scoping pattern matches target.                        | deep-seek (Redis/Bull hooks) |
| **common** (guards/interceptors)| grok                               | Has `current-user.decorator`, `roles.decorator`, `jwt-auth.guard`, `roles.guard`.     | deep-seek (helmet/morgan)    |
| **auth**                        | deep-seek (auth)                   | Has `two-factor.service`, refresh-token strategy, full Passport pipeline.            | grok (JWT async config)      |
| **tenants**                     | grok                               | Clean tenant settings update + multi-tenant scoping.                                | deep-seek (CRM extension)    |
| **documents**                   | grok                               | Already CRUD with prisma.                                                            | deep-seek (OCR hooks)        |
| **ocr** (incl. QR-AT)           | deep-seek (ocr)                    | Has `qrcode-at.service`, `scanner.service` — the only AT-compliant parser.           | —                            |
| **banking** (CSV/CAMT/SEPA)     | grok (bank)                        | `csv-parser.util` is battle-tested; clean separation.                                 | deep-seek (CAMT future)      |
| **reconciliation**              | grok                               | Multi-strategy matching algorithm is production-quality.                             | deep-seek (AI suggestions)   |
| **crm**                         | deep-seek                          | CRM tables + service richer than grok.                                               | —                            |
| **parties**                     | grok                               | Simpler controller, matches tenants model.                                           | —                            |
| **payables**                    | grok                               | Domain model matches Portuguese AP workflow.                                         | —                            |
| **payroll**                     | NEW (build from rules)             | Not in any source — Portuguese payroll engine.                                       | —                            |
| **fleet**                       | NEW (build)                        | Not in any source — vehicle/expenses module.                                         | —                            |
| **tax-simulator**               | NEW (build)                        | Not in any source — IRS / VAT simulator.                                             | —                            |
| **search** (full-text+semantic) | grok (search)                      | Already covers documents/parties/transactions/payables.                              | deep-seek (Redis caching)    |
| **security** (IBAN anti-fraud)  | NEW (build) + deep-seek (security/) | deep-seek has the folder but no real logic — port bare folder, build `IbanGuard`.   | —                            |
| **audit** (hash-chaining)       | NEW (build)                        | Only grok has empty folder; needs full impl w/ chained SHA-256.                      | —                            |
| **integrations**                | grok                               | Already lists/syncs toconline, ifthenpay, moloni, woocommerce with provider allowlist.| deep-seek (accounting-rules)|
| **ai** (copilot)                | deep-seek (ai)                     | Source has real AI module folder.                                                    | grok (queued jobs)           |
| **notifications**               | deep-seek (notifications)          | Web-push + socket.io + nodemailer already wired.                                      | grok (tenant prefs)          |
| **export** (ZIP/Excel/SAF-T)    | deep-seek (export)                 | exceljs + zip pipeline already present.                                              | —                            |
| **inbound** (email + IMAP)      | grok (inbound)                     | imapflow + mailparser stack already imported.                                        | —                            |
| **health**                      | NEW                                | Standard `@nestjs/terminus` wiring — not in any source.                               | —                            |

**Sources:**
- `C:\Projetos\deep-seek-documental\apps\api\src\` — auth, QR-AT OCR, notifications, export, AI, accounting-rules, supplier-rules, payments.
- `C:\Projetos\gemini-documental\apps\api\src\` — bare scaffold (4 files, almost empty). Skipped.
- `C:\Projetos\grok-documental\apps\api\src\` — tenants, common, bank CSV, parties, payables, accounting, folder-rules, integrations, search, inbound, throttler.

---

## 1. Top-level app structure

```
apps/api/src/
├── main.ts                       # bootstrap: helmet, cors, validation, swagger /api/docs
├── app.module.ts                 # global module graph (see file)
├── prisma/                       # PrismaService (tenant-scoped client wrapper)
├── common/                       # Guards, interceptors, decorators, filters, helpers
│   ├── guards/                   # JwtAuthGuard, TenantGuard, RolesGuard, ApiKeyGuard
│   ├── interceptors/             # LoggingInterceptor, AuditInterceptor, TimeoutInterceptor
│   ├── filters/                  # AllExceptionsFilter (Sentry-bound)
│   ├── decorators/               # @CurrentUser, @TenantId, @Roles, @Public, @ApiKeyScope
│   ├── pipes/                    # ZodValidationPipe (alongside class-validator)
│   └── common.module.ts
├── auth/                         # JWT + refresh + 2FA + WebAuthn
├── tenants/                      # Tenant CRUD, settings, billing
├── documents/                    # upload, metadata, file mgmt
├── ocr/                          # Tesseract + QR-AT decoder
├── banking/                      # CSV / CAMT.053 / SEPA parsers
├── reconciliation/               # matching engine
├── payables/                     # accounts payable
├── payroll/                      # Portuguese payroll
├── fleet/                        # vehicle/expense management
├── crm/                          # customers, deals, pipeline
├── tax-simulator/                # IRS / VAT / social security simulator
├── accounting/                   # accounting-rules + supplier-rules
├── folder-rules/                 # auto-classification engine
├── search/                       # full-text + semantic search
├── security/                     # IBAN anti-fraud, breach detection
├── audit/                        # hash-chained tamper-evident log
├── integrations/                 # TOConline, Ifthenpay, Moloni, WooCommerce
├── ai/                           # copilot (LLM-backed)
├── notifications/                # email, push, socket.io
├── export/                       # ZIP, Excel, SAF-T validator
├── inbound/                      # IMAP watcher
└── health/                       # /healthz, /readyz
```

---

## 2. Module-by-module spec

Each entry lists: **Controller(s)** · **Service(s)** · **Responsibilities** · **Port-from**.

### 2.1 `prisma/`
- **Service:** `PrismaService extends Prisma.Client` with `onModuleInit` connection, `onModuleDestroy` cleanup, and tenant-scoping middleware (`$use`) reading `req.tenantId`.
- **Port from:** grok.

### 2.2 `common/`
- **Guards:**
  - `JwtAuthGuard` — global, validates Bearer JWT (issued by `AuthModule`).
  - `TenantGuard` — runs after JWT, asserts `req.user.tenantId === req.params.tenantId` (or query/header).
  - `RolesGuard` — checks `@Roles('admin','accountant',…)` against JWT claims.
  - `ApiKeyGuard` — accepts `X-API-Key` header for server-to-server (webhook receivers).
- **Interceptors:**
  - `LoggingInterceptor` — structured logs w/ requestId (ULID).
  - `AuditInterceptor` — emits audit event for any `@Auditable()` handler.
  - `TimeoutInterceptor` — per-route deadlines.
- **Filters:** `AllExceptionsFilter` (RFC7807 + Sentry).
- **Decorators:** `@CurrentUser()`, `@TenantId()`, `@Roles([...])`, `@Public()`, `@Auditable('document.update')`, `@Idempotent()`.
- **Port from:** grok (`current-user.decorator`, `roles.decorator`, `jwt-auth.guard`, `roles.guard`) + deep-seek (helmet/morgan/compression wiring in main.ts).

### 2.3 `auth/` — JWT + refresh + 2FA + WebAuthn
- **Controllers:** `AuthController` (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/2fa/enable`, `/auth/2fa/verify`, `/auth/webauthn/register/options`, `/auth/webauthn/register/verify`, `/auth/webauthn/login/options`, `/auth/webauthn/login/verify`).
- **Services:**
  - `AuthService` — credential check, JWT issuance (access+refresh), token rotation.
  - `JwtStrategy` / `JwtRefreshStrategy` — Passport strategies with `passport-jwt`.
  - `TwoFactorService` — TOTP via `speakeasy`/`otplib`; recovery codes.
  - `WebAuthnService` — registration & assertion ceremonies via `openid-client`/`@simplewebauthn`.
  - `PasswordService` — Argon2id hashing (replaces bcrypt).
- **Responsibilities:** identity, MFA enrollment, password reset, session management, brute-force lockout (Redis counter).
- **Port from:** **deep-seek** (`two-factor.service.ts`, `jwt-refresh.strategy.ts`, full folder) + grok (async JWT config via ConfigService).

### 2.4 `tenants/`
- **Controller:** `TenantsController` (`/tenants/me`, `/tenants/me/settings`, `/tenants/:id/users`).
- **Service:** `TenantsService` — get/update tenant settings (NIF, IBAN, BIC, address, fiscal year, defaults).
- **Port from:** grok.

### 2.5 `documents/`
- **Controllers:** `DocumentsController` (`/documents` CRUD), `DocumentVersionsController`, `DocumentShareController`.
- **Services:**
  - `DocumentsService` — upload (multer → S3/MinIO), metadata, tagging, soft-delete.
  - `StorageService` — abstracts local/S3/MinIO.
  - `HashService` — SHA-256 for tamper detection; feeds `audit/`.
- **Port from:** grok (`documents.controller.ts`, `documents.service.ts`) — and inject `OcrModule` for async OCR after upload.

### 2.6 `ocr/` — Tesseract + QR-AT
- **Controllers:** `OcrController` (`/ocr/jobs/:id`, `/ocr/qr-at/:documentId`).
- **Services:**
  - `OcrService` — Tesseract.js worker pool; queues via BullMQ.
  - `ScannerService` — image preprocessing (deskew, denoise).
  - `QrCodeAtService` — **Portuguese QR-AT** decoder (`A:BBB*BBB*PT*B*NNNNNNNN*NNNNN*N*AAAAAMMDD*…`) — emits NIF, docType, totals, AT hash.
- **Port from:** **deep-seek** (`ocr/`, `qrcode-at.service.ts` — the only AT-compliant parser).

### 2.7 `banking/` — CSV / CAMT.053 / SEPA
- **Controller:** `BankingController` (`/banking/accounts`, `/banking/statements`, `/banking/import`).
- **Services:**
  - `BankingService` — accounts & statements CRUD.
  - `CsvParser` — multi-bank column detection (port from grok `csv-parser.util`).
  - `Camt053Parser` — ISO 20022 via `iso20022-js` (NEW).
  - `SepaParser` — pain.001.001.09 (NEW).
- **Port from:** grok (`bank/`) + extend with CAMT.053 + SEPA parsers.

### 2.8 `reconciliation/`
- **Controller:** `ReconciliationController` (`/reconciliation/sessions`, `/reconciliation/match`, `/reconciliation/confirm`).
- **Services:**
  - `ReconciliationService` — orchestrates matching strategies.
  - `StrategiesMatch` — exact ref + fuzzy (Levenshtein) + amount+date window + AI suggestion.
  - `MatchingEngine` — scoring & ranking.
- **Port from:** grok (`reconciliation/`) — extend with semantic/embedding matcher.

### 2.9 `parties/`
- **Controller:** `PartiesController` (`/parties`).
- **Service:** `PartiesService` — customers + suppliers CRUD, NIF validation via AT API, IBAN validation.
- **Port from:** grok.

### 2.10 `payables/`
- **Controller:** `PayablesController` (`/payables`, `/payables/:id/approve`, `/payables/:id/pay`).
- **Service:** `PayablesService` — invoice lifecycle, approval workflow, payment batch generation (SEPA XML).
- **Port from:** grok.

### 2.11 `payroll/` — NEW
- **Controller:** `PayrollController` (`/payroll/runs`, `/payroll/employees`, `/payroll/simulate`).
- **Services:**
  - `PayrollService` — monthly payroll run orchestration.
  - `IrsCalculator` — Portuguese IRS brackets 2026.
  - `SocialSecurityCalculator` — TSS rates.
  - `PayslipGenerator` — PDF (pdfmake).
- **Status:** build from Portuguese fiscal tables.

### 2.12 `fleet/` — NEW
- **Controller:** `FleetController` (`/fleet/vehicles`, `/fleet/expenses`).
- **Services:** `FleetService`, `FuelConsumptionService`, `MileageTracker`.
- **Status:** build.

### 2.13 `crm/`
- **Controller:** `CrmController` (`/crm/customers`, `/crm/deals`, `/crm/pipeline`).
- **Service:** `CrmService` — customers + deals + sales pipeline.
- **Port from:** **deep-seek** (`crm/`).

### 2.14 `tax-simulator/` — NEW
- **Controller:** `TaxSimulatorController` (`/tax-sim/irs`, `/tax-sim/vat`, `/tax-sim/social-security`).
- **Services:** `IrsSimulator`, `VatSimulator`, `SocialSecuritySimulator` — what-if calculators.
- **Status:** build.

### 2.15 `accounting/`
- **Controllers:** `AccountingController` (`/accounting/rules`, `/accounting/post`).
- **Services:**
  - `AccountingService` — journal entries, posting rules.
  - `AccountingRulesService` — rule engine (CRUD + evaluation).
  - `SupplierRulesService` — supplier-specific routing.
- **Port from:** deep-seek (`accounting-rules/`, `supplier-rules/`).

### 2.16 `folder-rules/`
- **Controller:** `FolderRulesController`.
- **Service:** `FolderRulesService` — auto-classify incoming documents based on supplier/NIF/keywords.
- **Port from:** grok.

### 2.17 `search/` — full-text + semantic
- **Controller:** `SearchController` (`/search`, `/search/semantic`).
- **Services:**
  - `SearchService` — full-text over documents/parties/transactions/payables (port from grok).
  - `SemanticSearchService` — vector search via pgvector (embeddings via OpenAI/Anthropic).
  - `SearchIndexService` — keeps the index hot (BullMQ incremental).
- **Port from:** grok (`search.service.ts`) + add pgvector semantic layer.

### 2.18 `security/` — IBAN anti-fraud
- **Controller:** `SecurityController` (`/security/iban/validate`, `/security/iban/blacklist`).
- **Services:**
  - `IbanGuard` — `simple-iban` format check + BIC lookup + checksum.
  - `AntiFraudService` — flagged accounts, scoring, rules.
- **Port from:** NEW (deep-seek `security/` is empty — port folder, build logic).

### 2.19 `audit/` — hash-chained
- **Controller:** `AuditController` (`/audit/log`, `/audit/verify`, `/audit/export`).
- **Service:** `AuditService` — append-only `AuditEvent` rows; each row stores `prevHash = SHA-256(prevRow.hash + payload)`; `verify()` walks the chain.
- **Port from:** NEW (build). Inspired by certificate transparency log.

### 2.20 `integrations/` — TOConline / Ifthenpay / Moloni / WooCommerce
- **Controller:** `IntegrationsController` (`/integrations`, `/integrations/:provider/sync`, `/integrations/webhooks/:provider`).
- **Services:**
  - `IntegrationsService` — list/upsert/deactivate (provider allowlist).
  - `ToconlineService` — TOConline AT API (invoices, SAF-T).
  - `IfthenpayService` — Multibanco/MB WAY reference generation + callback.
  - `MoloniService` — Moloni invoices API.
  - `WooCommerceService` — orders + customers sync.
  - `WebhookReceiver` — shared HMAC verifier.
- **Port from:** **grok** (`integrations/toconline.service.ts` + controller). Deep-seek has integrations skeleton too — merge allowed providers list.

### 2.21 `ai/` — Copilot
- **Controller:** `AiController` (`/ai/chat`, `/ai/embed`, `/ai/suggest`).
- **Services:**
  - `CopilotService` — Claude / OpenAI tool-using agent with DocFlow tools (read tenant, post journal, suggest reconciliation).
  - `EmbeddingService` — vector embeddings.
  - `PromptRegistry` — versioned system prompts.
- **Port from:** **deep-seek** (`ai/` folder present).

### 2.22 `notifications/`
- **Controller:** `NotificationsController` (`/notifications`, `/notifications/preferences`).
- **Services:**
  - `NotificationsService` — email (Nodemailer), web-push, in-app (socket.io).
  - `TemplatesService` — handlebars templates (PT + EN).
  - `WebPushService` — VAPID-signed push.
- **Port from:** **deep-seek** (`notifications/` has web-push + nodemailer + socket.io).

### 2.23 `export/` — ZIP / Excel / SAF-T
- **Controller:** `ExportController` (`/export/zip`, `/export/excel`, `/export/saft/validate`).
- **Services:**
  - `ExportService` — orchestrates.
  - `ZipExporter` — `jszip`.
  - `ExcelExporter` — `exceljs`.
  - `SaftValidator` — Portuguese SAF-T 1.04_01 XSD validation.
- **Port from:** **deep-seek** (`export/` with exceljs pipeline). SAF-T validator is NEW.

### 2.24 `inbound/` — IMAP watcher
- **Controller:** `InboundController` (`/inbound/rules`).
- **Services:**
  - `ImapWatcherService` — `imapflow` connection per inbox.
  - `MailParserService` — `mailparser` extracts attachments → Documents.
- **Port from:** **grok** (`inbound/` already imports imapflow + mailparser).

### 2.25 `health/` — NEW
- **Controller:** `HealthController` (`/healthz`, `/readyz`).
- **Service:** `HealthService` — Prisma + Redis + storage + external APIs checks (Terminus).
- **Status:** build (no source has it).

---

## 3. Cross-cutting patterns

### 3.1 Auth chain (per request)
```
Request → Helmet → Compression → Morgan → CORS
        → ThrottlerGuard (global)
        → JwtAuthGuard (global, @Public() bypass)
        → TenantGuard (validates tenantId matches user)
        → RolesGuard (per-handler @Roles)
        → ApiKeyGuard (only on /integrations/webhooks/*)
        → LoggingInterceptor (requestId, timing)
        → AuditInterceptor (if @Auditable)
        → ValidationPipe (zod or class-validator)
        → Controller
        → AllExceptionsFilter on throw
```

### 3.2 Background jobs (BullMQ)
- `ocr.process` → `OcrService.process()`
- `reconciliation.match` → `ReconciliationEngine.match()`
- `search.index` → `SearchIndexService.upsert()`
- `notifications.email` / `.push` / `.socket`
- `integrations.sync.<provider>` (cron via `@nestjs/schedule`)
- `audit.compact` (daily)

### 3.3 Multi-tenancy rule
Every Prisma query goes through a tenant-scoped client. The `PrismaService.$use()` extension injects `where: { tenantId }` automatically based on `req.user.tenantId` stored on `AsyncLocalStorage`.

### 3.4 Observability
- Logs: pino via `nestjs-pino` (NEW dep).
- Metrics: `@willsoto/nestjs-prometheus` (NEW dep).
- Tracing: OpenTelemetry `@opentelemetry/sdk-node` (NEW dep).
- Errors: Sentry via `@sentry/node` (NEW dep).

> These four were not in any source repo's package.json — added to roadmap, not the initial skeleton.

---

## 4. Mapping table (source → target)

| Source module (deep-seek)        | Target module                | Action               |
| -------------------------------- | ---------------------------- | -------------------- |
| `src/auth/`                      | `apps/api/src/auth/`         | **PORT** (full)      |
| `src/ocr/` (incl. qrcode-at)     | `apps/api/src/ocr/`          | **PORT** (full)      |
| `src/notifications/`             | `apps/api/src/notifications/`| **PORT** (full)      |
| `src/export/`                    | `apps/api/src/export/`       | **PORT** (full)      |
| `src/integrations/`              | borrowed (see grok)          | merge                |
| `src/ai/`                        | `apps/api/src/ai/`           | **PORT** (full)      |
| `src/crm/`                       | `apps/api/src/crm/`          | **PORT** (full)      |
| `src/bank-import/`               | extends `banking/`           | merge parsers        |
| `src/payments/`                  | merged into `payables/`      | merge                |
| `src/security/`                  | `apps/api/src/security/`     | port folder, build   |
| `src/accounting-rules/`          | `apps/api/src/accounting/`   | **PORT** (full)      |
| `src/supplier-rules/`            | `apps/api/src/accounting/`   | **PORT** (full)      |
| `src/email-processing/`          | merged into `inbound/`       | merge                |
| `src/reports/`                   | cross-cutting helpers        | spread per module    |
| `src/prisma/`                    | merged into `prisma/`        | merge                |

| Source module (grok)             | Target module                | Action               |
| ------------------------------- | ---------------------------- | -------------------- |
| `src/common/`                   | `apps/api/src/common/`       | **PORT** (full)      |
| `src/auth/`                     | see above (deep-seek wins)   | merge JWT strategy   |
| `src/tenants/`                  | `apps/api/src/tenants/`      | **PORT** (full)      |
| `src/documents/`                | `apps/api/src/documents/`    | **PORT** (full)      |
| `src/bank/`                     | `apps/api/src/banking/`      | **PORT** (full) + CAMT/SEPA |
| `src/reconciliation/`           | `apps/api/src/reconciliation/`| **PORT** (full)      |
| `src/parties/`                  | `apps/api/src/parties/`      | **PORT** (full)      |
| `src/payables/`                 | `apps/api/src/payables/`     | **PORT** (full)      |
| `src/accounting/`               | merged into `accounting/`    | merge                |
| `src/folder-rules/`             | `apps/api/src/folder-rules/` | **PORT** (full)      |
| `src/search/`                   | `apps/api/src/search/`       | **PORT** (full) + semantic |
| `src/integrations/` (incl. toconline)| `apps/api/src/integrations/` | **PORT** (full) — wins on provider allowlist |
| `src/inbound/`                  | `apps/api/src/inbound/`      | **PORT** (full)      |
| `src/extraction/`               | merged into `ocr/`           | merge                |
| `src/notifications/`            | see above (deep-seek wins)   | merge                |
| `src/audit/` (empty)             | `apps/api/src/audit/`        | build (hash-chain)   |
| `src/prisma/`                   | merged                       | merge                |

| Source module (gemini)           | Target module                | Action               |
| ------------------------------- | ---------------------------- | -------------------- |
| entire src/ (4 files)           | —                            | **SKIP** (scaffold only) |

---

## 5. Confirmed coverage of requested scope

| Requested module          | Implemented as                                |
| ------------------------- | --------------------------------------------- |
| auth (JWT+refresh+2FA+WebAuthn) | `auth/` (deep-seek + WAuthn add)         |
| common (guards/interceptors) | `common/` (grok)                          |
| documents (upload/OCR/QR-AT) | `documents/` + `ocr/` (deep-seek QR-AT)   |
| banking (CSV/CAMT/SEPA)   | `banking/` (grok CSV + NEW CAMT/SEPA)         |
| reconciliation            | `reconciliation/` (grok)                      |
| crm                       | `crm/` (deep-seek)                            |
| parties                   | `parties/` (grok)                             |
| payables                  | `payables/` (grok)                            |
| payroll                   | `payroll/` (NEW)                              |
| fleet                     | `fleet/` (NEW)                                |
| tax-simulator             | `tax-simulator/` (NEW)                        |
| search (full-text+semantic) | `search/` (grok + NEW pgvector)             |
| security (IBAN anti-fraud) | `security/` (NEW w/ `simple-iban`)          |
| audit (hash-chaining)     | `audit/` (NEW)                                |
| integrations              | `integrations/` (grok)                        |
| ai (copilot)              | `ai/` (deep-seek)                             |
| notifications             | `notifications/` (deep-seek)                  |
| export (ZIP/Excel/SAF-T validator) | `export/` (deep-seek + NEW SAF-T)    |

**All 19 requested modules are mapped.** Three (`payroll`, `fleet`, `tax-simulator`) are greenfield builds; the rest have a primary source repo and a port plan.

---

## 6. Next steps (out of skeleton scope)

1. `prisma/schema.prisma` consolidating all entities (`Tenant`, `User`, `Role`, `Document`, `OcrJob`, `BankAccount`, `Statement`, `Transaction`, `Party`, `Payable`, `PayrollRun`, `Vehicle`, `CrmDeal`, `AccountingRule`, `Integration`, `Notification`, `AuditEvent`, `ApiKey`, `Session`, …).
2. `nest g module <name>` for every module in §1.
3. Wire `AuthModule` JwtAuthGuard globally via `APP_GUARD` (currently placeholder).
4. Add pino / OpenTelemetry / Sentry / Prometheus (noted in §3.4).
5. E2E test scaffold in `apps/api/test/` with supertest against a docker-compose Postgres + Redis + MinIO.