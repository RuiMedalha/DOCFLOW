import { JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Blocklist of well-known dev / placeholder prefixes that MUST never appear
 * in a production secret. Lower-case matched against `secret.toLowerCase()`.
 */
const FORBIDDEN_SECRET_PREFIXES = ['dev-', 'test-', 'change-', 'secret-', 'placeholder-', 'example-'];
const MIN_SECRET_LENGTH = 32;

/**
 * Validate a secret at boot time. Refuses well-known dev values and any
 * string shorter than {@link MIN_SECRET_LENGTH} bytes. Throws on failure —
 * the goal is fail-fast, NOT silently fall back to a default.
 */
export function assertStrongSecret(secret: string | undefined, name: string): asserts secret is string {
  if (!secret || secret.length === 0) {
    throw new Error(`${name} is required — refusing to start with an empty secret.`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters long ` +
        `(got ${secret.length}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
    );
  }
  const lower = secret.toLowerCase();
  for (const prefix of FORBIDDEN_SECRET_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error(
        `${name} starts with "${prefix}" — refusing to use a known-development placeholder ` +
          `value in production. Rotate the secret before deploying.`,
      );
    }
  }
}

/**
 * Shared JWT configuration used by both CommonModule (for JwtGuard global)
 * and AuthModule (for token signing). Single source of truth for issuer,
 * audience, algorithm and expiry — keeps token validation consistent
 * with token issuance.
 *
 * Boots fail-fast on weak or placeholder secrets — see {@link assertStrongSecret}.
 */
export const buildJwtConfig = (
  configService: ConfigService,
): JwtModuleOptions => {
  const accessSecret =
    configService.get<string>('JWT_ACCESS_SECRET') ||
    configService.get<string>('JWT_SECRET');
  assertStrongSecret(accessSecret, 'JWT_ACCESS_SECRET (or JWT_SECRET)');

  return {
    secret: accessSecret,
    signOptions: {
      algorithm: 'HS256',
      issuer: configService.get<string>('JWT_ISSUER') || 'docflow',
      audience: configService.get<string>('JWT_AUDIENCE') || 'docflow-api',
      expiresIn: (configService.get<string>('JWT_ACCESS_TTL') || '15m') as any,
    },
  };
};