/**
 * Helpers used by the Prisma tenant-scope extension. Extracted into a
 * separate module so unit tests can exercise them directly without spinning
 * up a PrismaClient.
 *
 * NOT part of the public API — feature modules should never need these.
 */

/**
 * Merge `tenantId: <active>` into an existing Prisma `where` clause.
 * If the caller already filtered by a DIFFERENT tenantId, we still write
 * ours and Prisma's AND will force the row to disappear. This is the
 * intentional defense-in-depth behavior: a row that matches the caller's
 * filter but not the active tenant MUST not be returned.
 */
export function mergeTenantFilter(
  where: unknown,
  tenantId: string,
): Record<string, unknown> {
  const w = (where ?? {}) as Record<string, unknown>;
  return { ...w, tenantId };
}

/**
 * Merge `tenantId: <active>` into a Prisma `data` payload.
 *
 * - On CREATE: if the caller set a DIFFERENT tenantId we throw — this
 *   blocks an authenticated tenant-A user from inserting rows into
 *   tenant-B.
 * - On UPDATE: tenantId is intentionally NOT touched. A row already
 *   belongs to a tenant and changing it would be a tenant-takeover.
 */
export function injectTenantId(
  data: unknown,
  tenantId: string,
  isUpdate = false,
): Record<string, unknown> {
  const d = (data ?? {}) as Record<string, unknown>;
  if (isUpdate) {
    return d;
  }
  if (d.tenantId && d.tenantId !== tenantId) {
    throw new Error(
      `Prisma tenant scope: refusing to create a row with tenantId=${String(
        d.tenantId,
      )} inside session tenantId=${tenantId}. Possible cross-tenant write attempt.`,
    );
  }
  return { ...d, tenantId };
}