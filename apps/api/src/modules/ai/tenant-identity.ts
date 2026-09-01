/**
 * Tenant-identity injection for vision prompts — the proven-pattern
 * safeguard against the supplier/customer swap regression that hit
 * the user's real Américo Alves invoice on 2026-09-01.
 *
 * The reference app (apps/api/src/app.service.ts:155 in
 * `gemini-documental`) prepends its prompt with the OWN-company
 * identity so the model knows which party is the buyer and which is
 * the supplier. We replicate that here:
 *
 *   "És o auditor contabilístico sénior da empresa adquirente
 *    <TENANT_NAME> (NIF PT<TENANT_NIF>). The party matching this NIF
 *    is the CUSTOMER/adquirente. The OTHER party is always the
 *    SUPPLIER/fornecedor. Never put our own company as the supplier."
 *
 * The PromptIdentity object is computed ONCE per extraction (the
 * `getTenantIdentity` cache key) and passed by reference into the
 * vision service. The vision service uses it to swap or amend
 * `SYSTEM_PROMPT` without needing to know about Prisma — keeping the
 * module boundaries clean.
 */

import { PrismaService } from '../../prisma/prisma.service';

export interface TenantIdentity {
  /** Tenant display name (trade name) — used in the prompt. */
  tenantName: string;
  /** Tenant NIF (Portuguese NIF, 9 digits) — used in the prompt. */
  tenantNif: string;
}

/**
 * Read tenant identity (name + NIF) with a graceful fallback chain:
 *
 *   1) DB: prisma.tenant.findUnique({ nif }) — preferred when set.
 *   2) Env: DOCFLOW_OWN_NIF + DOCFLOW_OWN_NAME — covers deployments
 *      where the demo tenant hasn't been customised (env-set values
 *      win so we don't depend on a seed run).
 *   3) Hard-coded demo default: 'NOV OUSADO UNIPESSOAL LDA' / '515208566'.
 *      This is the user's real demo tenant identity and the value the
 *      reference app ships with. Returning it as a last resort keeps
 *      the prompt populated rather than silently dropping the safeguard
 *      on a fresh DB.
 *
 * NEVER throws — when the DB is unreachable or returns null, we
 * degrade to env/default so extraction still proceeds.
 */
export async function getTenantIdentity(
  prisma: PrismaService,
  tenantId?: string,
): Promise<TenantIdentity> {
  // 1) DB read — prefer the tenant-bound row when we know the tenant,
  //    else fall through to picking the demo tenant.
  try {
    if (tenantId) {
      const t = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, nif: true },
      });
      if (t?.nif) {
        return { tenantName: t.name ?? 'demo', tenantNif: normalizeNif(t.nif) };
      }
    } else {
      // Demo tenant from seed.
      const t = await prisma.tenant.findFirst({
        where: { slug: 'demo' },
        select: { name: true, nif: true },
      });
      if (t?.nif) {
        return { tenantName: t.name ?? 'demo', tenantNif: normalizeNif(t.nif) };
      }
    }
  } catch {
    /* swallow — fall through to env/default */
  }

  // 2) Env overrides (single-tenant / SaaS deployments).
  const envNif = process.env.DOCFLOW_OWN_NIF;
  const envName = process.env.DOCFLOW_OWN_NAME;
  if (envNif && envNif.trim().length > 0) {
    return {
      tenantName: envName ?? 'Demo Tenant',
      tenantNif: normalizeNif(envNif),
    };
  }

  // 3) Hard-coded demo fallback — keeps the prompt populated on a
  //    fresh DB where the seed didn't run or the tenant doesn't have
  //    a NIF configured. The reference-app equivalent (gemini-documental)
  //    ships with the same fallback.
  return {
    tenantName: 'NOV OUSADO UNIPESSOAL LDA',
    tenantNif: '515208566',
  };
}

/**
 * Strip the country prefix and any non-digits from a NIF string.
 * Accepts "PT515208566", "515208566", "515 208 566", "PT 515208566"
 * and returns "515208566". Returns the input unchanged when it can't
 * locate 9 digits — non-PT VAT IDs (e.g. ESB12345678) would be
 * truncated differently but the demo tenant is always PT so this is
 * an acceptable corner case.
 */
export function normalizeNif(raw: string | undefined | null): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 9) return digits;
  // Allow PT-prefixed NIFs of length 11 (PT = 2 chars + 9 digits).
  if (digits.length === 11 && digits.startsWith('35')) {
    // "PT" + 9 digits → drop the country prefix.
    return digits.slice(2);
  }
  return digits;
}

/**
 * Format a NIF for inclusion in the prompt: `PT515208566`.
 * Strips any prior `PT` prefix and re-applies it so the model sees
 * the same shape as the AT QR codes / Portuguese VAT IDs.
 */
export function formatPtNif(nif: string | undefined | null): string {
  const digits = normalizeNif(nif);
  return digits.length === 9 ? `PT${digits}` : digits;
}
