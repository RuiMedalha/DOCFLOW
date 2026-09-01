# Wave 3 — Critical gaps (from live probes + Playwright)

1. Tenant ALS not bound before JWT (Nest middleware order). **Patched in source; must deploy.** Pre-patch GET `/parties` leaked another tenant.
2. JWT payload (`sub`, `tenant_id`) vs `@CurrentUser` (`id`, `tenantId`). **Patched.**
3. Prisma `$connect` / `$transaction` recursion when `inner === this`. **Patched.**
4. Migration `20260831000000_*` fails: duplicate empty `audit_logs.rowHash`.
5. Redis down is not crash-safe (ioredis unhandled).
6. Login throttle 5/15min per IP + global 100/min — shared NAT / bot flood locks the API.
7. No HTTP API to set tenant IBAN (SEPA blocked).
8. Matcher skips payables without `documentId`.
9. No resumable upload; Playwright/multer E2E still cannot attach `file`.
10. Seed IBANs fail MOD-97 (`packages/shared` comment).
