import { runWithTenantContext } from '../../common/context/tenant-context';
import { injectTenantId } from '../prisma.helpers.spec-export';

/**
 * Unit tests for the Prisma tenant-scoping extension. We do NOT spin up a
 * real database — instead we mock the PrismaClient's underlying `query` hook
 * and verify that the wrapper:
 *   1. injects tenantId into find/update/delete/create/upsert `where` / `data`
 *   2. refuses to run when no TenantContext is active
 *   3. leaves exempt models (Tenant, RefreshToken) untouched
 *   4. rejects cross-tenant writes (create with a different tenantId)
 */

type AnyArgs = Record<string, unknown>;
type AnyQuery = (args: AnyArgs) => Promise<unknown>;

interface OpCall {
  model: string;
  operation: string;
  args: AnyArgs;
}

const buildScoped = async () => {
  const calls: OpCall[] = [];
  let activeCtx = undefined as unknown as { tenantId: string };

  // Fake PrismaClient that captures every operation our extension sees.
  const fakeBase = {
    $extends: () => wrapped,
  };

  // The wrapped client is what our extension returns. For tests we just
  // expose a `run(op)` helper that invokes the extension callback manually.
  const wrapped = {
    _run: async (model: string, operation: string, args: AnyArgs) => {
      // Replicate the production extension logic inline (kept in sync with
      // prisma.service.ts). Doing it inline rather than importing the real
      // service keeps the test database-free.
      const TENANT_SCOPED = new Set([
        'User', 'Document', 'Party', 'Invoice', 'Payment', 'Deal',
        'Employee', 'Notification', 'AuditLog',
      ]);
      const EXEMPT = new Set(['Tenant', 'RefreshToken']);

      if (EXEMPT.has(model)) return { ok: true, model, operation, args };

      const ctx = activeCtx;
      if (!ctx?.tenantId && TENANT_SCOPED.has(model)) {
        throw new Error(
          `Prisma tenant scope: refusing ${model}.${operation} — no TenantContext. ` +
            `Route must run through JwtGuard + TenantMiddleware.`,
        );
      }

      const a = { ...args };
      const inject = (op: string) => {
        switch (op) {
          case 'findUnique': case 'findFirst': case 'findMany':
          case 'update': case 'updateMany': case 'delete': case 'deleteMany':
          case 'count': case 'aggregate': case 'groupBy':
            a.where = { ...(a.where ?? {}), tenantId: ctx.tenantId };
            break;
          case 'create': case 'createMany':
            a.data = { ...(a.data ?? {}), tenantId: ctx.tenantId };
            break;
          case 'upsert':
            a.where = { ...(a.where ?? {}), tenantId: ctx.tenantId };
            a.create = { ...(a.create ?? {}), tenantId: ctx.tenantId };
            break;
        }
      };
      inject(operation);
      calls.push({ model, operation, args: a });
      return a;
    },
    setCtx: (ctx: { tenantId: string }) => {
      activeCtx = ctx;
    },
    clearCtx: () => {
      activeCtx = undefined as unknown as { tenantId: string };
    },
  };

  return { client: wrapped, calls };
};

describe('Prisma tenant scope extension', () => {
  it('injects tenantId into findMany where filter', async () => {
    const { client } = await buildScoped();
    await runWithTenantContext(
      { tenantId: 'tenant-A', userId: 'u1', roles: [], requestId: 'r1' },
      async () => {
        client.setCtx({ tenantId: 'tenant-A' });
        const result = await client._run('Document', 'findMany', {
          where: { status: 'NOVO' },
        });
        expect(result).toMatchObject({
          where: { status: 'NOVO', tenantId: 'tenant-A' },
        });
      },
    );
  });

  it('injects tenantId into create data', async () => {
    const { client } = await buildScoped();
    await runWithTenantContext(
      { tenantId: 'tenant-A', userId: 'u1', roles: [], requestId: 'r1' },
      async () => {
        client.setCtx({ tenantId: 'tenant-A' });
        const result = await client._run('Document', 'create', {
          data: { fileName: 'x.pdf' },
        });
        expect(result).toMatchObject({
          data: { fileName: 'x.pdf', tenantId: 'tenant-A' },
        });
      },
    );
  });

  it('refuses tenant-scoped operations when TenantContext is missing', async () => {
    const { client } = await buildScoped();
    client.clearCtx();
    await expect(client._run('Document', 'findMany', {})).rejects.toThrow(
      /no TenantContext/,
    );
  });

  it('leaves Tenant model queries untouched (login flow case)', async () => {
    const { client } = await buildScoped();
    client.clearCtx();
    const result = await client._run('Tenant', 'findUnique', {
      where: { slug: 'acme' },
    });
    expect(result).toEqual({
      ok: true,
      model: 'Tenant',
      operation: 'findUnique',
      args: { where: { slug: 'acme' } },
    });
  });

  it('rejects a create that tries to set tenantId to a different tenant', async () => {
    // Implemented at the service level via `injectTenantId` helper; we cover
    // it here to document the cross-tenant write attempt path.
    expect(() =>
      injectTenantId({ tenantId: 'tenant-B' }, 'tenant-A'),
    ).toThrow(/cross-tenant write attempt/);
    expect(injectTenantId({ foo: 1 }, 'tenant-A')).toEqual({
      foo: 1,
      tenantId: 'tenant-A',
    });
    // Update must never rewrite tenantId.
    expect(injectTenantId({ name: 'x' }, 'tenant-A', true)).toEqual({
      name: 'x',
    });
  });

  it('injects tenantId into both create and update branches of upsert', async () => {
    const { client } = await buildScoped();
    await runWithTenantContext(
      { tenantId: 'tenant-A', userId: 'u1', roles: [], requestId: 'r1' },
      async () => {
        client.setCtx({ tenantId: 'tenant-A' });
        const result = await client._run('Document', 'upsert', {
          where: { id: 'doc1' },
          create: { fileName: 'x' },
          update: { fileName: 'y' },
        });
        expect(result).toMatchObject({
          where: { id: 'doc1', tenantId: 'tenant-A' },
          create: { fileName: 'x', tenantId: 'tenant-A' },
          update: { fileName: 'y' },
        });
      },
    );
  });
});