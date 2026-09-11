import {
  ATCUD_PATTERN,
  UNVALIDATED_CONFIDENCE_CAP,
  fieldConfidence,
  isPortugueseDocument,
  normalizeVatId,
  resolveDocumentCountry,
  resolveTaxIds,
  extractAtcudFromText,
  sanitizeAtcud,
  shouldClearStoredAtcud,
  shouldClearStoredNif,
  vatCountry,
} from '../field-validation';
import { detectNonFiscalKind } from '../fiscal-status';

/**
 * Fase 4.1 — o teste real do Rui apanhou uma "oferta de venta" espanhola
 * (VOV26009084, TEFCOLD ES S.L.) marcada como documento fiscal, com o NIF
 * 500000001 e o ATCUD ABC1234-56789 inventados pelo modelo e ambos
 * apresentados com 90 % de confiança. Estes testes fixam as regras
 * determinísticas que impedem que isso volte a acontecer.
 */
describe('sanitizeAtcud() — o ATCUD só existe em Portugal', () => {
  it('descarta o ATCUD de qualquer documento não-PT, venha de onde vier', () => {
    for (const country of ['ES', 'FR', 'DE', 'GB', 'US']) {
      expect(
        sanitizeAtcud('JFXG7XVG-7018', { country, fromTrustedQr: true }).atcud,
      ).toBeNull();
    }
  });

  it('descarta o ATCUD quando não se sabe o país (nunca assume PT)', () => {
    const out = sanitizeAtcud('JFXG7XVG-7018', { country: null, fromTrustedQr: false });
    expect(out.atcud).toBeNull();
    expect(out.reason).toContain('non_pt');
  });

  it('rejeita o ABC1234-56789 que o modelo inventou (código de validação com 7 caracteres)', () => {
    expect(ATCUD_PATTERN.test('ABC1234-56789')).toBe(false);
    const out = sanitizeAtcud('ABC1234-56789', { country: 'PT', fromTrustedQr: false });
    expect(out.atcud).toBeNull();
    expect(out.reason).toContain('bad_format');
  });

  it('aceita os ATCUD reais das amostras quando o documento é PT', () => {
    for (const real of ['JFXG7XVG-7018', 'J6HDFZVX-202600846', '1628J3VX-4791', 'JJY2HD8C-0000428']) {
      expect(sanitizeAtcud(real, { country: 'PT', fromTrustedQr: true }).atcud).toBe(real);
    }
  });

  it('distingue a origem: com QR real vs. só o formato certo', () => {
    expect(sanitizeAtcud('JFXG7XVG-7018', { country: 'PT', fromTrustedQr: true }).reason).toBe('atcud_from_qr');
    expect(sanitizeAtcud('JFXG7XVG-7018', { country: 'pt', fromTrustedQr: false }).reason).toBe('atcud_format_only_no_qr');
  });

  it('normaliza maiúsculas e espaços, e trata a ausência sem erro', () => {
    expect(sanitizeAtcud('  jfxg7xvg-7018 ', { country: 'PT', fromTrustedQr: true }).atcud).toBe('JFXG7XVG-7018');
    expect(sanitizeAtcud(null, { country: 'PT', fromTrustedQr: true }).atcud).toBeNull();
    expect(sanitizeAtcud(undefined, { country: 'PT', fromTrustedQr: true }).reason).toBe('atcud_absent');
  });
});

describe('resolveTaxIds() — nenhum NIF é gravado sem validação', () => {
  it('grava o NIF português que passa o módulo 11', () => {
    const out = resolveTaxIds({ supplierNif: '507298608', country: 'PT' });
    expect(out).toMatchObject({ nif: '507298608', validation: 'PT_MOD11', needsReview: false });
  });

  it('recusa os NIFs da CREATEINFOR que falham o módulo 11 (caso real em produção)', () => {
    // As três cópias do mesmo documento chegaram com 507298608 (válido),
    // 507290608 e 507298808 (ambos inválidos) — dois em três gravados.
    for (const bad of ['507290608', '507298808', '500000001']) {
      const out = resolveTaxIds({ supplierNif: bad, country: 'PT' });
      expect(out.nif).toBeNull();
      expect(out.rejected).toBe(bad);
      expect(out.validation).toBe('UNVALIDATED');
      expect(out.needsReview).toBe(true);
    }
  });

  it('aceita o NIF-IVA comunitário só depois de o VIES confirmar', () => {
    const pending = resolveTaxIds({ supplierVatId: 'ESB09802059', country: 'ES', viesValidated: false });
    expect(pending.nif).toBeNull();
    expect(pending.reason).toContain('vies_unconfirmed');
    expect(pending.needsReview).toBe(true);

    const ok = resolveTaxIds({ supplierVatId: 'ESB09802059', country: 'ES', viesValidated: true });
    expect(ok).toMatchObject({ nif: 'ESB09802059', validation: 'VIES', needsReview: false });
  });

  it('recusa um NIF-IVA comunitário com sintaxe inválida mesmo com viesValidated', () => {
    const out = resolveTaxIds({ supplierVatId: 'ES!!', country: 'ES', viesValidated: true });
    expect(out.nif).toBeNull();
    expect(out.reason).toContain('bad_syntax');
  });

  it('nunca confirma um número extra-UE — fica como texto não validado', () => {
    const out = resolveTaxIds({ supplierVatId: 'GB123456789', country: 'GB' });
    expect(out.nif).toBeNull();
    expect(out.vatId).toBe('GB123456789');
    expect(out.validation).toBe('UNVALIDATED');
    expect(out.needsReview).toBe(true);
  });

  it('normaliza espaços e pontuação antes de validar', () => {
    expect(resolveTaxIds({ supplierNif: '507 298 608', country: 'PT' }).nif).toBe('507298608');
    expect(resolveTaxIds({ supplierVatId: 'es-b09802059', country: 'ES', viesValidated: true }).nif).toBe('ESB09802059');
  });

  it('devolve NONE quando não há identificador nenhum', () => {
    expect(resolveTaxIds({ country: 'PT' })).toMatchObject({ validation: 'NONE', nif: null, needsReview: true });
    expect(resolveTaxIds({})).toMatchObject({ validation: 'NONE' });
  });

  it('deriva PT do NIF-IVA quando o país extraído contradiz o prefixo', () => {
    // O prefixo do NIF-IVA é mais fiável do que o país que o modelo inferiu.
    const out = resolveTaxIds({ supplierVatId: 'PT507298608', country: 'ES' });
    expect(out).toMatchObject({ nif: '507298608', validation: 'PT_MOD11' });
  });
});

describe('resolveDocumentCountry()', () => {
  it('dá prioridade ao prefixo do NIF-IVA', () => {
    expect(resolveDocumentCountry({ supplierVatId: 'ESB09802059', country: 'PT' })).toBe('ES');
  });
  it('usa o país extraído quando não há NIF-IVA', () => {
    expect(resolveDocumentCountry({ country: 'fr' })).toBe('FR');
  });
  it('infere PT a partir de um QR-AT válido', () => {
    expect(resolveDocumentCountry({ qrIssuerNif: '502084006' })).toBe('PT');
  });
  it('infere PT a partir de um NIF PT válido, mas não de um inválido', () => {
    expect(resolveDocumentCountry({ supplierNif: '502084006' })).toBe('PT');
    expect(resolveDocumentCountry({ supplierNif: '500000001' })).toBeNull();
  });
  it('devolve null quando não há sinal nenhum — nunca assume PT', () => {
    expect(resolveDocumentCountry({})).toBeNull();
  });
});

describe('fieldConfidence() — a confiança tem de refletir a validação', () => {
  it('põe teto baixo num valor que veio só do modelo', () => {
    expect(fieldConfidence(0.9, 'ai')).toBe(UNVALIDATED_CONFIDENCE_CAP);
    expect(UNVALIDATED_CONFIDENCE_CAP).toBeLessThan(0.9);
  });
  it('mantém a confiança quando o valor foi validado ou veio do QR', () => {
    expect(fieldConfidence(0.9, 'validated')).toBe(0.9);
    expect(fieldConfidence(0.9, 'qr')).toBe(0.9);
  });
  it('não inventa confiança quando não havia nenhuma', () => {
    expect(fieldConfidence(undefined, 'qr')).toBeNull();
    expect(fieldConfidence(Number.NaN, 'validated')).toBeNull();
  });
  it('mantém valores já baixos abaixo do teto', () => {
    expect(fieldConfidence(0.2, 'ai')).toBe(0.2);
  });
});

describe('detectNonFiscalKind() — palavras-chave acrescentadas na Fase 4.1', () => {
  it('apanha a "OFERTA DE VENTA" da TEFCOLD que passou por fatura', () => {
    expect(detectNonFiscalKind('OFERTA DE VENTA VOV26009084')).toBe('ORCAMENTO');
    expect(detectNonFiscalKind('Oferta de venta')).toBe('ORCAMENTO');
  });
  it('apanha as restantes formas pedidas pelo Rui', () => {
    const cases: Array<[string, string]> = [
      ['PRESUPUESTO Nº 123', 'ORCAMENTO'],
      ['Quotation', 'ORCAMENTO'],
      ['Quote', 'ORCAMENTO'],
      ['Angebot', 'ORCAMENTO'],
      ['Kostenvoranschlag', 'ORCAMENTO'],
      ['Orçamento 2026/1', 'ORCAMENTO'],
      ['Pro forma', 'PROFORMA'],
      ['PROFORMA INVOICE', 'PROFORMA'],
      ['Aviso de pagamento', 'AVISO_PAGAMENTO'],
      ['Extrato de conta', 'EXTRATO_FORNECEDOR'],
      ['Nota de encomenda 45', 'ENCOMENDA'],
      ['PURCHASE ORDER', 'ENCOMENDA'],
    ];
    for (const [text, expected] of cases) {
      expect([text, detectNonFiscalKind(text)]).toEqual([text, expected]);
    }
  });
  it('não marca uma fatura normal como não fiscal', () => {
    expect(detectNonFiscalKind('FATURA FT 2026/1234')).toBeNull();
    expect(detectNonFiscalKind('FACTURA SIMPLIFICADA')).toBeNull();
  });
});

describe('shouldClearStoredAtcud / shouldClearStoredNif — limpar o lixo já gravado', () => {
  it('limpa os totais que ficaram gravados na coluna do ATCUD (caso real em produção)', () => {
    // Documentos reais: "1012.30", "155.00", "32.40", "1.94", "918.60"
    // estavam no campo atcud — são totais, não códigos da AT.
    for (const junk of ['1012.30', '155.00', '32.40', '1.94', '918.60']) {
      expect(shouldClearStoredAtcud(junk, 'PT', null)).toBe(true);
    }
  });

  it('limpa um ATCUD válido que esteja num documento não-PT', () => {
    expect(shouldClearStoredAtcud('JFXG7XVG-7018', 'ES', null)).toBe(true);
  });

  it('não mexe num ATCUD válido de um documento PT', () => {
    expect(shouldClearStoredAtcud('JFXG7XVG-7018', 'PT', null)).toBe(false);
  });

  it('não limpa quando vamos escrever um valor bom por cima', () => {
    expect(shouldClearStoredAtcud('1012.30', 'PT', 'J66V9C9T-6781')).toBe(false);
  });

  it('não faz nada quando não havia nada gravado', () => {
    expect(shouldClearStoredAtcud(null, 'PT', null)).toBe(false);
    expect(shouldClearStoredNif(null, 'PT', null, false)).toBe(false);
  });

  it('limpa os NIFs que falham o módulo 11 e mantém os que passam', () => {
    expect(shouldClearStoredNif('507290608', 'PT', null, false)).toBe(true);
    expect(shouldClearStoredNif('507298808', 'PT', null, false)).toBe(true);
    expect(shouldClearStoredNif('507298608', 'PT', null, false)).toBe(false);
  });

  it('limpa um NIF-IVA comunitário que o VIES não confirma, e mantém o que confirma', () => {
    expect(shouldClearStoredNif('ESB09802059', 'ES', null, false)).toBe(true);
    expect(shouldClearStoredNif('ESB09802059', 'ES', null, true)).toBe(false);
  });

  it('limpa um identificador extra-UE — nunca é um NIF confirmado', () => {
    expect(shouldClearStoredNif('GB123456789', 'GB', null, true)).toBe(true);
  });
});

describe('helpers', () => {
  it('normalizeVatId / vatCountry', () => {
    expect(normalizeVatId(' es-b098.020 59 ')).toBe('ESB09802059');
    expect(normalizeVatId('')).toBeNull();
    expect(vatCountry('ESB09802059')).toBe('ES');
    expect(vatCountry('12345')).toBeNull();
  });
  it('isPortugueseDocument', () => {
    expect(isPortugueseDocument('pt')).toBe(true);
    expect(isPortugueseDocument('ES')).toBe(false);
    expect(isPortugueseDocument(null)).toBe(false);
  });
});

/**
 * Fase 4.1 (P2.1) — em várias fotos PT o QR-AT lê-se mas o ATCUD não
 * chegava ao documento. Quando não há QR, tentamos o "ATCUD:" impresso.
 */
describe('extractAtcudFromText()', () => {
  it('apanha o ATCUD impresso nas várias formas que aparecem nas faturas', () => {
    expect(extractAtcudFromText('ATCUD: JFXG7XVG-7018')).toBe('JFXG7XVG-7018');
    expect(extractAtcudFromText('ATCUD JFXG7XVG-7018')).toBe('JFXG7XVG-7018');
    expect(extractAtcudFromText('ATCUD:JFXG7XVG-7018')).toBe('JFXG7XVG-7018');
    expect(extractAtcudFromText('atcud - jfxg7xvg-7018')).toBe('JFXG7XVG-7018');
  });

  it('encontra-o no meio do texto de uma fatura', () => {
    const ocr = [
      'FATURA FT 2026A/7018',
      'ATCUD: JFXG7XVG-7018   Doc. processado por programa certificado',
      'Total 572,57 EUR',
    ].join(String.fromCharCode(10));
    expect(extractAtcudFromText(ocr)).toBe('JFXG7XVG-7018');
  });

  it('não aceita um código com formato inválido, mesmo rotulado de ATCUD', () => {
    expect(extractAtcudFromText('ATCUD: ABC1234-56789')).toBeNull();
    expect(extractAtcudFromText('ATCUD: 1012.30')).toBeNull();
  });

  it('devolve null quando não há ATCUD nenhum', () => {
    expect(extractAtcudFromText('FATURA FT 2026/1')).toBeNull();
    expect(extractAtcudFromText('')).toBeNull();
    expect(extractAtcudFromText(null)).toBeNull();
  });
});
