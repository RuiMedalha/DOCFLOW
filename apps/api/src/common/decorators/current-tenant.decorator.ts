import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantRequestContext, getTenantContext } from '../context/tenant-context';

/**
 * Resolves the active tenant from the AsyncLocalStorage context populated by
 * TenantMiddleware. Use this in controllers / services that need the tenantId
 * explicitly (rare — the Prisma extension does it for you on every query).
 *
 *   @Get()
 *   list(@CurrentTenant() tenant: TenantRequestContext) {
 *     return this.svc.listFor(tenant.tenantId);
 *   }
 *
 * Returns `undefined` if called from a route marked @Public() that didn't go
 * through JWT verification. Use `requireTenantContext()` if missing-tenant
 * should throw.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): TenantRequestContext | undefined =>
    getTenantContext(),
);
