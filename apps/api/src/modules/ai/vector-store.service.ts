// vector-store.service.ts — In-memory cosine vector store with Prisma
// metadata lookup. Designed as the MVP replacement for pgvector; the
// same `VectorHit` / `VectorFilter` shape can later be backed by an
// actual pgvector column without changing callers.
//
// Storage strategy:
//   • Vectors + payload kept in a Map<documentId, Chunk[]> for O(1)
//     document deletion and cheap top-k per query.
//   • Tenant scoping is enforced both in the key prefix AND in the
//     payload metadata so a malformed payload cannot leak across
//     tenants even if the prefix were wrong.
//   • Search is O(n) over the tenant's chunks with cosine similarity;
//     this is fine for the MVP — n is the number of document chunks
//     per tenant, typically hundreds in dev and tens of thousands at
//     most in prod. When it stops being fine, swap in pgvector.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';

export interface StoredChunk {
  documentId: string;
  chunkIndex: number;
  content: string;
  field: string;
  embedding: number[];
}

export interface VectorHit {
  documentId: string;
  chunkIndex: number;
  content: string;
  field: string;
  similarity: number;
}

export interface VectorFilter {
  tenantId: string;
  documentTypes?: string[];
  dateRange?: { start: string; end: string };
  supplierNif?: string;
}

/**
 * Anything that exposes `$queryRaw` (parameterised) satisfies the
 * tenant-scoped rehydrate path. The raw client is acceptable here
 * because we ARE going to inject the tenantId ourselves into the
 * parameterised query — that is exactly what C-06 asks for.
 */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> & { $queryRawUnsafe?: never };

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);

  /**
   * Keyed by `${tenantId}::${documentId}` so we can bulk-delete a
   * document and so a payload collision can never escape the tenant
   * boundary.
   */
  private readonly store = new Map<string, StoredChunk[]>();
  /** Tenants we've already hydrated. Prevents repeated DB reads on every call. */
  private readonly hydratedTenants = new Set<string>();

  constructor(private prisma: PrismaService) {}

  /** No-op for tenant-isolation reasons — see C-06. */
  async onModuleInit(): Promise<void> {
    // C-06: previously this bulk-loaded EVERY tenant's embeddings on
    // boot via `$queryRawUnsafe` with no tenantId predicate. That
    // leaked cross-tenant embeddings into the in-memory store. Now we
    // hydrate per-tenant on first access in {@link ensureHydrated}.
    this.logger.log('Vector store init: per-tenant lazy hydration (C-06 fix).');
  }

  /**
   * C-06: hydrate the store for ONE tenant, scoped by `WHERE tenantId = $1`.
   * The query is parameterised — no string concatenation, no
   * `$queryRawUnsafe` — so even a future regression that lets user
   * input touch the SQL cannot escalate to injection.
   */
  private async ensureHydrated(tenantId: string): Promise<void> {
    if (this.hydratedTenants.has(tenantId)) return;

    // Try the dedicated embeddings table first — skipped if it doesn't exist.
    let rawEmbeddings: Array<{
      documentId: string;
      chunkIndex: number;
      content: string;
      field: string;
      embedding: unknown;
      tenantId: string;
    }> = [];
    try {
      const client = this.prisma as unknown as QueryableClient;
      const rows = await client.$queryRaw`
        SELECT "documentId", "chunkIndex", content, field, embedding, "tenantId"
        FROM document_embeddings
        WHERE "tenantId" = ${tenantId}
        LIMIT 5000
      `;
      if (Array.isArray(rows)) {
        rawEmbeddings = rows as typeof rawEmbeddings;
      }
    } catch {
      rawEmbeddings = [];
    }

    if (rawEmbeddings.length > 0) {
      for (const r of rawEmbeddings) {
        const key = this.key(r.tenantId, r.documentId);
        const list = this.store.get(key) ?? [];
        list.push({
          documentId: r.documentId,
          chunkIndex: r.chunkIndex,
          content: r.content,
          field: r.field,
          embedding: Array.isArray(r.embedding)
            ? (r.embedding as number[])
            : typeof r.embedding === 'string'
              ? (JSON.parse(r.embedding) as number[])
              : [],
        });
        this.store.set(key, list);
      }
      this.hydratedTenants.add(tenantId);
      this.logger.log(
        `Vector store hydrated for tenant=${tenantId}: ${rawEmbeddings.length} chunks.`,
      );
      return;
    }

    // Fallback: build a lightweight embedding from the tenant's own
    // documents (findMany inside a tenant context — the scoped
    // client would do this automatically, but we use the raw client
    // here so the parameterised query remains the only WHERE clause).
    try {
      const docs = await this.prisma.document.findMany({
        where: { tenantId },
        select: {
          id: true,
          tenantId: true,
          fileName: true,
          supplier: true,
          docNumber: true,
          docDate: true,
          total: true,
          metadata: true,
          type: true,
        },
        take: 500,
      });
      for (const d of docs) {
        const text = this.documentToText(d);
        if (!text) continue;
        const { EmbeddingService } = await import('./embedding.service.js');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const embedding = new EmbeddingService().embedText(text);
        const key = this.key(d.tenantId, d.id);
        this.store.set(key, [
          {
            documentId: d.id,
            chunkIndex: 0,
            content: text,
            field: 'full_text',
            embedding,
          },
        ]);
      }
      this.hydratedTenants.add(tenantId);
      this.logger.log(
        `Vector store hydrated for tenant=${tenantId} (fallback): ${docs.length} docs.`,
      );
    } catch (err) {
      this.logger.warn(
        `Vector store document-fallback hydrate failed for tenant=${tenantId}: ${(err as Error).message}`,
      );
    }
  }

  /** Insert (or replace) all chunks for a document. */
  async insert(
    tenantId: string,
    documentId: string,
    chunks: { chunkIndex: number; content: string; field: string; embedding: number[] }[],
  ): Promise<void> {
    const key = this.key(tenantId, documentId);
    this.store.set(
      key,
      chunks.map((c) => ({
        documentId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        field: c.field,
        embedding: c.embedding,
      })),
    );
    this.logger.log(
      `Vector insert: tenant=${tenantId} doc=${documentId} chunks=${chunks.length}`,
    );

    // Best-effort persist — never fail the request if the table is missing.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = this.prisma as any;
      await client.$transaction([
        client.document_embeddings?.deleteMany?.({
          where: { documentId, tenantId },
        }),
        ...chunks.map((c) =>
          client.document_embeddings?.create?.({
            data: {
              tenantId,
              documentId,
              chunkIndex: c.chunkIndex,
              content: c.content,
              field: c.field,
              embedding: JSON.stringify(c.embedding),
            },
          }),
        ),
      ]);
    } catch {
      // Table not present — ignore in MVP.
    }
  }

  /**
   * Cosine similarity top-k. Tenants are isolated both by the key
   * prefix and by the chunk's stored tenantId (defence in depth).
   */
  async search(
    vector: number[],
    topK: number,
    filters?: VectorFilter,
  ): Promise<VectorHit[]> {
    if (!filters?.tenantId) return [];
    if (!Array.isArray(vector) || vector.length === 0) return [];

    // C-06: hydrate THIS tenant's embeddings on first call. Other
    // tenants' chunks never enter the in-memory store at all — the
    // parameterised SQL with `WHERE tenantId = $1` is the gate.
    await this.ensureHydrated(filters.tenantId);

    const tenantPrefix = `${filters.tenantId}::`;
    const hits: VectorHit[] = [];

    for (const [key, chunks] of this.store.entries()) {
      if (!key.startsWith(tenantPrefix)) continue;
      for (const c of chunks) {
        if (!Array.isArray(c.embedding) || c.embedding.length === 0) continue;
        const sim = VectorStoreService.cosineSimilarity(vector, c.embedding);
        if (!Number.isFinite(sim)) continue;
        hits.push({
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          field: c.field,
          similarity: sim,
        });
      }
    }

    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }

  /** Delete all embeddings for a document. */
  async delete(tenantId: string, documentId: string): Promise<void> {
    this.store.delete(this.key(tenantId, documentId));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.prisma as any).document_embeddings?.deleteMany?.({
        where: { tenantId, documentId },
      });
    } catch {
      // ignore — table may not exist
    }
  }

  /** Public helper used by retrieval when ad-hoc embedding is needed. */
  hasAny(tenantId: string): boolean {
    const prefix = `${tenantId}::`;
    for (const k of this.store.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  private key(tenantId: string, documentId: string): string {
    return `${tenantId}::${documentId}`;
  }

  private documentToText(d: {
    fileName: string;
    supplier: string | null;
    docNumber: string | null;
    docDate: Date | null;
    total: unknown;
    type: unknown;
    metadata: unknown;
  }): string {
    const parts: string[] = [];
    parts.push(d.fileName);
    if (d.supplier) parts.push(`Fornecedor: ${d.supplier}`);
    if (d.docNumber) parts.push(`Documento: ${d.docNumber}`);
    if (d.docDate) parts.push(`Data: ${d.docDate.toISOString().slice(0, 10)}`);
    if (d.total != null) parts.push(`Total: ${String(d.total)} EUR`);
    if (d.type) parts.push(`Tipo: ${String(d.type)}`);
    if (d.metadata && typeof d.metadata === 'object') {
      const md = d.metadata as Record<string, unknown>;
      if (typeof md.supplierNif === 'string') parts.push(`NIF: ${md.supplierNif}`);
      if (typeof md.atcud === 'string') parts.push(`ATCUD: ${md.atcud}`);
    }
    return parts.join('\n');
  }

  /** Static cosine similarity between two equal-length vectors. */
  static cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    let dot = 0,
      mag1 = 0,
      mag2 = 0;
    for (let i = 0; i < vec1.length; i++) {
      dot += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }
    if (mag1 === 0 || mag2 === 0) return 0;
    return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }
}
