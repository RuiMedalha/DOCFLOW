import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface DocFlowJwtPayload {
  sub: string;
  tenant_id: string;
  roles: string[];
  sid: string;
  jti: string;
  /** Aliases populated after verify so @CurrentUser (id/tenantId/role) works. */
  id?: string;
  tenantId?: string;
  role?: string;
}

/**
 * Access-token guard. The JwtService must be configured with issuer, audience,
 * allowed algorithms and asymmetric public keys; never accept an algorithm
 * from the token header. Refresh tokens are deliberately not accepted here.
 *
 * Routes decorated with @Public() skip verification entirely — the rest of
 * the request (TenantGuard, controllers) must remain safe without auth.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    const token =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;

    if (!token) throw new UnauthorizedException('Authentication required');

    try {
      const payload = await this.jwtService.verifyAsync<DocFlowJwtPayload>(token);
      // Dual-shape so TenantGuard (tenant_id/roles) and @CurrentUser
      // (id/tenantId/role) both work off the same object.
      request.user = {
        ...payload,
        id: payload.sub,
        tenantId: payload.tenant_id,
        role: payload.roles?.[0],
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
