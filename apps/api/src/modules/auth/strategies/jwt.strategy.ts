import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocFlowJwtPayload } from '../../../common/guards/jwt.guard';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
}

/**
 * Verifies the access token signature + exp + audience/issuer, then loads the
 * current User so revoked accounts cannot ride on a still-valid token. We use
 * the same JwtService that signed the token (symmetric secret in dev; rotate
 * to RS256 + JWKS in production).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_ACCESS_SECRET') ?? config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET (or JWT_SECRET) env var is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
      issuer: config.get<string>('JWT_ISSUER') ?? 'docflow',
      audience: config.get<string>('JWT_AUDIENCE') ?? 'docflow-api',
    });
  }

  async validate(payload: DocFlowJwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        isActive: true,
        twoFactorEnabled: true,
        deletedAt: true,
      },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.tenantId !== payload.tenant_id) {
      throw new UnauthorizedException('Tenant mismatch');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      isActive: user.isActive,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }
}
