# Wave 3 — Playwright critical-path suite

API-level end-to-end tests for DocFlow (`/api/v1`). No browser is required.

```powershell
cd apps/api
pnpm exec playwright test --config e2e/playwright.config.ts
```

Reports:

- HTML: `apps/api/test-results/e2e-html/index.html`
- JSON: `apps/api/test-results/e2e-results.json`
- Readiness: `apps/api/test-results/PRODUCTION_READINESS.md`
- Perf: `apps/api/test-results/performance-baseline.json`

Requires a running API (`http://localhost:4000`) and Postgres. Redis may be down — extraction falls back in-process.
