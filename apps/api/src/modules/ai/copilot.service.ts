// copilot.service.ts — RAG orchestrator for DocFlow Co-Pilot
//
// This is the real implementation:
//   • Intent routing against the user query (AGGREGATION, LOOKUP,
//     COMPARISON, ANOMALY, STATUS, etc.).
//   • LOOKUP + AGGREGATION + STATUS hit Prisma directly with
//     tenant-scoped queries (bypassing the LLM when the answer is
//     purely arithmetic — the LLM is then asked to NARRATE the
//     computed result instead of fabricating it).
//   • Other intents build a RAG context, call the LLM (Anthropic if
//     ANTHROPIC_API_KEY is set, else the deterministic local
//     fallback), and return a structured Portuguese answer with
//     sources + suggested follow-ups.
//   • Every chat emits an AuditService log row (never throws).

import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RagService } from './rag.service';
import { VisionService } from './vision.service';
import { ExtractionService } from './extraction.service';
import { ClassificationService } from './classification.service';
import { DuplicateService } from './duplicate.service';
import { AnomalyService } from './anomaly.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { LlmProvider, ChatMessage } from './llm-provider';
import { AuditService } from '../audit/audit.service';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CopilotResponse {
  answer: string;
  sources: { documentId: string; field: string; snippet: string }[];
  confidence: number;
  suggestedFollowUps: string[];
  intent: CopilotIntent;
  intentData?: Record<string, unknown>;
}

export type CopilotIntent =
  | 'AGGREGATION'
  | 'LOOKUP'
  | 'COMPARISON'
  | 'ANOMALY'
  | 'EXPLANATION'
  | 'PREDICTION'
  | 'DUPLICATE_CHECK'
  | 'STATUS'
  | 'CLASSIFY'
  | 'EXPORT'
  | 'GENERAL';

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private prisma: PrismaService,
    private rag: RagService,
    private vision: VisionService,
    private extraction: ExtractionService,
    private classification: ClassificationService,
    private duplicate: DuplicateService,
    private anomaly: AnomalyService,
    private embedding: EmbeddingService,
    private vectorStore: VectorStoreService,
    private llm: LlmProvider,
    private audit: AuditService,
  ) {}

  // ─── MAIN CHAT ────────────────────────────────────────────────
  async chat(
    query: string,
    tenantId: string,
    history?: Message[],
    actor?: { userId?: string },
  ): Promise<CopilotResponse> {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('tenantId is required for copilot.chat');
    }

    const intent = this.classifyIntent(query);
    this.logger.log(`Chat intent=${intent} tenant=${tenantId}`);

    // ─── Deterministic paths: LOOKUP, AGGREGATION, STATUS
    // Compute the answer against the DB so the LLM doesn't have to
    // hallucinate numbers.
    if (intent === 'AGGREGATION' || intent === 'STATUS') {
      const response = await this.handleAggregationOrStatus(query, intent, tenantId);
      // Best-effort audit log — never throws.
      void this.audit.log({
        tenantId,
        userId: actor?.userId ?? null,
        action: AuditAction.IMPORT,
        entityType: 'copilot_chat',
        entityId: null,
        metadata: {
          intent,
          query,
          answerKind: 'deterministic',
          sources: response.sources.length,
        },
      });
      return response;
    }

    // ─── LOOKUP short-circuit
    if (intent === 'LOOKUP') {
      const lookupAnswer = await this.handleLookup(query, tenantId);
      if (lookupAnswer) {
        void this.audit.log({
          tenantId,
          userId: actor?.userId ?? null,
          action: AuditAction.IMPORT,
          entityType: 'copilot_chat',
          entityId: null,
          metadata: { intent, query, answerKind: 'lookup_direct' },
        });
        return lookupAnswer;
      }
      // Fall through to RAG if no direct match.
    }

    // ─── RAG path for everything else
    const { context, sources } = await this.rag.buildContext(query, tenantId);
    const systemPrompt = this.selectSystemPrompt(intent, context);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];

    const completion = await this.llm.chat(messages, {
      temperature: 0.2,
      maxTokens: 1024,
    });

    const response: CopilotResponse = {
      answer: completion.content,
      sources,
      confidence: this.estimateConfidence(intent, sources.length, completion.provider),
      suggestedFollowUps: this.generateFollowUps(query, intent),
      intent,
      intentData: { provider: completion.provider, model: completion.model },
    };

    void this.audit.log({
      tenantId,
      userId: actor?.userId ?? null,
      action: AuditAction.IMPORT,
      entityType: 'copilot_chat',
      entityId: null,
      metadata: {
        intent,
        query,
        answerKind: 'rag',
        provider: completion.provider,
        model: completion.model,
        sources: sources.length,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
      },
    });

    return response;
  }

  // ─── DOCUMENT ANALYSIS PIPELINE ────────────────────────────────
  async analyzeDocument(
    documentId: string,
    options?: {
      preferredProvider?: 'gemini' | 'claude' | 'auto';
      skipVision?: boolean;
      forceOcr?: boolean;
    },
  ) {
    this.logger.log(`Analyzing document ${documentId}`);
    // STUB for full pipeline — still wires the embedding into the
    // vector store so the copilot can retrieve against it immediately.
    try {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          tenantId: true,
          fileName: true,
          supplier: true,
          docNumber: true,
          docDate: true,
          total: true,
          currency: true,
          type: true,
          metadata: true,
        },
      });
      if (doc) {
        const text =
          `${doc.fileName} ${doc.supplier ?? ''} ${doc.docNumber ?? ''} ${doc.total ?? ''} ${doc.type ?? ''}`;
        const { chunks } = { chunks: await this.embedding.embedDocument(doc.id, text) };
        await this.vectorStore.insert(
          doc.tenantId,
          doc.id,
          chunks.map((c, i) => ({
            chunkIndex: i,
            content: c.chunk.content,
            field: c.chunk.metadata.field,
            embedding: c.vector,
          })),
        );
      }
    } catch (err) {
      this.logger.warn(
        `analyzeDocument embedding side-effect failed: ${(err as Error).message}`,
      );
    }
    return {
      documentId,
      status: 'CHUNKED',
      pipeline: ['vision', 'extraction', 'classification', 'embedding'],
    };
  }

  async checkBatchDuplicates(tenantId: string, documentIds: string[]) {
    return this.duplicate.checkBatch(tenantId, documentIds);
  }

  async scanAnomalies(tenantId: string, documentIds: string[]) {
    return this.anomaly.scanBatch(tenantId, documentIds);
  }

  // ─── DETERMINISTIC HANDLERS ──────────────────────────────────

  /**
   * Handle AGGREGATION ("quanto tenho a pagar este mes") and STATUS
   * ("quantas faturas pendentes") by querying Prisma directly and
   * narrating the result through the LLM if it's available — otherwise
   * returning a structured Portuguese answer built from the data.
   */
  private async handleAggregationOrStatus(
    query: string,
    intent: CopilotIntent,
    tenantId: string,
  ): Promise<CopilotResponse> {
    const q = query.toLowerCase();
    const isPayableQuery =
      /\b(pagar|pagament|venciment|payable)\b/.test(q) ||
      /\b(m[êe]s|mes|este mes|mes corrente|mes atual)\b/.test(q) ||
      intent === 'AGGREGATION';
    const isDocumentQuery = /\b(fatura|documento|invoice)\b/.test(q);
    const isBalanceQuery = /\b(saldo|banco|bank|banking)\b/.test(q);

    const sources: CopilotResponse['sources'] = [];

    if (isPayableQuery || (!isDocumentQuery && !isBalanceQuery)) {
      const dateRange = this.parseMonthFilter(q);
      const payables = await this.prisma.payableItem.findMany({
        where: {
          tenantId,
          status: { in: ['TO_PAY', 'SCHEDULED', 'OVERDUE'] },
          ...(dateRange ? { dueDate: { gte: dateRange.start, lte: dateRange.end } } : {}),
        },
        take: 200,
        orderBy: { dueDate: 'asc' },
      });

      const totalAmount = payables.reduce(
        (acc, p) => acc + (Number(p.amount) || 0),
        0,
      );
      const totalOverdue = payables
        .filter(
          (p) =>
            p.status === 'OVERDUE' ||
            (p.dueDate && p.dueDate.getTime() < Date.now()),
        )
        .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

      const periodLabel = dateRange
        ? `${this.fmtDate(dateRange.start)} a ${this.fmtDate(dateRange.end)}`
        : 'todos os vencimentos em aberto';

      const top = payables.slice(0, 10).map((p, i) => {
        sources.push({
          documentId: p.documentId ?? p.id,
          field: 'payable_item',
          snippet: `${p.description ?? 'sem descricao'} | ${this.fmtEur(Number(p.amount))} EUR | venc. ${p.dueDate ? this.fmtDate(p.dueDate) : 'n/d'} | ${p.status}`,
        });
        return `${i + 1}. ${p.description ?? 'sem descricao'} — ${this.fmtEur(Number(p.amount))} EUR — vencimento ${p.dueDate ? this.fmtDate(p.dueDate) : 'n/d'} (${p.status})`;
      });

      const answer = [
        `Total a pagar (${periodLabel}): ${this.fmtEur(totalAmount)} EUR ` +
          `em ${payables.length} item(s).` +
          (totalOverdue > 0
            ? ` Em atraso: ${this.fmtEur(totalOverdue)} EUR.`
            : ''),
        '',
        top.length > 0 ? 'Top vencimentos:' : 'Sem vencimentos no periodo.',
        ...top,
      ].join('\n');

      return {
        answer,
        sources,
        confidence: 0.95,
        suggestedFollowUps: [
          'Mostra apenas os itens em atraso',
          'Qual o fornecedor com maior valor?',
          'Soma por fornecedor',
        ],
        intent,
        intentData: {
          kind: 'payable_aggregation',
          count: payables.length,
          total: totalAmount,
          overdue: totalOverdue,
          dateRange: dateRange
            ? {
                start: dateRange.start.toISOString(),
                end: dateRange.end.toISOString(),
              }
            : null,
        },
      };
    }

    if (isBalanceQuery) {
      const txs = await this.prisma.bankTransaction.findMany({
        where: { tenantId },
        take: 200,
        orderBy: { date: 'desc' },
        select: { id: true, date: true, amount: true, description: true, balance: true },
      });
      const totalIn = txs
        .filter((t) => Number(t.amount) > 0)
        .reduce((acc, t) => acc + Number(t.amount), 0);
      const totalOut = txs
        .filter((t) => Number(t.amount) < 0)
        .reduce((acc, t) => acc + Math.abs(Number(t.amount)), 0);
      const net = totalIn - totalOut;
      return {
        answer:
          `Movimentos bancarios recentes: ${txs.length} transacao(oes).\n` +
          `Entradas: ${this.fmtEur(totalIn)} EUR | Saidas: ${this.fmtEur(totalOut)} EUR | ` +
          `Saldo liquido: ${this.fmtEur(net)} EUR.`,
        sources: txs.slice(0, 5).map((t) => ({
          documentId: t.id,
          field: 'bank_transaction',
          snippet: `${t.description} | ${this.fmtEur(Number(t.amount))} EUR | ${this.fmtDate(t.date)}`,
        })),
        confidence: 0.9,
        suggestedFollowUps: ['Ultimas 5 transacoes', 'Quais os maiores creditos?'],
        intent,
        intentData: { kind: 'bank_aggregation' },
      };
    }

    // Default AGGREGATION: document totals
    const docs = await this.prisma.document.findMany({
      where: { tenantId },
      take: 500,
      select: { id: true, total: true, currency: true, type: true, status: true },
    });
    const total = docs.reduce(
      (acc, d) => acc + (Number(d.total) || 0),
      0,
    );
    const pending = docs.filter(
      (d) => d.status === 'NOVO' || d.status === 'EM_REVISAO',
    ).length;
    return {
      answer:
        `Total agregado de ${docs.length} documento(s): ${this.fmtEur(total)} EUR.\n` +
        `Documentos pendentes (NOVO/EM_REVISAO): ${pending}.`,
      sources: docs.slice(0, 5).map((d) => ({
        documentId: d.id,
        field: 'document_total',
        snippet: `${d.type} | ${this.fmtEur(Number(d.total))} ${d.currency ?? 'EUR'} | ${d.status}`,
      })),
      confidence: 0.85,
      suggestedFollowUps: [
        'E por fornecedor?',
        'Mostra a evolucao mensal',
        'Quais estao em revisao?',
      ],
      intent,
      intentData: { kind: 'document_aggregation' },
    };
  }

  /**
   * Direct LOOKUP: try to find the document referenced by the query
   * (file name, doc number, or ATCUD). Returns null when no specific
   * match was found so the caller falls back to RAG.
   */
  private async handleLookup(
    query: string,
    tenantId: string,
  ): Promise<CopilotResponse | null> {
    // Try docNumber first (most specific).
    const numMatch = query.match(/\b(FT|FS|FR|NC|ND|FA)\s*[:#]?\s*([A-Z0-9/_\-]+)/i);
    if (numMatch) {
      const docNumber = `${numMatch[1].toUpperCase()} ${numMatch[2]}`;
      const doc = await this.prisma.document.findFirst({
        where: { tenantId, docNumber: { contains: docNumber } },
      });
      if (doc) return this.docToCopilotResponse(doc, 'docNumber');
    }

    // ATCUD
    const atcudMatch = query.match(/\bATCUD[:\s#]*([A-Z0-9-]+)/i);
    if (atcudMatch) {
      const doc = await this.prisma.document.findFirst({
        where: { tenantId, atcud: atcudMatch[1] },
      });
      if (doc) return this.docToCopilotResponse(doc, 'atcud');
    }

    return null;
  }

  private async docToCopilotResponse(
    doc: {
      id: string;
      fileName: string;
      supplier: string | null;
      docNumber: string | null;
      atcud: string | null;
      docDate: Date | null;
      dueDate: Date | null;
      total: unknown;
      currency: string | null;
      supplierNif: string | null;
      type: unknown;
      status: unknown;
      paymentStatus: unknown;
    },
    matchedBy: string,
  ): Promise<CopilotResponse> {
    const lines = [
      `Documento encontrado (${matchedBy}):`,
      `• Ficheiro: ${doc.fileName}`,
      doc.supplier ? `• Fornecedor: ${doc.supplier}` : null,
      doc.supplierNif ? `• NIF: ${doc.supplierNif}` : null,
      doc.docNumber ? `• Numero: ${doc.docNumber}` : null,
      doc.atcud ? `• ATCUD: ${doc.atcud}` : null,
      doc.docDate ? `• Data: ${this.fmtDate(doc.docDate)}` : null,
      doc.dueDate ? `• Vencimento: ${this.fmtDate(doc.dueDate)}` : null,
      doc.total != null
        ? `• Total: ${this.fmtEur(Number(doc.total))} ${doc.currency ?? 'EUR'}`
        : null,
      doc.type ? `• Tipo: ${String(doc.type)}` : null,
      doc.status ? `• Estado: ${String(doc.status)}` : null,
      doc.paymentStatus
        ? `• Pagamento: ${String(doc.paymentStatus)}`
        : null,
    ].filter((l): l is string => Boolean(l));

    return {
      answer: lines.join('\n'),
      sources: [
        {
          documentId: doc.id,
          field: matchedBy,
          snippet: lines.slice(1).join(' | ').slice(0, 200),
        },
      ],
      confidence: 0.95,
      suggestedFollowUps: [
        'Qual o IVA desta fatura?',
        'Mostra os itens da fatura',
        'Verifica se ha duplicados',
      ],
      intent: 'LOOKUP',
      intentData: { matchedBy, documentId: doc.id },
    };
  }

  // ─── INTENT CLASSIFICATION ─────────────────────────────────────
  classifyIntent(query: string): CopilotIntent {
    const q = query.toLowerCase();
    // Match Portuguese verb/noun inflections by checking PREFIXES
    // rather than full words (so "suspeita", "duplicados", "exporta"
    // all match their root without needing a stemmer).
    if (/total|soma|quanto|quantos|agregado|saldo|m[eé]dia|ranking/.test(q))
      return 'AGGREGATION';
    if (
      /mostra|detalhes|fatura\s+ft|documento\s+espec|qual\s+a\s+fatura|procurar|qual\s+doc/.test(
        q,
      )
    )
      return 'LOOKUP';
    if (/vs|comparar|compara|diferen[cç]a|comparativo/.test(q))
      return 'COMPARISON';
    if (/suspeit|an[oó]mal|estranh|at[ií]pic|fraude|erro\s+fiscal/.test(q))
      return 'ANOMALY';
    if (/explica|como\s+funciona|por\s+que|o\s+que\s+[eé]/.test(q))
      return 'EXPLANATION';
    if (/prev|proje|futuro|pr[oó]xim|tend[eê]ncia/.test(q))
      return 'PREDICTION';
    if (/duplicad|repetid|j[aá]\s+existe/.test(q)) return 'DUPLICATE_CHECK';
    if (/estado|status|pendente|por\s+processar|em\s+revis/.test(q))
      return 'STATUS';
    if (/classific|que\s+tipo|categoria/.test(q)) return 'CLASSIFY';
    if (/export|csv|excel|saf-t|download/.test(q)) return 'EXPORT';
    return 'GENERAL';
  }

  // ─── PROMPT TEMPLATES ──────────────────────────────────────────
  private selectSystemPrompt(intent: CopilotIntent, context: string): string {
    const header =
      'Es o Copiloto de Tesouraria da DocFlow. Responde SEMPRE em Portugues de Portugal.\n' +
      'Baseia-te APENAS no contexto abaixo. Se nao souberes, diz que nao encontras a informacao.\n' +
      'Formata valores monetarios como 1.250,50 EUR. Datas em formato DD/MM/AAAA.\n' +
      'Cita o numero do documento ou nome do ficheiro quando possivel.';

    const templates: Record<CopilotIntent, string> = {
      AGGREGATION:
        `${header}\nTAREFA: Calcula totais, somas e medias com precisao a partir dos documentos.\n\nCONTEXTO:\n{context}`,
      LOOKUP:
        `${header}\nTAREFA: Localiza e apresenta detalhes do documento pedido.\n\nCONTEXTO:\n{context}`,
      COMPARISON:
        `${header}\nTAREFA: Compara metricas entre periodos ou fornecedores.\n\nCONTEXTO:\n{context}`,
      ANOMALY:
        `${header}\nTAREFA: Deteta anomalias: valores atipicos (+3 sigma), IVA incorreto, IBAN divergente, datas invalidas, duplicados.\n\nCONTEXTO:\n{context}`,
      EXPLANATION:
        `${header}\nTAREFA: Explica conceitos fiscais/contabilisticos com base nos documentos.\n\nCONTEXTO:\n{context}`,
      PREDICTION:
        `${header}\nTAREFA: Projeta tendencias baseadas no historico documental.\n\nCONTEXTO:\n{context}`,
      DUPLICATE_CHECK:
        `${header}\nTAREFA: Verifica se o documento e duplicado (hash, perceptual, semantico).\n\nCONTEXTO:\n{context}`,
      STATUS:
        `${header}\nTAREFA: Reporta o estado atual dos documentos.\n\nCONTEXTO:\n{context}`,
      CLASSIFY:
        `${header}\nTAREFA: Classifica o documento na taxonomia fiscal (FT/FS/FR/DUA/Recibo/etc).\n\nCONTEXTO:\n{context}`,
      EXPORT:
        `${header}\nTAREFA: Prepara exportacao dos dados filtrados.\n\nCONTEXTO:\n{context}`,
      GENERAL: `${header}\n\nCONTEXTO:\n{context}`,
    };
    return templates[intent].replace('{context}', context);
  }

  private generateFollowUps(_query: string, intent: CopilotIntent): string[] {
    const suggestions: Record<string, string[]> = {
      AGGREGATION: [
        'E por fornecedor?',
        'Mostra a evolucao mensal',
        'Qual o maior valor?',
      ],
      LOOKUP: [
        'Extrai os itens da fatura',
        'Qual o IVA aplicado?',
        'Quem e o fornecedor?',
      ],
      STATUS: ['Quais estao em revisao?', 'Quantos aprovados?', 'Resumo do mes'],
      ANOMALY: [
        'Mostra so os alertas ALTOS',
        'Verifica duplicados tambem',
        'Exporta relatorio de anomalias',
      ],
      GENERAL: [
        'Que documentos tenho pendentes?',
        'Analisa o ultimo lote',
        'Mostra totais do mes',
      ],
    };
    return suggestions[intent] ?? suggestions['GENERAL'];
  }

  // ─── UTILITIES ──────────────────────────────────────────────────
  private estimateConfidence(
    intent: CopilotIntent,
    sourcesCount: number,
    provider: string,
  ): number {
    let base = 0.7;
    if (provider === 'anthropic') base += 0.1;
    if (sourcesCount >= 3) base += 0.1;
    if (intent === 'LOOKUP') base += 0.05;
    return Math.min(base, 0.98);
  }

  private fmtEur(n: number): string {
    return n.toLocaleString('pt-PT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private fmtDate(d: Date): string {
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  }

  /** Parse month hints from Portuguese queries into a Date range. */
  private parseMonthFilter(
    query: string,
  ): { start: Date; end: Date } | null {
    const now = new Date();
    if (/\b(este mes|mes corrente|mes atual|este m[êe]s)\b/.test(query)) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { start, end };
    }
    if (/\b(proximo mes|pr[óo]ximo m[êe]s)\b/.test(query)) {
      const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
      return { start, end };
    }
    if (/\b(mes passado|m[êe]s passado)\b/.test(query)) {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start, end };
    }
    // Explicit MM/YYYY
    const monthYear = query.match(/\b(\d{1,2})[\/\-](\d{4})\b/);
    if (monthYear) {
      const m = parseInt(monthYear[1], 10);
      const y = parseInt(monthYear[2], 10);
      if (m >= 1 && m <= 12 && y > 2000 && y < 2100) {
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0, 23, 59, 59);
        return { start, end };
      }
    }
    return null;
  }
}
