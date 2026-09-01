// retrieval.service.ts — Hybrid search combining:
//   1) vector cosine similarity (VectorStoreService), and
//   2) Postgres ILIKE keyword search across document fields.
// Fused via Reciprocal Rank Fusion (RRF).
//
// The keyword search runs against the Document model (filename,
// supplier, docNumber, atcud) and against PayableItem (description,
// notes) when the intent suggests treasury queries — both are
// tenant-scoped via the Prisma extension.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService, VectorHit } from './vector-store.service';
import { VectorFilter } from './vector-store.service';

export interface RetrievalResult {
  content: string;
  metadata: {
    documentId: string;
    field: string;
    page?: number;
  };
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

interface KeywordHit {
  documentId: string;
  content: string;
  rank: number;
  field: string;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private vectorStore: VectorStoreService,
  ) {}

  /**
   * Hybrid search combining vector similarity and ILIKE keyword
   * search. RRF is used to fuse the rankings. `topK` defaults to 8.
   */
  async hybridSearch(
    query: string,
    tenantId: string,
    topK = 8,
  ): Promise<RetrievalResult[]> {
    const queryEmbedding = await this.embedding.embedQuery(query);

    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorStore.search(queryEmbedding, topK * 2, { tenantId }),
      this.fullTextSearch(query, tenantId, topK * 2),
    ]);

    return this.reciprocalRankFusion(vectorResults, keywordResults, topK);
  }

  /**
   * ILIKE-based keyword search over Document + PayableItem + Invoice.
   * Each row is rendered to a short text snippet that the LLM can use
   * as evidence.
   */
  async fullTextSearch(
    query: string,
    tenantId: string,
    limit: number,
  ): Promise<KeywordHit[]> {
    if (!query || query.trim().length === 0) return [];

    const terms = this.extractSearchTerms(query);
    if (terms.length === 0) return [];

    const hits: KeywordHit[] = [];
    const lowerTerms = terms.map((t) => t.toLowerCase());
    let rank = 0;

    // Documents: filename, supplier, docNumber, atcud
    const orClauses = lowerTerms.map((t) => ({
      OR: [
        { fileName: { contains: t, mode: 'insensitive' as const } },
        { supplier: { contains: t, mode: 'insensitive' as const } },
        { docNumber: { contains: t, mode: 'insensitive' as const } },
        { atcud: { contains: t, mode: 'insensitive' as const } },
        { supplierNif: { contains: t, mode: 'insensitive' as const } },
        { customer: { contains: t, mode: 'insensitive' as const } },
      ],
    }));
    const docWhere = orClauses.length === 1 ? orClauses[0] : { AND: orClauses };

    const docs = await this.prisma.document.findMany({
      where: docWhere,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        supplier: true,
        docNumber: true,
        atcud: true,
        docDate: true,
        total: true,
        currency: true,
        supplierNif: true,
        type: true,
        status: true,
        paymentStatus: true,
      },
    });

    for (const d of docs) {
      hits.push({
        documentId: d.id,
        content: this.docToSnippet(d),
        rank: rank++,
        field: 'document_header',
      });
      if (hits.length >= limit) break;
    }

    // Payable items (when query mentions "pagar", "vencimento", etc.)
    const payableSignals = ['pagar', 'pagament', 'venciment', 'payable', 'despesa'];
    if (lowerTerms.some((t) => payableSignals.some((s) => t.includes(s)))) {
      const payables = await this.prisma.payableItem.findMany({
        where: {
          OR: lowerTerms.map((t) => ({
            description: { contains: t, mode: 'insensitive' as const },
          })),
        },
        take: limit,
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          description: true,
          amount: true,
          dueDate: true,
          status: true,
          paymentMethod: true,
          documentId: true,
          notes: true,
        },
      });
      for (const p of payables) {
        const docId = p.documentId ?? p.id;
        hits.push({
          documentId: docId,
          content: this.payableToSnippet(p),
          rank: rank++,
          field: 'payable_item',
        });
        if (hits.length >= limit + limit) break;
      }
    }

    return hits;
  }

  /** Convert a Document row into a compact Portuguese snippet for the LLM. */
  private docToSnippet(d: {
    fileName: string;
    supplier: string | null;
    docNumber: string | null;
    atcud: string | null;
    docDate: Date | null;
    total: unknown;
    currency: string | null;
    supplierNif: string | null;
    type: unknown;
    status: unknown;
    paymentStatus: unknown;
  }): string {
    const lines: string[] = [];
    lines.push(`Documento: ${d.fileName}`);
    if (d.supplier) lines.push(`Fornecedor: ${d.supplier}`);
    if (d.supplierNif) lines.push(`NIF: ${d.supplierNif}`);
    if (d.docNumber) lines.push(`Numero: ${d.docNumber}`);
    if (d.atcud) lines.push(`ATCUD: ${d.atcud}`);
    if (d.docDate) lines.push(`Data: ${d.docDate.toISOString().slice(0, 10)}`);
    if (d.total != null) {
      lines.push(`Total: ${this.formatPtAmount(String(d.total))} ${d.currency ?? 'EUR'}`);
    }
    if (d.type) lines.push(`Tipo: ${String(d.type)}`);
    if (d.status) lines.push(`Estado: ${String(d.status)}`);
    if (d.paymentStatus) lines.push(`Pagamento: ${String(d.paymentStatus)}`);
    return lines.join('\n');
  }

  private payableToSnippet(p: {
    description: string | null;
    amount: unknown;
    dueDate: Date | null;
    status: string;
    paymentMethod: string | null;
    notes: string | null;
  }): string {
    const lines: string[] = [];
    lines.push('PayableItem:');
    if (p.description) lines.push(`Descricao: ${p.description}`);
    if (p.amount != null) lines.push(`Valor: ${this.formatPtAmount(String(p.amount))} EUR`);
    if (p.dueDate) lines.push(`Vencimento: ${p.dueDate.toISOString().slice(0, 10)}`);
    lines.push(`Estado: ${p.status}`);
    if (p.paymentMethod) lines.push(`Metodo: ${p.paymentMethod}`);
    if (p.notes) lines.push(`Notas: ${p.notes}`);
    return lines.join('\n');
  }

  /** "1.250,50" — Portuguese formatting for amounts. */
  private formatPtAmount(value: string): string {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return value;
    return n.toLocaleString('pt-PT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /** Extract meaningful search terms from a Portuguese query. */
  private extractSearchTerms(query: string): string[] {
    const STOPWORDS = new Set([
      'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos',
      'das', 'no', 'na', 'nos', 'nas', 'em', 'por', 'para', 'com', 'sem', 'sob',
      'e', 'ou', 'mas', 'que', 'se', 'ser', 'ter', 'haver', 'fazer', 'este',
      'esta', 'isto', 'aquilo', 'aqui', 'ali', 'eu', 'tu', 'ele', 'ela', 'nos',
      'vos', 'eles', 'elas', 'meu', 'minha', 'teu', 'tua', 'seu', 'sua', 'nosso',
      'quanto', 'quanta', 'quantos', 'quantas', 'qual', 'quais', 'como', 'quando',
      'onde', 'mostra', 'mostre', 'mostra-me', 'detalhes', 'documento', 'documentos',
      'fatura', 'faturas', 'todos', 'todas', 'este', 'este', 'mes', 'ano',
      'estou', 'voce', 'preciso', 'saber', 'consigo', 'tenho', 'tens', 'tem',
    ]);
    const tokens = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

    // Always include the raw numeric pieces (NIFs, dates, values).
    const numericBits = (query.match(/\b[A-Z0-9/-]{3,}\b|\d{2,}/g) ?? []).map((s) =>
      s.toLowerCase(),
    );

    return Array.from(new Set([...tokens, ...numericBits])).slice(0, 12);
  }

  /**
   * Reciprocal Rank Fusion with k=60. Vector weight vs keyword weight
   * is controlled by including vector hits as primary anchors: a hit
   * that BOTH retrievers rank in the top contributes the sum of its
   * RRF scores from both lists.
   */
  private reciprocalRankFusion(
    vector: VectorHit[],
    keyword: KeywordHit[],
    topK: number,
    k = 60,
  ): RetrievalResult[] {
    type Acc = {
      total: number;
      content: string;
      metadata: RetrievalResult['metadata'];
      sources: Set<'vector' | 'keyword'>;
    };
    const scores = new Map<string, Acc>();

    vector.forEach((hit, rank) => {
      const key = `${hit.documentId}:${hit.chunkIndex}`;
      const rrf = 1 / (k + rank + 1);
      const existing = scores.get(key);
      const entry: Acc =
        existing ??
        {
          total: 0,
          content: hit.content,
          metadata: { documentId: hit.documentId, field: hit.field },
          sources: new Set(),
        };
      entry.total += rrf;
      entry.sources.add('vector');
      scores.set(key, entry);
    });

    keyword.forEach((hit, rank) => {
      const rrf = 1 / (k + rank + 1);
      const key = `${hit.documentId}:kw-${hit.field}`;
      const existing = scores.get(key);
      const entry: Acc =
        existing ??
        {
          total: 0,
          content: hit.content,
          metadata: { documentId: hit.documentId, field: hit.field },
          sources: new Set(),
        };
      entry.total += rrf;
      entry.sources.add('keyword');
      scores.set(key, entry);
    });

    return [...scores.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, topK)
      .map(([, v]) => ({
        content: v.content,
        metadata: v.metadata,
        score: v.total,
        source:
          v.sources.size > 1
            ? 'hybrid'
            : v.sources.has('vector')
              ? 'vector'
              : 'keyword',
      }));
  }
}
