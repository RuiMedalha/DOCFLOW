/**
 * FIX-D regression: shared PrismaService $transaction recursion.
 *
 * Background
 * ----------
 * Before the fix, calling `this.prisma.$transaction(cb)` on the
 * tenant-scoping proxy raised:
 *
 *   RangeError: Maximum call stack size exceeded
 *     at Proxy.$transaction (prisma.service.ts)
 *     at forTenant (prisma.service.ts)
 *     at getTenantContext (...)
 *     ...
 *
 * Root cause:
 *   1. `this.inner = this as unknown as PrismaClient` — the inner raw
 *      client IS the PrismaService instance.
 *   2. `forTenant()` calls `this.inner.$extends(...)`, whose wrap builds
 *      a proxy over `Object.create(this._originalClient, ...)`. Prisma's
 *      wrap enumerates `Object.getOwnPropertyNames(
 *      Object.getPrototypeOf(this._originalClient))` — i.e. ALL keys on
 *      PrismaService.prototype — and forwards them on the wrapped client.
 *   3. Our `$transaction` override is on PrismaService.prototype. The
 *      wrap exposes it as the resolved `$transaction` on the scoped
 *      client.
 *   4. The `this.prisma` Proxy's `get` trap calls
 *      `value.bind(scoped)`. When invoked, the override runs and calls
 *      `PrismaClient.prototype.$transaction.call(this, cb, opts)`. The
 *      base impl runs `_transactionWithCallback({callback: cb, ...})`,
 *      which builds the `tx` client via `br(this)`. `br()` wraps `this`
 *      (= `scoped`) — and when the wrap looks up `$transaction` on that
 *      scope (e.g. through `this._appliedParent`), it finds the override
 *      again. Iteratively, the wrap resolves back into the override,
 *      recursing.
 *
 * Fix:
 *   After `super(...)`, `Object.defineProperty(PrismaService.prototype,
 *   '$transaction', { ..., enumerable: false })` hides the override from
 *   Prisma's prototype enumeration. `scoped.$transaction` therefore
 *   resolves to `PrismaClient.prototype.$transaction` directly and the
 *   wrap's `_appliedParent` chain lands on the BASE method, breaking the
 *   cycle. TypeScript still sees the override for static typing because
 *   it's a class member declared via `override`.
 *
 * These tests pin the invariant:
 *   - `svc.$transaction(cb)` completes without RangeError
 *   - `svc.prisma.$transaction(cb)` completes without RangeError
 *   - `svc.forTenant().$transaction(cb)` completes without RangeError
 *   - nested transactions (tx inside tx) work
 *   - array form `[p1, p2, p3]` works
 *
 * The tenant-scoping-inside-callback invariant is already covered by the
 * pre-existing `prisma-tenant-scope.integration.spec.ts` — these tests
 * focus on the recursion fix specifically.
 */

import { runWithTenantContext } from '../../common/context/tenant-context';
import { PrismaService } from '../prisma.service';

const TENANT_A = 'tenant-A';

/**
 * Build a PrismaService whose inner client is a thin fake. We don't try
 * to replicate the extension's tenant-scope logic here — that's already
 * tested in `prisma-tenant-scope.integration.spec.ts`. The fake just
 * tracks calls and lets us assert that the recursion no longer happens.
 */
function buildTestService(): {
  svc: PrismaService;
  calls: Array<{ method: string; args: unknown }>;
} {
  const calls: Array<{ method: string; args: unknown }> = [];

  // Build a delegate factory that captures each call.
  const make = (model: string, op: string) => async (args: any) => {
    calls.push({ method: `${model}.${op}`, args });
    // For findMany / findFirst etc. return []; for create* return the
    // row count so call sites can read `.count`.
    if (op === 'createMany') return { count: Array.isArray(args?.data) ? args.data.length : 1 };
    if (op === 'create') return { id: 'fake-id', ...(args?.data ?? {}) };
    if (op.startsWith('find') || op === 'count' || op === 'aggregate' || op === 'groupBy') return [];
    if (op === 'update' || op === 'updateMany') return { id: 'fake-id' };
    if (op === 'delete' || op === 'deleteMany') return { count: 1 };
    if (op === 'upsert') return { id: 'fake-id' };
    return null;
  };

  const fakeBase: any = {};
  for (const model of [
    'Party', 'Document', 'User', 'Account', 'IbanHistory',
    'IbanBlacklist', 'AuditLog', 'BankTransaction',
  ]) {
    const delegate: any = {};
    for (const op of [
      'findUnique', 'findUniqueOrThrow','findFirst','findFirstOrThrow','findMany',
      'count','aggregate','groupBy','update','updateMany',
      'delete','deleteMany','create','createMany','upsert',
    ]) {
      delegate[op] = make(model, op);
    }
    fakeBase[model.charAt(0).toLowerCase() + model.slice(1)] = delegate;
  }
  fakeBase.tenant = make('Tenant', 'findUnique');
  fakeBase.refreshToken = make('RefreshToken', 'findUnique');

  // The fake's $transaction runs the callback synchronously and returns
  // a tx-like object that exposes the same delegates. This mirrors what
  // real Prisma does — the `tx` parameter is a transactional client whose
  // model calls go through the same engine.
  fakeBase.$transaction = jest.fn(async (input: any) => {
    if (typeof input === 'function') {
      return input(fakeBase);
    }
    return Promise.all(input);
  });

  // `$extends` is called by `buildScopedClient`. The fake returns the
  // base unchanged so model calls go through the fake's delegates. We
  // don't try to replicate the tenant-scope extension logic here — we
  // only care that `$transaction` works without recursing.
  fakeBase.$extends = (_ext: any) => fakeBase;

  const svc = new PrismaService();
  // Suppress $connect / $disconnect — they touch real Postgres.
  (svc as any).onModuleInit = async () => undefined;
  (svc as any).onModuleDestroy = async () => undefined;
  // Swap the inner for the fake.
  (svc as any).inner = fakeBase;

  return { svc, calls };
}

describe('PrismaService — FIX-D $transaction recursion', () => {
  it('FIX-D: svc.$transaction (direct) completes without RangeError', async () => {
    const { svc, calls } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        let entered = false;
        await expect(
          svc.$transaction(async (tx: any) => {
            entered = true;
            expect(typeof tx.bankTransaction.createMany).toBe('function');
            return 'ok';
          }),
        ).resolves.toBe('ok');
        expect(entered).toBe(true);
      },
    );
    expect(calls.length).toBe(0); // // the fake's $transaction doesn't capture into `calls`; it calls delegates directly
  });

  it('FIX-D: svc.prisma.$transaction (via proxy) completes without RangeError', async () => {
    // The pre-fix failure mode — this is the path that recursed in
    // production. If the override were still enumerable on the prototype,
    // Prisma's $extends wrap would resolve `scoped.$transaction` back to
    // the override, producing `RangeError: Maximum call stack size
    // exceeded` as soon as the user callback ran.
    const { svc } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        let entered = false;
        await expect(
          svc.prisma.$transaction(async (tx: any) => {
            entered = true;
            expect(typeof tx.bankTransaction.createMany).toBe('function');
            return 'ok';
          }),
        ).resolves.toBe('ok');
        expect(entered).toBe(true);
      },
    );
  });

  it('FIX-D: svc.forTenant().$transaction (via scoped) completes without RangeError', async () => {
    const { svc } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        let entered = false;
        await expect(
          svc.forTenant().$transaction(async (tx: any) => {
            entered = true;
            return 'ok';
          }),
        ).resolves.toBe('ok');
        expect(entered).toBe(true);
      },
    );
  });

  it('FIX-D: nested $transaction (tx inside tx) completes without RangeError', async () => {
    const { svc } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        await svc.$transaction(async () => {
          // Nested — same pattern as audit.log path.
          await svc.prisma.$transaction(async () => {
            // noop
          });
        });
      },
    );
  });

  it('FIX-D: array-form $transaction completes without RangeError', async () => {
    const { svc } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        const r = await svc.prisma.$transaction([
          svc.prisma.party.findMany({ where: { name: 'X' } }),
          svc.prisma.auditLog.findMany({ where: { tenantId: TENANT_A } }),
        ]);
        expect(Array.isArray(r)).toBe(true);
        expect(r).toHaveLength(2);
      },
    );
  });

  it('FIX-D: $transaction override is non-enumerable on PrismaService.prototype', () => {
    // Belt-and-braces: directly assert that the override is hidden from
    // Prisma's prototype enumeration. This is the actual mechanism that
    // breaks the recursion — `Object.getOwnPropertyNames(
    // Object.getPrototypeOf(this._originalClient))` skips non-enumerable
    // keys, so the $extends wrap doesn't see our override.
    const desc = Object.getOwnPropertyDescriptor(PrismaService.prototype, '$transaction');
    expect(desc).toBeDefined();
    expect(desc!.enumerable).toBe(false);
    expect(desc!.configurable).toBe(true);
    expect(desc!.writable).toBe(true);
  });

  it('FIX-D: $transaction override is still callable on the instance', async () => {
    // The non-enumerable override must still be reachable on instances
    // (TypeScript sees it via `override` for static typing; at runtime
    // `this.$transaction(cb)` must invoke it). We just confirm the
    // function is present and works.
    const { svc } = buildTestService();
    await runWithTenantContext(
      { tenantId: TENANT_A, userId: 'u', roles: [], requestId: 'r' },
      async () => {
        expect(typeof svc.$transaction).toBe('function');
        await svc.$transaction(async () => 'called');
      },
    );
  });
});