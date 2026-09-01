import { createHmac } from 'crypto';
import { JWT_AUDIENCE, JWT_ISSUER } from './env';

function b64url(input: string | object): string {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(raw).toString('base64url');
}

export function signHs256(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function forgeAccessToken(opts: {
  secret: string;
  sub?: string;
  tenantId?: string;
  roles?: string[];
  expired?: boolean;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(
    {
      sub: opts.sub ?? '00000000-0000-4000-8000-000000000001',
      tenant_id: opts.tenantId ?? 'tenant-forged',
      roles: opts.roles ?? ['ADMIN'],
      sid: 'sid-forged',
      jti: 'jti-forged',
      iat: now - 120,
      exp: opts.expired ? now - 60 : now + 900,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    },
    opts.secret,
  );
}
