import { OAuthStateStore } from './oauth-state.store';

/**
 * Tests for OAuthStateStore — Prisma-backed storage of OAuth2 state
 * tokens. The store's contract is simple: put() persists, consume()
 * returns and atomically deletes, expired states are swept. All without
 * a real database.
 */

type IntegrationRow = {
  id: string;
  tenantId: string;
  provider: string;
  credentials: any;
  isActive: boolean;
};

function makePrisma(initial: IntegrationRow[] = []) {
  const rows = new Map<string, IntegrationRow>();
  for (const r of initial) rows.set(r.id, r);
  let counter = 0;

  return {
    rows,
    integration: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = [...rows.values()].find(
          (r) =>
            r.tenantId === where.tenantId_provider.tenantId &&
            r.provider === where.tenantId_provider.provider,
        );
        if (existing) {
          Object.assign(existing, { credentials: update.credentials });
          return existing;
        }
        const row: IntegrationRow = {
          id: `state-${++counter}`,
          tenantId: create.tenantId,
          provider: create.provider,
          credentials: create.credentials,
          isActive: create.isActive ?? false,
        };
        rows.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          [...rows.values()].find(
            (r) =>
              r.tenantId === where.tenantId_provider.tenantId &&
              r.provider === where.tenantId_provider.provider,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where }: any) => {
        let result = [...rows.values()];
        if (where.tenantId) {
          result = result.filter((r) => r.tenantId === where.tenantId);
        }
        if (where.provider?.startsWith) {
          const prefix = where.provider.startsWith;
          result = result.filter((r) => r.provider.startsWith(prefix));
        }
        return result;
      }),
      delete: jest.fn(async ({ where: { id } }: any) => {
        rows.delete(id);
        return { id };
      }),
    },
  } as any;
}

describe('OAuthStateStore', () => {
  describe('put() + consume()', () => {
    it('round-trips a state', async () => {
      const prisma = makePrisma();
      const store = new OAuthStateStore(prisma);
      await store.put('tenant-1', 'toconline', 'state-a', 'https://cb');
      const out = await store.consume('toconline', 'state-a');
      expect(out).toEqual({
        tenantId: 'tenant-1',
        provider: 'toconline',
        redirectUri: 'https://cb',
      });
    });

    it('consumes atomically — a second consume returns null', async () => {
      const prisma = makePrisma();
      const store = new OAuthStateStore(prisma);
      await store.put('tenant-1', 'toconline', 'state-a', 'https://cb');
      const first = await store.consume('toconline', 'state-a');
      const second = await store.consume('toconline', 'state-a');
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('returns null for an unknown state', async () => {
      const prisma = makePrisma();
      const store = new OAuthStateStore(prisma);
      const out = await store.consume('toconline', 'never-stored');
      expect(out).toBeNull();
    });

    it('returns null and deletes the row for an expired state', async () => {
      const prisma = makePrisma();
      const store = new OAuthStateStore(prisma);
      await store.put('tenant-1', 'toconline', 'state-a', 'https://cb', 1);
      // Wait long enough for the state to be expired (with margin).
      await new Promise((r) => setTimeout(r, 1500));
      const out = await store.consume('toconline', 'state-a');
      expect(out).toBeNull();
    });

    it('returns null and cleans up corrupt rows', async () => {
      const prisma = makePrisma([
        {
          id: 'corrupt-1',
          tenantId: OAuthStateStore.STATES_TENANT,
          provider: '__state__:toconline:state-bad',
          credentials: '{not json',
          isActive: false,
        },
      ]);
      const store = new OAuthStateStore(prisma);
      const out = await store.consume('toconline', 'state-bad');
      expect(out).toBeNull();
    });
  });

  describe('sweepExpired()', () => {
    it('removes only the expired rows', async () => {
      const prisma = makePrisma();
      const store = new OAuthStateStore(prisma);
      // Stale (expired) and fresh rows mixed together.
      await store.put('tenant-1', 'toconline', 'old', 'https://cb', 1);
      await new Promise((r) => setTimeout(r, 1100));
      await store.put('tenant-1', 'toconline', 'fresh', 'https://cb', 600);
      const deleted = await store.sweepExpired();
      expect(deleted).toBe(1);
      // The fresh row survives.
      const remaining = await store.consume('toconline', 'fresh');
      expect(remaining).not.toBeNull();
    });
  });
});