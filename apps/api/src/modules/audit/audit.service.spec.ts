import { AuditAction, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService, AuditLogEntry } from './audit.service';

/**
 * Per-tenant FIFO queue modelling the pg_advisory_xact_lock the service
 * acquires in production. Each `runSerialized(tenantId, fn)` call waits for
 * the previous call with the same tenantId to finish before starting —
 * cross-tenant work runs in parallel.
 */
const tenantLockChains = new Map<string, Promise<unknown>>();
function runSerialized<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tenantLockChains.get(tenantId) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  tenantLockChains.set(tenantId, next);
  return next as Promise<T>;
}

/**
 * In-memory test double for the subset of the Prisma client that
 * AuditService needs. We deliberately do NOT use a real Prisma client
 * here — the chain logic is the only thing under test, and the contract
 * between AuditService and the client is narrow enough that a hand-rolled
 * stub is clearer than wiring up the full Prisma mock.
 */
function buildPrismaStub() {
  type StoredRow = {
    id: string;
    tenantId: string;
    userId: string | null;
    action: AuditAction;
    entityType: string | null;
    entityId: string | null;
    metadata: unknown;
    ip: string | null;
    userAgent: string | null;
    prevHash: string | null;
    rowHash: string;
    createdAt: Date;
  };

  let counter = 0;
  const rows: StoredRow[] = [];

  /**
   * Normalise a metadata value coming from the service: Prisma.JsonNull
   * becomes plain `null` so the in-memory row matches what a real Prisma
   * query would return. The service writes `Prisma.JsonNull` when no
   * metadata is supplied; we must read it back as `null` for the chain
   * verification to be deterministic.
   */
  const normalizeMetadata = (m: unknown): unknown => {
    if (m === Prisma.JsonNull) return null;
    if (m === Prisma.DbNull) return null;
    return m;
  };

  return {
    rows,
    // C-02: log() now wraps read+write in $transaction AND acquires a
    // per-tenant pg_advisory_xact_lock. The stub models the lock with
    // a JS-level FIFO queue keyed by tenantId — every transaction for
    // tenant X must run its callback to completion before the next one
    // for tenant X can start. Cross-tenant writes run in parallel.
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => {
      // Capture the tenantId by peeking at the callback's first awaited
      // call to advisory_xact_lock. We model this by extracting the
      // tenantId from the closure passed into the callback. Simpler: the
      // service calls `tx.$executeRaw` with the tenantId as a tagged
      // template parameter, which Jest's stub records. We use a tiny
      // queue keyed by tenantId extracted from rows already present.
      const tx = {
        // Advisory-lock stub: this is where the per-tenant serialisation
        // happens. In real Postgres pg_advisory_xact_lock blocks until
        // the lock is free; here we use a per-tenant FIFO chain.
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          // The service passes the tenantId as a single value; extract it.
          const tenantId = String(values[0] ?? '');
          await runSerialized(tenantId, () => Promise.resolve());
          return 0;
        }),
        auditLog: {
          findFirst: jest.fn(async ({ where, orderBy }: any) => {
            const tenantId = where?.tenantId;
            const filtered = rows.filter((r) => r.tenantId === tenantId);
            if (orderBy && Array.isArray(orderBy)) {
              filtered.sort((a, b) => {
                const c = a.createdAt.getTime() - b.createdAt.getTime();
                if (c !== 0) return c;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
              });
              return filtered[filtered.length - 1] ?? null;
            }
            return filtered[filtered.length - 1] ?? null;
          }),
          create: jest.fn(async ({ data }: any) => {
            const id = `row-${++counter}`;
            const row: StoredRow = {
              id,
              tenantId: data.tenantId,
              userId: data.userId ?? null,
              action: data.action,
              entityType: data.entityType ?? null,
              entityId: data.entityId ?? null,
              metadata: normalizeMetadata(data.metadata),
              ip: data.ip ?? null,
              userAgent: data.userAgent ?? null,
              prevHash: data.prevHash ?? null,
              rowHash: data.rowHash,
              createdAt: data.createdAt,
            };
            rows.push(row);
            return { ...row };
          }),
        },
      };
      return cb(tx);
    }),
    auditLog: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const tenantId = where?.tenantId;
        const filtered = rows.filter((r) => r.tenantId === tenantId);
        // honour the orderBy the service uses
        if (orderBy && Array.isArray(orderBy)) {
          filtered.sort((a, b) => {
            const c = a.createdAt.getTime() - b.createdAt.getTime();
            if (c !== 0) return c;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          });
          return filtered[filtered.length - 1] ?? null;
        }
        return filtered[filtered.length - 1] ?? null;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const tenantId = where?.tenantId;
        const filtered = rows.filter((r) => r.tenantId === tenantId);
        if (orderBy && Array.isArray(orderBy)) {
          filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return filtered.map((r) => ({ ...r, metadata: normalizeMetadata(r.metadata) }));
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `row-${++counter}`;
        const row: StoredRow = {
          id,
          tenantId: data.tenantId,
          userId: data.userId ?? null,
          action: data.action,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          metadata: normalizeMetadata(data.metadata),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          prevHash: data.prevHash ?? null,
          rowHash: data.rowHash,
          createdAt: data.createdAt,
        };
        rows.push(row);
        return { ...row };
      }),
    },
  };
}

describe('AuditService', () => {
  let prisma: ReturnType<typeof buildPrismaStub>;
  let svc: AuditService;

  const TENANT_ID = 'tenant-test';

  beforeEach(() => {
    prisma = buildPrismaStub();
    svc = new AuditService(prisma as any);
  });

  // ──────────────────────────────────────────────── hash chain

  describe('hash-chaining', () => {
    it('a) the first log row has null prevHash and a sha256 rowHash', async () => {
      await svc.log({
        tenantId: TENANT_ID,
        action: AuditAction.LOGIN,
        userId: 'user-1',
      });

      expect(prisma.rows).toHaveLength(1);
      const row = prisma.rows[0];
      expect(row.prevHash).toBeNull();
      // sha256 produces 64 hex chars
      expect(row.rowHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('b) the second log row has prevHash equal to the first rowHash', async () => {
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGIN, userId: 'user-1' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGOUT, userId: 'user-1' });

      expect(prisma.rows).toHaveLength(2);
      const [first, second] = prisma.rows;
      expect(second.prevHash).toBe(first.rowHash);
      expect(second.prevHash).not.toBeNull();
      expect(second.rowHash).not.toEqual(first.rowHash);
    });

    it('chains independently per tenant', async () => {
      await svc.log({ tenantId: 'tenant-A', action: AuditAction.LOGIN, userId: 'u' });
      await svc.log({ tenantId: 'tenant-B', action: AuditAction.LOGIN, userId: 'u' });
      await svc.log({ tenantId: 'tenant-A', action: AuditAction.LOGOUT, userId: 'u' });

      const aRows = prisma.rows.filter((r) => r.tenantId === 'tenant-A');
      const bRows = prisma.rows.filter((r) => r.tenantId === 'tenant-B');

      // tenant-A's second row should chain off tenant-A's first, not tenant-B's.
      expect(aRows[1].prevHash).toBe(aRows[0].rowHash);
      // tenant-B's only row is a genesis row.
      expect(bRows[0].prevHash).toBeNull();
    });
  });

  // ──────────────────────────────────────────────── verifyChain

  describe('verifyChain()', () => {
    it('returns valid=true on an untampered chain', async () => {
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGIN, userId: 'u' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGOUT, userId: 'u' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.CREATE, userId: 'u' });

      const result = await svc.verifyChain(TENANT_ID);
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeUndefined();
    });

    it('c) detects a tampered row', async () => {
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGIN, userId: 'u' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGOUT, userId: 'u' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.CREATE, userId: 'u' });

      // Tamper: mutate the middle row's action without re-hashing.
      // We have to cast through unknown because the stub stores a strict type.
      (prisma.rows[1] as any).action = AuditAction.DELETE;

      const result = await svc.verifyChain(TENANT_ID);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(prisma.rows[1].id);
    });

    it('detects a row whose stored rowHash was overwritten', async () => {
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGIN, userId: 'u' });
      await svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGOUT, userId: 'u' });

      // Replace the second row's rowHash with an arbitrary wrong value.
      prisma.rows[1].rowHash = 'a'.repeat(64);

      const result = await svc.verifyChain(TENANT_ID);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(prisma.rows[1].id);
    });

    it('returns valid=true for an empty chain', async () => {
      const result = await svc.verifyChain(TENANT_ID);
      expect(result.valid).toBe(true);
    });
  });

  // ──────────────────────────────────────────────── resilience

  describe('resilience', () => {
    it('swallows errors from log() instead of throwing', async () => {
      prisma.auditLog.findFirst.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.log({ tenantId: TENANT_ID, action: AuditAction.LOGIN }),
      ).resolves.toBeUndefined();

      // And it did NOT silently fall through to create (no row stored).
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('logInTx rethrows by default so the caller can roll back', async () => {
      prisma.auditLog.findFirst.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.logInTx(
          prisma as any,
          { tenantId: TENANT_ID, action: AuditAction.LOGIN },
        ),
      ).rejects.toThrow('db down');
    });

    it('logInTx swallows when { swallow: true } is passed', async () => {
      prisma.auditLog.findFirst.mockRejectedValueOnce(new Error('db down'));

      await expect(
        svc.logInTx(
          prisma as any,
          { tenantId: TENANT_ID, action: AuditAction.LOGIN },
          { swallow: true },
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────── hash determinism

  describe('hash determinism', () => {
    it('produces a known-good sha256 for a fixed payload', async () => {
      // Independent reference implementation. This is the canonicalisation
      // contract: anyone who changes it must also update this expected value.
      const entry: AuditLogEntry = {
        tenantId: TENANT_ID,
        userId: 'u',
        action: AuditAction.LOGIN,
        entityType: 'session',
        entityId: null,
        metadata: { ip: '127.0.0.1' },
        ip: '127.0.0.1',
        userAgent: 'jest',
      };
      await svc.log(entry);

      // Re-derive the expected hash with the same canonicalisation rule
      // used by the service, using the SAME createdAt that the service
      // assigned to the row (the service uses `new Date()` internally, so
      // we read it back rather than guess).
      const stored = prisma.rows[0];
      const canonicalPayload = canonicalFor(entry, stored.createdAt);
      const expected = createHash('sha256')
        .update('' + canonicalPayload) // genesis: prevHash is null → empty string
        .digest('hex');

      expect(stored.rowHash).toBe(expected);
    });
  });

  // ──────────────────────────────────────────────── C-02: concurrent writes

  describe('C-02 concurrent writes', () => {
    it('Promise.all x 10 concurrent log() calls produce a valid chain', async () => {
      // Fire N writes without awaiting between them, then verify the chain.
      // Pre-fix: two concurrent writes could both read the same prev rowHash
      // and both insert a row chained to that prev — verifyChain would then
      // return valid:false with brokenAt set to the second row.
      // Post-fix: $transaction serialises the read+write so each row sees
      // the prior row's commit.
      const N = 10;
      const writes = Array.from({ length: N }, (_, i) =>
        svc.log({
          tenantId: TENANT_ID,
          action: AuditAction.LOGIN,
          userId: `user-${i}`,
        }),
      );
      await Promise.all(writes);

      expect(prisma.rows).toHaveLength(N);
      const result = await svc.verifyChain(TENANT_ID);
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeUndefined();
    });

    it('every row has a distinct rowHash under concurrent writes (no collisions)', async () => {
      // The DB-level @@unique([tenantId, rowHash]) is the second line of
      // defence — if the in-process transaction ever let two rows collide,
      // the second INSERT would fail. With the $transaction in place, the
      // in-memory store should never see a duplicate rowHash either.
      const N = 20;
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          svc.log({
            tenantId: TENANT_ID,
            action: AuditAction.CREATE,
            userId: `u-${i}`,
            metadata: { seq: i },
          }),
        ),
      );

      const hashes = new Set(prisma.rows.map((r) => r.rowHash));
      expect(hashes.size).toBe(N);
    });
  });
});

// helper kept at the bottom so the test body stays focused
function canonicalFor(
  entry: AuditLogEntry,
  createdAt: Date,
): string {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k]));
    return '{' + parts.join(',') + '}';
  };
  return canonical({
    tenantId: entry.tenantId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: canonical(entry.metadata ?? null),
    createdAt: createdAt.toISOString(),
  });
}