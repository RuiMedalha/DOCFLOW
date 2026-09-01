import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenancy context. Populated by TenantMiddleware AFTER the JWT has
 * been verified (so we always read from a trusted source) and consumed by the
 * Prisma extension to auto-inject `tenantId` into every multi-tenant query.
 *
 * Using AsyncLocalStorage means services can call Prisma directly without
 * threading `req` through every method — the context follows the async call
 * chain naturally. Nest's request-scoped DI works too, but ALS keeps things
 * fast and avoids the request-scoped-per-injection overhead.
 */
export interface TenantRequestContext {
  tenantId: string;
  userId: string;
  roles: string[];
  requestId: string;
  /** Original JWT session id — useful for audit log correlation. */
  sessionId?: string;
}

export const TenantContextStorage = new AsyncLocalStorage<TenantRequestContext>();

export const getTenantContext = (): TenantRequestContext | undefined =>
  TenantContextStorage.getStore();

/**
 * Throws when called outside of a request lifecycle. Use this at the entry of
 * any service that must operate inside an authenticated tenant boundary — it
 * is the runtime counterpart to the TenantGuard compile-time guarantee.
 */
export function requireTenantContext(): TenantRequestContext {
  const ctx = TenantContextStorage.getStore();
  if (!ctx?.tenantId) {
    throw new Error(
      'TenantContext missing: this code path requires TenantMiddleware to have run. ' +
        'Check that the route is not decorated with @Public() without an explicit override.',
    );
  }
  return ctx;
}

/**
 * Sets/clears the active tenant context. Exposed mainly for tests and for the
 * TenantMiddleware itself; production code should never need to call this.
 */
export function runWithTenantContext<T>(
  ctx: TenantRequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return TenantContextStorage.run(ctx, fn);
}
