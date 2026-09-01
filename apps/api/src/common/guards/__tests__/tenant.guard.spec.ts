import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from '../tenant.guard';
import { Public } from '../../decorators/public.decorator';
import { DocFlowJwtPayload } from '../jwt.guard';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  const makeContext = (
    opts: {
      user?: DocFlowJwtPayload;
      headers?: Record<string, string>;
      handler?: (...args: unknown[]) => unknown;
      klass?: new (...args: unknown[]) => unknown;
    } = {},
  ): ExecutionContext => {
    const req = { user: opts.user, headers: opts.headers ?? {} };
    const res = {};
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getHandler: () => opts.handler ?? (() => undefined),
      getClass: () => opts.klass ?? class {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    guard = new TenantGuard(new Reflector());
  });

  it('passes when JWT carries a tenant_id and no x-tenant-id header is set', () => {
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: 'tenant-A',
        roles: ['OPERADOR'],
        sid: 'sess-1',
        jti: 'jti-1',
      },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('attaches tenantId to the request for downstream consumers', () => {
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: 'tenant-A',
        roles: ['OPERADOR'],
        sid: 'sess-1',
        jti: 'jti-1',
      },
    });
    guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as { tenantId?: string };
    expect(req.tenantId).toBe('tenant-A');
  });

  it('rejects when JWT is missing a tenant_id claim', () => {
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: '' as unknown as string,
        roles: [],
        sid: 'sess-1',
        jti: 'jti-1',
      },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user', () => {
    const ctx = makeContext({ user: undefined });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when x-tenant-id header does NOT match the JWT tenant', () => {
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: 'tenant-A',
        roles: ['OPERADOR'],
        sid: 'sess-1',
        jti: 'jti-1',
      },
      headers: { 'x-tenant-id': 'tenant-B' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('passes when x-tenant-id header matches the JWT tenant (idempotent hint)', () => {
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: 'tenant-A',
        roles: ['OPERADOR'],
        sid: 'sess-1',
        jti: 'jti-1',
      },
      headers: { 'x-tenant-id': 'tenant-A' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('skips entirely when the route is decorated @Public()', () => {
    class PublicHandler {
      @Public()
      handler() {
        return undefined;
      }
    }
    const ctx = makeContext({
      user: undefined,
      handler: new PublicHandler().handler,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('prevents cross-tenant impersonation via header spoofing', () => {
    // Simulates an attacker who holds a valid tenant-A JWT but tries to read
    // tenant-B resources by lying to the API via x-tenant-id.
    const ctx = makeContext({
      user: {
        sub: 'u1',
        tenant_id: 'tenant-A',
        roles: ['ADMIN'],
        sid: 'sess-1',
        jti: 'jti-1',
      },
      headers: { 'x-tenant-id': 'tenant-B' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});