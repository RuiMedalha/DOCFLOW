import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DocFlowJwtPayload } from './jwt.guard';

/**
 * Binds the request to the tenant asserted by the verified access token.
 * A client-supplied `x-tenant-id` header is only a routing hint and must
 * match the token — this catches a stale session cookie being replayed
 * against a tenant the user no longer belongs to.
 *
 * The actual per-query tenant filter is enforced by the Prisma extension
 * (`prisma.service.ts`), so this guard is the FIRST line of defense: if
 * the JWT says you belong to tenant A, you can't even reach a controller
 * for tenant B.
 *
 * Routes marked @Public() skip this check entirely (login, health, etc.).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as DocFlowJwtPayload | undefined;
    if (!user?.tenant_id) {
      throw new ForbiddenException('Tenant claim required');
    }

    const requestedTenant = request.headers['x-tenant-id'];
    if (
      typeof requestedTenant === 'string' &&
      requestedTenant !== user.tenant_id
    ) {
      throw new ForbiddenException('Tenant mismatch');
    }

    request.tenantId = user.tenant_id;
    return true;
  }
}