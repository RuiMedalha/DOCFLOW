import { VectorStoreService } from './vector-store.service';

/**
 * C-06: the in-memory vector store MUST scope every DB read by tenantId.
 * Pre-fix: `$queryRawUnsafe` had no `WHERE` clause, so boot rehydration
 * pulled every tenant's embeddings into one shared map. Post-fix: we
 * hydrate per-tenant on first access, and the SQL is parameterised so
 * a future regression that lets user input touch the query cannot
 * escalate to SQL injection.
 */

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

function buildPrismaStub(opts: {
  embeddingsByTenant?: Record<string, Array<{
    documentId: string;
    chunkIndex: number;
    content: string;
    field: string;
    embedding: string;
    tenantId: string;
  }>>;
  documentsByTenant?: Record<string, Array<{
    id: string;
    tenantId: string;
    fileName: string;
    supplier: string | null;
    docNumber: string | null;
    docDate: Date | null;
    total: number | null;
    metadata: unknown;
    type: unknown;
  }>>;
}) {
  const recordedQueries: unknown[][] = [];

  const stub: any = {
    // C-06 production code calls `prisma.$queryRaw\`SELECT ... WHERE tenantId = ${tenantId}\``
    // (parameterised template literal). The stub records every call so
    // we can assert WHERE clauses in the SQL.
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      recordedQueries.push(args);
      // Find the tenantId argument to decide what to return.
      const tenantId = args.find((a) => typeof a === 'string' && a.startsWith('tenant-')) as string | undefined;
      const list = opts.embeddingsByTenant?.[tenantId ?? ''] ?? [];
      return list.map((row) => ({
        ...row,
        // Mirror what Prisma does: the embedding column comes back as a
        // JS array when the column is `vector`, but as a string when
        // it's `text`. The service handles both.
        embedding: row.embedding,
      }));
    }),
    document: {
      findMany: jest.fn(async ({ where }: any) => {
        return opts.documentsByTenant?.[where?.tenantId ?? ''] ?? [];
      }),
    },
  };
  return { stub, recordedQueries };
}

describe('VectorStoreService (C-06 tenant scoping)', () => {
  it('search() issues a parameterised SQL with WHERE tenantId = $1', async () => {
    const { stub, recordedQueries } = buildPrismaStub({
      embeddingsByTenant: {
        [TENANT_A]: [
          {
            documentId: 'doc-A1',
            chunkIndex: 0,
            content: 'A-only chunk',
            field: 'full_text',
            embedding: JSON.stringify([0.1, 0.2, 0.3]),
            tenantId: TENANT_A,
          },
        ],
      },
    });

    const svc = new VectorStoreService(stub);
    await svc.search([0.1, 0.2, 0.3], 5, { tenantId: TENANT_A });

    expect(recordedQueries.length).toBeGreaterThan(0);
    // The SQL template literal + parameters — verify a tenantId argument
    // was passed and the query contains the WHERE clause.
    const [template, ...params] = recordedQueries[0] as [TemplateStringsArray, ...unknown[]];
    const sql = template.join('?');
    expect(sql).toMatch(/FROM\s+document_embeddings/i);
    expect(sql).toMatch(/WHERE\s+"tenantId"\s*=/i);
    expect(params).toContain(TENANT_A);
  });

  it('hydration for tenant A only loads tenant A embeddings', async () => {
    const { stub, recordedQueries } = buildPrismaStub({
      embeddingsByTenant: {
        [TENANT_A]: [
          {
            documentId: 'doc-A1',
            chunkIndex: 0,
            content: 'A1',
            field: 'full_text',
            embedding: JSON.stringify([0.1, 0.2, 0.3]),
            tenantId: TENANT_A,
          },
        ],
      },
    });

    const svc = new VectorStoreService(stub);
    await svc.search([0.1, 0.2, 0.3], 5, { tenantId: TENANT_A });

    // No row from tenant B should have been loaded — verify by checking
    // the search result doesn't accidentally contain tenant-B docs.
    const hits = await svc.search([0.1, 0.2, 0.3], 50, { tenantId: TENANT_A });
    for (const hit of hits) {
      // The key prefix encodes the tenant — every hit MUST be tenant A.
      // (We can't access the private map, but if the query was cross-tenant
      // we'd see hits from other tenants — none exist in the stub.)
      expect(hit.documentId.startsWith('doc-B')).toBe(false);
    }

    // Each search() call is the trigger for hydration. We expect exactly
    // ONE SQL query for tenant A.
    expect(recordedQueries).toHaveLength(1);
    const [, ...params] = recordedQueries[0] as [TemplateStringsArray, ...unknown[]];
    expect(params).toContain(TENANT_A);
  });

  it('does not call $queryRawUnsafe for the boot rehydrate path', async () => {
    // Pin statement: C-06's other half — `$queryRawUnsafe` is forbidden
    // on this code path because it's the dangerous variant. The stub
    // doesn't even implement it; the test asserts the service never
    // touches it.
    const { stub } = buildPrismaStub({
      embeddingsByTenant: { [TENANT_A]: [] },
    });
    // If the service touches $queryRawUnsafe, the stub will throw.
    stub.$queryRawUnsafe = jest.fn(() => {
      throw new Error('$queryRawUnsafe must not be used by VectorStoreService (C-06)');
    });

    const svc = new VectorStoreService(stub);
    await expect(
      svc.search([0.1, 0.2, 0.3], 5, { tenantId: TENANT_A }),
    ).resolves.toBeDefined();
  });

  it('different tenants are isolated at the search boundary', async () => {
    const { stub } = buildPrismaStub({
      embeddingsByTenant: {
        [TENANT_A]: [
          {
            documentId: 'doc-A1',
            chunkIndex: 0,
            content: 'A1',
            field: 'full_text',
            embedding: JSON.stringify([0.1, 0.2, 0.3]),
            tenantId: TENANT_A,
          },
        ],
        [TENANT_B]: [
          {
            documentId: 'doc-B1',
            chunkIndex: 0,
            content: 'B1',
            field: 'full_text',
            embedding: JSON.stringify([0.1, 0.2, 0.3]),
            tenantId: TENANT_B,
          },
        ],
      },
    });

    const svc = new VectorStoreService(stub);

    const hitsA = await svc.search([0.1, 0.2, 0.3], 50, { tenantId: TENANT_A });
    const hitsB = await svc.search([0.1, 0.2, 0.3], 50, { tenantId: TENANT_B });

    expect(hitsA.every((h) => h.documentId.startsWith('doc-A'))).toBe(true);
    expect(hitsB.every((h) => h.documentId.startsWith('doc-B'))).toBe(true);
  });
});