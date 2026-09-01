import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DocFlowJwtPayload } from '../guards/jwt.guard';
import { runWithTenantContext } from '../context/tenant-context';

/**
 * Nest runs middleware BEFORE guards, so JwtGuard has not attached `req.user`
 * yet when this runs. We verify the Bearer token here (same JwtService /
 * issuer / audience as JwtGuard) so AsyncLocalStorage is bound for the
 * remainder of the request — including Prisma tenant scoping in controllers.
 *
 * JwtGuard still re-verifies and remains the 401 authority.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(private readonly jwt: JwtService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Trust the X-Request-Id from upstream proxies (load balancer, gateway).
    // Otherwise mint a UUID v4. Echo it back so the caller can correlate.
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    if (!req.user) {
      const authorization = req.headers.authorization;
      const token =
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : undefined;
      if (token) {
        try {
          const payload = this.jwt.verify<DocFlowJwtPayload>(token);
          // Dual-shape: JWT claims (tenant_id/sub/roles) + CurrentUser
          // (tenantId/id/role) so guards and controllers agree.
          req.user = {
            ...payload,
            id: payload.sub,
            tenantId: payload.tenant_id,
            role: payload.roles?.[0],
          };
        } catch {
          // Invalid/expired token: leave unauthenticated. JwtGuard returns 401.
        }
      }
    }

    const user = req.user as (DocFlowJwtPayload & { tenantId?: string; id?: string }) | undefined;
    if (!user?.tenant_id || !user?.sub) {
      // Either an unauthenticated public route (e.g. /auth/login) or a route
      // skipped by @Public(). Either way, nothing to scope. Continue without
      // an ALS frame so the Prisma extension knows to reject tenant queries.
      return next();
    }

    // Optional hint header — must match the JWT. A wrong value means a stale
    // session cookie was reused against a tenant that has changed.
    const requestedTenant = req.headers['x-tenant-id'];
    if (typeof requestedTenant === 'string' && requestedTenant !== user.tenant_id) {
      this.logger.warn(
        `x-tenant-id header (${requestedTenant}) does not match JWT tenant (${user.tenant_id}); requestId=${requestId}`,
      );
      throw new ForbiddenException('Tenant header does not match session');
    }

    req.tenantId = user.tenant_id;

    runWithTenantContext(
      {
        tenantId: user.tenant_id,
        userId: user.sub,
        roles: user.roles ?? [],
        requestId,
        sessionId: user.sid,
      },
      () => next(),
    );
  }
}
