// llm-provider.spec.ts — exercises the deterministic local fallback so
// dev/CI runs without an Anthropic key still cover the chat path. The
// fallback has to produce a coherent Portuguese answer with a citation
// footer so tenants see useful output even before they wire a key.

import { ConfigService } from '@nestjs/config';
import { LlmProvider } from './llm-provider';

describe('LlmProvider (local fallback)', () => {
  const cfg = new ConfigService({
    // no ANTHROPIC_API_KEY → fallback path
    ANTHROPIC_API_KEY: '',
  });
  let llm: LlmProvider;

  beforeEach(() => {
    llm = new LlmProvider(cfg);
  });

  it('uses the local fallback when no API key is set', async () => {
    expect(llm.liveProviderAvailable).toBe(false);
    const r = await llm.chat([
      { role: 'system', content: 'CONTEXTO:\n--- Documento: doc-1 (full_text) ---\nFT 1 PT-Telecom 250,00 EUR 01/08/2026' },
      { role: 'user', content: 'mostra os detalhes' },
    ]);
    expect(r.provider).toBe('local-fallback');
    expect(r.model).toBe('docflow-local-v1');
    expect(r.content).toContain('PT-Telecom');
    expect(r.content).toContain('motor local deterministico');
  });

  it('handles empty context with the not-found fallback', async () => {
    const r = await llm.chat([
      { role: 'system', content: 'CONTEXTO:\n' },
      { role: 'user', content: 'mostra os detalhes' },
    ]);
    expect(r.content).toMatch(/Nao encontrei essa informacao/);
  });

  it('sums EUR amounts for an aggregation question', async () => {
    const r = await llm.chat([
      {
        role: 'system',
        content:
          'CONTEXTO:\n--- Documento: d1 (full_text) ---\nFornecedor A total 100,00 EUR\n--- Documento: d2 (full_text) ---\nFornecedor B total 250,00 EUR',
      },
      { role: 'user', content: 'qual o total agregado?' },
    ]);
    // 100 + 250 = 350,00
    expect(r.content).toMatch(/350,00 EUR/);
  });
});