import { test, expect } from '@playwright/test';
import { Api, unwrap } from '../helpers/api';
import { uniqueEmail, uniqueSlug } from '../helpers/pt-ids';
import { forgeAccessToken } from '../helpers/jwt';
import { JWT_ACCESS_SECRET } from '../helpers/env';

test.describe('Auth critical path @flow', () => {
  test('POST /auth/login issues JWT + refresh; /auth/me and refresh rotate @flow', async ({
    request,
  }) => {
    const api = new Api(request);
    const session = await api.registerTenant();

    const login = await api.timed('POST', '/auth/login', 500, {
      data: {
        email: session.email,
        password: session.password,
        tenantSlug: session.tenantSlug,
      },
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const loginData = unwrap<{
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
      user: { email: string; role: string; tenantId: string };
    }>(login.body);
    expect(loginData.tokens.accessToken.split('.')).toHaveLength(3);
    expect(loginData.tokens.refreshToken.length).toBeGreaterThan(20);
    expect(loginData.user.role).toBe('ADMIN');
    expect(loginData.user.tenantId).toBe(session.tenantId);

    const me = await api.json('POST', '/auth/me', { token: loginData.tokens.accessToken });
    expect(me.status).toBe(200);
    const meData = unwrap<{ email: string; tenant: { slug: string } }>(me.body);
    expect(meData.email).toBe(session.email);
    expect(meData.tenant.slug).toBe(session.tenantSlug);

    const refreshed = await api.data<{
      accessToken: string;
      refreshToken: string;
    }>('POST', '/auth/refresh', {
      data: { refreshToken: loginData.tokens.refreshToken },
    });
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(loginData.tokens.refreshToken);

    const oldRefresh = await api.json('POST', '/auth/refresh', {
      data: { refreshToken: loginData.tokens.refreshToken },
    });
    expect(oldRefresh.status).toBe(401);
  });

  test('invalid credentials return 401 without leaking tenant existence @flow @secrets', async ({
    request,
  }) => {
    const api = new Api(request);
    const session = await api.registerTenant();

    const badPass = await api.json<{ message: string; statusCode: number }>('POST', '/auth/login', {
      data: { email: session.email, password: 'WrongPass123!', tenantSlug: session.tenantSlug },
    });
    expect(badPass.status).toBe(401);
    expect(JSON.stringify(badPass.body).toLowerCase()).toContain('invalid credentials');
    expect(JSON.stringify(badPass.body)).not.toMatch(/stack|passwordHash|secret/i);

    const unknownTenant = await api.json('POST', '/auth/login', {
      data: {
        email: uniqueEmail('ghost'),
        password: 'Admin123!Secure',
        tenantSlug: uniqueSlug('nope'),
      },
    });
    expect(unknownTenant.status).toBe(401);
    expect(JSON.stringify(unknownTenant.body).toLowerCase()).toContain('invalid credentials');
  });

  test('expired token and wrong JWT secret are rejected with 401 @flow @rbac', async ({
    request,
  }) => {
    const api = new Api(request);
    const session = await api.registerTenant();

    const expired = forgeAccessToken({
      secret: JWT_ACCESS_SECRET || 'fallback-not-used-if-empty',
      sub: session.userId,
      tenantId: session.tenantId,
      expired: true,
    });
    const expiredRes = await api.json('POST', '/auth/me', { token: expired });
    expect(expiredRes.status).toBe(401);

    const wrongSecret = forgeAccessToken({
      secret: 'definitely-not-the-server-secret',
      sub: session.userId,
      tenantId: session.tenantId,
    });
    const wrong = await api.json('POST', '/auth/me', { token: wrongSecret });
    expect(wrong.status).toBe(401);

    const missing = await api.json('POST', '/auth/me');
    expect(missing.status).toBe(401);
  });
});
