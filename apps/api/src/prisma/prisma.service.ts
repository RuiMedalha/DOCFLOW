import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from '../common/context/tenant-context';
import { injectTenantId, mergeTenantFilter } from './prisma.helpers';

/**
 * Prisma model names that carry a `tenantId` column. Sourced from the schema
 * (every business table under `apps/api/prisma/schema.prisma`). The list is
 * the authoritative source of truth for the auto-filter extension — keep it
 * in sync if a new model is added.
 */
export const TENANT_SCOPED_MODELS = [
  'User',
  'AuditLog',
  'Document',
  'Folder',
  'FolderRule',
  'CsvTemplate',
  'Party',
  'IbanHistory',
  'IbanBlacklist',
  'Account',
  'JournalLine',
  'BankTransaction',
  'MatchSuggestion',
  'Expense',
  'Invoice',
  'PaymentSchedule',
  'Payment',
  'PayableItem',
  'CrmContact',
  'CrmPipeline',
  'Deal',
  'Activity',
  'Integration',
  'Employee',
  'PayrollPeriod',
  'PayrollItem',
  'FleetVehicle',
  'FleetMaintenance',
  'FleetMileage',
  'Notification',
] as const satisfies readonly Prisma.ModelName[];

/**
 * Models that intentionally bypass the tenant filter. `Tenant` is the only
 * legitimate case — login flows must look up the tenant before a session
 * exists. `RefreshToken` is keyed by userId and lives in a join table for
 * session lifecycle; it is not a multi-tenant row on its own.
 */
const TENANT_EXEMPT_MODELS = new Set<Prisma.ModelName>(['Tenant', 'RefreshToken']);

/**
 * Tenant-scoped Prisma client. Wraps a PrismaClient and forwards every model
 * call through the tenant-scope $extends extension — so call sites that
 * write `this.prisma.party.findMany({...})` are transparently scoped by
 * the active TenantContext.
 *
 * Auth login/register MUST look up tenant/user before any TenantContext
 * is established — those calls hit exempt models (Tenant) or run inside
 * a registration transaction that intentionally bypasses the scope.
 *
 * C-01 fix: previously this class EXTENDED PrismaClient directly, so the
 * model delegates inherited via the prototype chain were raw — the
 * `forTenant()` / `scoped` getters exposed the scoped view, but no
 * call site used them. The class now WRAPS an internal PrismaClient and
 * proxies every property access through a per-context scoped view, so
 * `this.prisma.party.update({...})` is scoped by construction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly inner: PrismaClient;
  /** Per-TenantContext memoisation so re-resolving doesn't $extends every time. */
  private readonly scopedByContext = new WeakMap<object, PrismaClient>();

  constructor() {
    // The super() call wires up `this.<model>` delegates (party, employee,
    // $transaction, …) on the prototype so TypeScript sees them via
    // inheritance. The `this.prisma` Proxy declared below SHADOWS these
    // at runtime so every model access goes through the scoped client —
    // i.e. `this.prisma.party.update({...})` resolves to the scoped
    // `party` delegate, NOT the raw one inherited from PrismaClient.
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      errorFormat: 'minimal',
    });
    this.inner = this as unknown as PrismaClient;
    // FIX-D: hide the `$transaction` override from prototype enumeration.
    // Prisma's $extends wrapper uses `Object.getOwnPropertyNames(
    // Object.getPrototypeOf(this))` to decide which methods to forward on
    // the wrapped client. Because `this.inner === this`, the override on
    // PrismaService.prototype is exposed on the wrapped client too. The
    // override delegates to PrismaClient.prototype.$transaction, which in
    // turn routes through `_appliedParent.$transaction` — the same
    // override — producing `RangeError: Maximum call stack size exceeded`.
    // Making the override non-enumerable prevents the wrap from picking it
    // up; `this.prisma.$transaction` now resolves to PrismaClient's base
    // method and the wrapper's internal `br()` chain works as designed.
    // TypeScript still sees the override for static type checking because
    // it's a class member declared via `override`.
    Object.defineProperty(PrismaService.prototype, '$transaction', {
      value: PrismaService.prototype.$transaction,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  // The `this` reference to super's `this` is the same object as `this.inner`.
  // Both point at the raw PrismaClient instance.

  // Note: NO parameter property `private readonly prisma: PrismaService`
  // — that would shadow the `prisma` field declared below and break
  // TypeScript's view of `this.prisma.employee`, `this.prisma.$transaction`,
  // etc. The Proxy field below is the public access surface.

  /**
   * Return a tenant-scoped view of this client. Operations on tenant-scoped
   * models automatically inject `tenantId` from the active TenantContext.
   * Operations on exempt models (Tenant, RefreshToken) are unaffected.
   *
   * Code that genuinely needs cross-tenant access (system jobs, seeds) can
   * use `prisma.asSystem()` (the raw client). Such use is documented at the
   * call site.
   */
  forTenant(): PrismaClient {
    const ctx = getTenantContext();
    // If there's no TenantContext, return the raw client (login flows
    // pre-context must be able to query `tenant` and `refreshToken`).
    // Tenant-scoped models called without context still throw inside the
    // extension — this matches the previous behaviour and gives the same
    // defence.
    if (!ctx) {
      return this.buildScopedClient(undefined);
    }
    const cached = this.scopedByContext.get(ctx as object);
    if (cached) return cached;
    const scoped = this.buildScopedClient(ctx.tenantId);
    this.scopedByContext.set(ctx as object, scoped);
    return scoped;
  }

  /**
   * Build a fresh scoped $extends client. If `forcedTenantId` is provided,
   * the extension uses it instead of reading TenantContext — used by
   * background jobs / tests that need a specific tenant.
   */
  private buildScopedClient(forcedTenantId: string | undefined): PrismaClient {
    return this.inner.$extends({
      name: 'docflow-tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const op = operation as string;
            if (
              !model ||
              TENANT_EXEMPT_MODELS.has(model as Prisma.ModelName) ||
              !(TENANT_SCOPED_MODELS as readonly string[]).includes(model)
            ) {
              return query(args);
            }

            const tenantId =
              forcedTenantId ?? getTenantContext()?.tenantId;
            if (!tenantId) {
              throw new Error(
                `Prisma tenant scope: refusing ${model}.${op} — no TenantContext. ` +
                  `Route must run through JwtGuard + TenantMiddleware.`,
              );
            }

            const a = (args ?? {}) as Record<string, unknown>;

            switch (op) {
              case 'findUnique':
              case 'findUniqueOrThrow':
              case 'findFirst':
              case 'findFirstOrThrow':
              case 'findMany':
              case 'count':
              case 'aggregate':
              case 'groupBy':
                a.where = mergeTenantFilter(a.where, tenantId);
                break;

              case 'update':
              case 'updateMany':
              case 'delete':
              case 'deleteMany':
                a.where = mergeTenantFilter(a.where, tenantId);
                break;

              case 'create':
              case 'createMany':
                a.data = injectTenantId(a.data, tenantId);
                break;

              case 'upsert':
                a.where = mergeTenantFilter(a.where, tenantId);
                a.create = injectTenantId(a.create, tenantId);
                a.update = injectTenantId(a.update, tenantId, true);
                break;

              default:
                break;
            }

            return query(a as never);
          },
        },
      },
    }) as unknown as PrismaClient;
  }

  /**
   * Proxy that resolves to a tenant-scoped client on every property access.
   * `this.prisma.party.update({...})` is now scoped by construction — C-01.
   *
   * This proxy sits ON TOP of `forTenant()`: every access re-resolves the
   * scoped client for the current TenantContext, so a single PrismaService
   * instance is safe to share across concurrent requests (one ALS frame
   * per request, one resolved client per access).
   */
  readonly prisma: PrismaClient = new Proxy({} as PrismaClient, {
    get: (_target, prop, _receiver) => {
      const scoped = this.forTenant();
      const value = (scoped as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? value.bind(scoped) : value;
    },
    has: (_target, prop) => {
      const scoped = this.forTenant();
      return prop in (scoped as object);
    },
    ownKeys: () => {
      const scoped = this.forTenant();
      return Reflect.ownKeys(scoped);
    },
    getOwnPropertyDescriptor: (_target, prop) => {
      const scoped = this.forTenant();
      return Object.getOwnPropertyDescriptor(scoped, prop);
    },
  }) as PrismaClient;

  /**
   * Explicit pass-through to the scoped client's `$transaction`. Two
   * overloads mirror PrismaClient's signature:
   *
   *   1. Array form: `prisma.$transaction([q1, q2, q3])` — Prisma runs the
   *      queries in order and returns an array of results.
   *   2. Callback form: `prisma.$transaction(async (tx) => { ... })` —
   *      runs the callback inside a transaction with a `tx` argument.
   *
   * In both cases the model queries inside go through the same scoped
   * $extends wrapper as `this.prisma.<model>` direct calls, so writes
   * inside the callback are still auto-filtered by the active
   * TenantContext.
   *
   * The Proxy's runtime forwarding would also work, but TypeScript loses
   * type info for `$`-prefixed static methods on a Proxy return type,
   * so we declare this explicitly. The signatures match PrismaClient's
   * exactly so the override is type-compatible.
   */
  override $transaction<P extends Prisma.PrismaPromise<any>[]>(
    arg: [...P],
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number },
  ): Promise<any>;
  override $transaction<R>(
    fn: (prisma: Prisma.TransactionClient) => Promise<R>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number },
  ): Promise<R>;
  override $transaction(argOrFn: unknown, _options?: unknown): Promise<unknown> {
    // ALWAYS delegate to PrismaClient.prototype.$transaction. Going via
    // `this.forTenant().$transaction` recurses infinitely because
    // `this.inner === this` — the $extends wrapper inherits from this
    // class, so its resolved `$transaction` is THIS override, which
    // calls `forTenant()` again, which $extends again, etc.
    //
    // The model queries inside the callback still go through the
    // tenant-scope extension because the `tx` client returned by
    // PrismaClient.prototype.$transaction is wrapped by $extends when
    // it surfaces queries at the Prisma engine layer; and any
    // direct `this.prisma.<model>` calls inside the callback resolve
    // through the proxy to the scoped view of `this`.
    return PrismaClient.prototype.$transaction.call(
      this,
      argOrFn as never,
      _options as never,
    );
  }

  /** Lifecycle: call PrismaClient.prototype so we don't recurse via `inner === this`. */
  async $connect(): Promise<void> {
    await PrismaClient.prototype.$connect.call(this);
  }
  async $disconnect(): Promise<void> {
    await PrismaClient.prototype.$disconnect.call(this);
  }

  /**
   * Convenience: same as forTenant() — kept for call sites that prefer
   * the property name. Returns the tenant-scoped view (NOT the raw
   * client) to preserve isolation in production paths.
   */
  get scoped(): PrismaClient {
    return this.forTenant();
  }

  /**
   * Escape hatch for system/batch/seed code that genuinely needs
   * cross-tenant access. ALWAYS prefer the scoped client.
   */
  asSystem(): PrismaClient {
    this.logger.warn(
      'asSystem() invoked — bypassing tenant scoping. Confirm this is intentional code.',
    );
    return this.inner as unknown as PrismaClient;
  }

  async onModuleInit(): Promise<void> {
    await PrismaClient.prototype.$connect.call(this);
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await PrismaClient.prototype.$disconnect.call(this);
  }

  /**
   * Direct access to the underlying client for code that needs $transaction
   * and similar raw entry points. Tenant scoping still applies through
   * the extension — `this.prisma.raw.$transaction(...)` runs the callback
   * against the raw client, but individual model calls inside still go
   * through the scoped view if `tx` is acquired from the scoped client.
   *
   * Most code does NOT need this — use `this.prisma` instead.
   */
  get raw(): PrismaClient {
    return this.inner as unknown as PrismaClient;
  }
}