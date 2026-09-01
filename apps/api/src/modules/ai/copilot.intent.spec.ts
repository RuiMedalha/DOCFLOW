// copilot.intent.spec.ts — intent classification + LOOKUP/AGGREGATION
// routing. The deterministic local LLM fallback is exercised in
// llm-provider.spec.ts. Together these cover the contract surface
// without needing a live DB.

import { CopilotService } from './copilot.service';

describe('CopilotService intent classification', () => {
  let svc: CopilotService;

  beforeEach(() => {
    svc = new CopilotService(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never,
    );
  });

  it.each([
    ['Quanto tenho a pagar este mes?', 'AGGREGATION'],
    ['Qual o total de faturas da Interotel em 2025?', 'AGGREGATION'],
    ['Soma por fornecedor', 'AGGREGATION'],
    ['Qual o saldo do banco?', 'AGGREGATION'],
    ['mostra-me a fatura FT 1', 'LOOKUP'],
    ['detalhes do documento especifico', 'LOOKUP'],
    ['procurar a fatura FT 2026/001', 'LOOKUP'],
    ['Qual a fatura FT 2025/847?', 'LOOKUP'],
    ['estado das faturas pendentes', 'STATUS'],
    ['ha alguma fatura suspeita este mes?', 'ANOMALY'],
    ['documentos duplicados', 'DUPLICATE_CHECK'],
    ['que tipo de documento e este?', 'CLASSIFY'],
    ['exporta as faturas do fornecedor X', 'EXPORT'],
    ['explica o IVA desta fatura', 'EXPLANATION'],
    ['previsao de IVA proximo trimestre', 'PREDICTION'],
    ['comparar 2024 vs 2025', 'COMPARISON'],
    ['olá', 'GENERAL'],
  ])('classifies "%s" as %s', (query, expected) => {
    expect(svc.classifyIntent(query)).toBe(expected);
  });
});