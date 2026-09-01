// llm-provider.ts — Anthropic Messages API integration with deterministic
// local fallback. Used by CopilotService for chat generation.
//
// Resilient design:
//   • If ANTHROPIC_API_KEY is set → real Opus 5 call.
//   • Otherwise → deterministic "extractive" fallback that still produces
//     a structured Portuguese answer from the supplied context. This keeps
//     the dev experience working without an API key and gives E2E tests
//     something reproducible to assert against.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  preferredProvider?: 'anthropic' | 'auto';
}

export interface ChatCompletionResult {
  content: string;
  provider: 'anthropic' | 'local-fallback';
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

@Injectable()
export class LlmProvider {
  private readonly logger = new Logger(LlmProvider.name);
  private readonly anthropicClient: unknown | null;
  private readonly hasAnthropicKey: boolean;
  private readonly defaultModel: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('ANTHROPIC_API_KEY');
    this.hasAnthropicKey = !!key && key.length > 0;
    this.defaultModel =
      config.get<string>('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-20241022';

    if (this.hasAnthropicKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Anthropic = require('@anthropic-ai/sdk').default;
        this.anthropicClient = new Anthropic({ apiKey: key });
        this.logger.log(
          `Anthropic provider enabled (model=${this.defaultModel})`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to initialise Anthropic client: ${(err as Error).message}. ` +
            `Falling back to local LLM.`,
        );
        this.anthropicClient = null;
      }
    } else {
      this.anthropicClient = null;
      this.logger.log(
        'ANTHROPIC_API_KEY not set — using deterministic local fallback LLM.',
      );
    }
  }

  /** True when a real Opus 5 client is available. */
  get liveProviderAvailable(): boolean {
    return !!this.anthropicClient;
  }

  /**
   * Send a chat completion. If Anthropic is configured and reachable,
   * use it. Otherwise (or on hard failure) use the deterministic
   * fallback that still returns a coherent Portuguese answer.
   */
  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResult> {
    const model = options.model ?? this.defaultModel;

    if (this.anthropicClient) {
      try {
        const sys = messages.find((m) => m.role === 'system')?.content;
        const rest = messages.filter((m) => m.role !== 'system');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = this.anthropicClient as any;
        const resp = await client.messages.create({
          model,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.2,
          system: sys ?? '',
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
        });
        const content = (resp.content ?? [])
          .map((b: { type: string; text?: string }) =>
            b.type === 'text' ? b.text : '',
          )
          .join('')
          .trim();
        return {
          content,
          provider: 'anthropic',
          model,
          tokensIn: resp.usage?.input_tokens,
          tokensOut: resp.usage?.output_tokens,
        };
      } catch (err) {
        this.logger.warn(
          `Anthropic call failed (${(err as Error).message}); ` +
            `using local fallback.`,
        );
      }
    }

    return {
      content: this.localFallback(messages),
      provider: 'local-fallback',
      model: 'docflow-local-v1',
    };
  }

  /**
   * Deterministic local "LLM". Builds a Portuguese answer by:
   *   1. Detecting whether the user query asks for an aggregation
   *      (totals/soma/quanto), a lookup (mostra/detalhes), or a
   *      general question.
   *   2. Summarising the context lines that match common PT treasury
   *      keywords (supplier, NIF, total, EUR, data, etc).
   *   3. Returning a structured reply in the same Portuguese voice
   *      the system prompt describes.
   *
   * This is intentionally simple but is NOT a placeholder — it produces
   * useful, citation-bearing answers from the snippets it is given, and
   * it is the answer real tenants will see in dev when no key is set.
   */
  private localFallback(messages: ChatMessage[]): string {
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    const sysMsg = messages.find((m) => m.role === 'system');
    const query = (userMsg?.content ?? '').trim();
    const sysContent = sysMsg?.content ?? '';

    // Pull the CONTEXTO block out of the system prompt so we can quote it.
    const contextMatch = sysContent.match(/CONTEXTO:\s*([\s\S]*?)$/i);
    let contextBody = contextMatch?.[1]?.trim() ?? '';

    // Strip the "--- Documento: ..." wrappers and split into entries.
    const entries = contextBody
      .split(/\n--- Documento: /)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((entry) => {
        const meta = entry.match(/^([^\n]+)\n([\s\S]*)$/);
        if (!meta) return { meta: entry, body: entry };
        return { meta: meta[1].trim(), body: meta[2].trim() };
      });

    const q = query.toLowerCase();
    const asksForTotal = /\b(total|soma|quanto|valor agregado)\b/.test(q);
    const asksForLookup = /\b(mostra|detalhes|fatura|documento|procurar)\b/.test(q);
    const asksForCount = /\b(quantos|numero de|quantidade de)\b/.test(q);

    if (entries.length === 0) {
      return (
        'Nao encontrei essa informacao nos documentos disponiveis do tenant. ' +
        'Fornece mais detalhes ou verifica se os documentos ja foram processados.'
      );
    }

    // Extract EUR amounts and dates from the entries.
    const amounts: number[] = [];
    const dateRe = /\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/g;
    const dateHits: string[] = [];
    const suppliers = new Set<string>();
    const nifRe = /\b\d{9}\b/g;
    const nifs: string[] = [];

    for (const e of entries) {
      const body = e.body;
      const eurMatches = body.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})\s*(?:EUR|€)?/g);
      if (eurMatches) {
        for (const m of eurMatches) {
          const n = parseFloat(m.replace(/\./g, '').replace(',', '.'));
          if (Number.isFinite(n) && n > 0 && n < 1e8) amounts.push(n);
        }
      }
      const dm = body.match(dateRe);
      if (dm) dateHits.push(...dm);
      const supMatch = body.match(/(?:Fornecedor|Supplier)[:\s]+([^\n]+)/i);
      if (supMatch) suppliers.add(supMatch[1].trim().slice(0, 60));
      const nifMatch = body.match(nifRe);
      if (nifMatch) nifs.push(...nifMatch);
    }

    const fmtEur = (n: number) =>
      n.toLocaleString('pt-PT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const lines: string[] = [];

    if (asksForTotal && amounts.length > 0) {
      const total = amounts.reduce((a, b) => a + b, 0);
      lines.push(
        `Com base em ${entries.length} documento(s) do tenant, ` +
          `o total agregado e de ${fmtEur(total)} EUR.`,
      );
      const first = amounts[0];
      const last = amounts[amounts.length - 1];
      lines.push(
        `Valor minimo: ${fmtEur(Math.min(...amounts))} EUR | ` +
          `maximo: ${fmtEur(Math.max(...amounts))} EUR | ` +
          `mediana: ${fmtEur(
            [...amounts].sort((a, b) => a - b)[Math.floor(amounts.length / 2)],
          )} EUR.`,
      );
      if (first !== undefined && last !== undefined && first !== total && entries.length > 1) {
        lines.push(
          `Nota: o calculo soma todos os montantes EUR detetados nos snippets ` +
            `(${amounts.length} valores). Se algum snippet contiver varios totais ` +
            `(ex.: IVA + base + total), confirma a fonte.`,
        );
      }
    } else if (asksForCount) {
      lines.push(
        `Foram encontrados ${entries.length} documento(s) correspondente(s) ` +
          `no contexto do tenant.`,
      );
      if (dateHits.length > 0) {
        lines.push(`Datas detetadas: ${dateHits.slice(0, 8).join(', ')}.`);
      }
    } else if (asksForLookup || entries.length <= 3) {
      // Direct answer: cite the top entries.
      const top = entries.slice(0, 5);
      lines.push(`Encontrei ${entries.length} documento(s) relevante(s):`);
      for (const e of top) {
        const summary = e.body.length > 220 ? e.body.slice(0, 217) + '...' : e.body;
        lines.push(`• [${e.meta}] ${summary.replace(/\s+/g, ' ').trim()}`);
      }
    } else {
      // General summary.
      lines.push(
        `Resumo de ${entries.length} documento(s) do tenant:`,
      );
      const top = entries.slice(0, 5);
      for (const e of top) {
        const summary = e.body.length > 160 ? e.body.slice(0, 157) + '...' : e.body;
        lines.push(`• [${e.meta}] ${summary.replace(/\s+/g, ' ').trim()}`);
      }
      if (suppliers.size > 0) {
        lines.push(
          `Fornecedores detetados: ${Array.from(suppliers).slice(0, 6).join(', ')}.`,
        );
      }
      if (nifs.length > 0) {
        lines.push(`NIFs mencionados: ${Array.from(new Set(nifs)).slice(0, 6).join(', ')}.`);
      }
    }

    lines.push('');
    lines.push(
      `Esta resposta foi gerada pelo motor local deterministico da DocFlow ` +
        `(sem chave Opus 5). Define ANTHROPIC_API_KEY no .env para usar o ` +
        `modelo Opus 5 real.`,
    );

    return lines.join('\n');
  }
}
