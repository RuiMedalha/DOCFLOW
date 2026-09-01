// rag.service.ts — RAG prompt assembly: retrieval → context window → structured prompt
// Design: §8.3

import { Injectable, Logger } from '@nestjs/common';
import { RetrievalService, RetrievalResult } from './retrieval.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface CopilotContext {
  query: string;
  context: string;
  sources: { documentId: string; field: string; snippet: string }[];
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly maxTokens = 4000;
  private readonly maxChunks = 10;

  constructor(
    private retrieval: RetrievalService,
    private prisma: PrismaService,
  ) {}

  /**
   * Build the RAG context for a user query. Falls back to a
   * "tenant overview" listing when the vector store has no chunks for
   * this tenant yet (fresh install, no embeddings have been built) so
   * the LLM always has SOME recent tenant data to answer against.
   */
  async buildContext(
    query: string,
    tenantId: string,
    options?: { maxChunks?: number; maxTokens?: number },
  ): Promise<CopilotContext> {
    const chunks = options?.maxChunks ?? this.maxChunks;
    const tokenBudget = options?.maxTokens ?? this.maxTokens;

    let results = await this.retrieval.hybridSearch(query, tenantId, chunks);

    if (results.length === 0) {
      // Fallback: feed a tenant snapshot of the most recent docs /
      // payables so the LLM has evidence to reason about.
      results = await this.tenantSnapshot(tenantId, chunks);
    }

    const context = this.assembleContextWindow(results, tokenBudget);

    const sources = results.map((r) => ({
      documentId: r.metadata.documentId,
      field: r.metadata.field,
      snippet: r.content.substring(0, 200),
    }));

    this.logger.log(
      `RAG context: tenant=${tenantId} sources=${sources.length} ` +
        `chars=${context.length}`,
    );

    return { query, context, sources };
  }

  /** Build a tenant snapshot from the most recent documents/payables. */
  private async tenantSnapshot(
    tenantId: string,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const docs = await this.prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fileName: true,
        supplier: true,
        docNumber: true,
        atcud: true,
        docDate: true,
        total: true,
        currency: true,
        type: true,
        status: true,
        paymentStatus: true,
      },
    });
    return docs.map((d, i) => ({
      content: this.docToSnippet(d),
      metadata: { documentId: d.id, field: 'document_header' },
      score: 1 / (60 + i + 1),
      source: 'keyword' as const,
    }));
  }

  private docToSnippet(d: {
    fileName: string;
    supplier: string | null;
    docNumber: string | null;
    atcud: string | null;
    docDate: Date | null;
    total: unknown;
    currency: string | null;
    type: unknown;
    status: unknown;
    paymentStatus: unknown;
  }): string {
    const lines: string[] = [];
    lines.push(`Documento: ${d.fileName}`);
    if (d.supplier) lines.push(`Fornecedor: ${d.supplier}`);
    if (d.docNumber) lines.push(`Numero: ${d.docNumber}`);
    if (d.atcud) lines.push(`ATCUD: ${d.atcud}`);
    if (d.docDate) lines.push(`Data: ${d.docDate.toISOString().slice(0, 10)}`);
    if (d.total != null) lines.push(`Total: ${String(d.total)} ${d.currency ?? 'EUR'}`);
    if (d.type) lines.push(`Tipo: ${String(d.type)}`);
    if (d.status) lines.push(`Estado: ${String(d.status)}`);
    if (d.paymentStatus) lines.push(`Pagamento: ${String(d.paymentStatus)}`);
    return lines.join('\n');
  }

  /** Trim retrieved chunks to fit a rough character-budget context window. */
  private assembleContextWindow(
    results: RetrievalResult[],
    maxTokens: number,
  ): string {
    const maxChars = maxTokens * 4;
    let context = '';
    const seen = new Set<string>();

    for (const result of results) {
      const dedupKey = result.content.substring(0, 100);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const snippet =
        `--- Documento: ${result.metadata.documentId} (${result.metadata.field}) ---\n` +
        `${result.content}\n\n`;

      if (context.length + snippet.length > maxChars) break;
      context += snippet;
    }

    return context.trim();
  }
}