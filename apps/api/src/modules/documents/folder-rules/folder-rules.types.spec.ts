import {
  buildPatternContext,
  decideFilingFolder,
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  mapToExpenseCategory,
  matchesConditions,
  normalise,
  origemFromCountry,
  sanitizeCategoryForPath,
  sanitizeForPath,
  substitutePattern,
} from './folder-rules.types';

/**
 * Folder-rules pure-function tests — these exercise the matching +
 * substitution logic WITHOUT a database or Nest runtime, so they run
 * fast and predictably. The integration with Prisma lives in
 * folder-rules.engine.spec.ts.
 */

describe('folder-rules.types', () => {
  // ──────────────────────────────────────────────── sanitizeForPath
  describe('sanitizeForPath()', () => {
    it('strips diacritics and lowercases', () => {
      expect(sanitizeForPath('EDP Comercial')).toBe('edp_comercial');
      expect(sanitizeForPath('Fornecedor Açôres Lda')).toBe('fornecedor_acores_lda');
    });

    it('collapses whitespace to a single underscore', () => {
      expect(sanitizeForPath('  multiple   spaces ')).toBe('multiple_spaces');
      expect(sanitizeForPath('foo\tbar')).toBe('foo_bar');
    });

    it('strips non-alphanumeric chars (slashes, backslashes, punctuation)', () => {
      expect(sanitizeForPath('a/b\\c')).toBe('abc');
      expect(sanitizeForPath('foo (bar) [baz]')).toBe('foo_bar_baz');
    });

    it('returns "_" for empty / null / undefined input', () => {
      expect(sanitizeForPath('')).toBe('_');
      expect(sanitizeForPath(null)).toBe('_');
      expect(sanitizeForPath(undefined)).toBe('_');
      expect(sanitizeForPath('   ')).toBe('_');
    });

    it('removes leading/trailing underscores', () => {
      expect(sanitizeForPath('___foo___')).toBe('foo');
    });
  });

  // ──────────────────────────────────────────────── sanitizeCategoryForPath
  describe('sanitizeCategoryForPath()', () => {
    it('turns "Serviços/FSE" into "servicos-fse" (kebab, not underscore)', () => {
      expect(sanitizeCategoryForPath('Serviços/FSE')).toBe('servicos-fse');
    });
    it('still handles plain categories', () => {
      expect(sanitizeCategoryForPath('Refeições')).toBe('refeicoes');
    });
    it('returns "_" for empty input', () => {
      expect(sanitizeCategoryForPath('')).toBe('_');
      expect(sanitizeCategoryForPath(null)).toBe('_');
    });
  });

  // ──────────────────────────────────────────────── matchesConditions
  describe('matchesConditions()', () => {
    it('matches everything when conditions are empty', () => {
      expect(matchesConditions(null, { type: 'OUTRO' as any })).toBe(true);
      expect(matchesConditions(undefined, { type: 'OUTRO' as any })).toBe(true);
      expect(matchesConditions({}, { type: 'OUTRO' as any })).toBe(true);
    });

    it('matches by DocumentType', () => {
      expect(
        matchesConditions({ type: 'FATURA_RECEBIDA' as any }, {
          type: 'FATURA_RECEBIDA' as any,
        }),
      ).toBe(true);
      expect(
        matchesConditions({ type: 'FATURA_RECEBIDA' as any }, {
          type: 'FATURA_EMITIDA' as any,
        }),
      ).toBe(false);
    });

    it('matches supplier as case-insensitive substring', () => {
      expect(
        matchesConditions({ supplier: 'EDP' }, { type: 'OUTRO' as any, supplier: 'EDP Comercial SA' }),
      ).toBe(true);
      expect(
        matchesConditions({ supplier: 'edp' }, { type: 'OUTRO' as any, supplier: 'EDP Comercial SA' }),
      ).toBe(true);
      expect(
        matchesConditions({ supplier: 'EDP' }, { type: 'OUTRO' as any, supplier: 'Galp' }),
      ).toBe(false);
      expect(
        matchesConditions({ supplier: 'EDP' }, { type: 'OUTRO' as any }),
      ).toBe(false);
    });

    it('matches supplier NIF exactly', () => {
      expect(
        matchesConditions({ supplierNif: '500000001' }, {
          type: 'OUTRO' as any,
          supplierNif: '500000001',
        }),
      ).toBe(true);
      expect(
        matchesConditions({ supplierNif: '500000001' }, {
          type: 'OUTRO' as any,
          supplierNif: '500000002',
        }),
      ).toBe(false);
    });

    it('matches email domain suffix', () => {
      expect(
        matchesConditions({ emailDomain: 'edp.pt' }, {
          type: 'OUTRO' as any,
          emailDomain: 'faturas@edp.pt',
        }),
      ).toBe(true);
      expect(
        matchesConditions({ emailDomain: 'edp.pt' }, {
          type: 'OUTRO' as any,
          emailDomain: 'faturas@galp.pt',
        }),
      ).toBe(false);
    });

    it('matches keywords with OR semantics', () => {
      expect(
        matchesConditions({ keywords: ['eletricidade', 'gas'] }, {
          type: 'OUTRO' as any,
          keywords: ['recibo eletricidade janeiro'],
        }),
      ).toBe(true);
      expect(
        matchesConditions({ keywords: ['eletricidade', 'gas'] }, {
          type: 'OUTRO' as any,
          keywords: ['recibo agua'],
        }),
      ).toBe(false);
      expect(
        matchesConditions({ keywords: ['eletricidade'] }, {
          type: 'OUTRO' as any,
          keywords: [],
        }),
      ).toBe(false);
    });

    it('requires ALL non-empty conditions to hold (AND across fields)', () => {
      expect(
        matchesConditions(
          { type: 'FATURA_RECEBIDA' as any, supplier: 'EDP' },
          { type: 'FATURA_RECEBIDA' as any, supplier: 'EDP' },
        ),
      ).toBe(true);
      expect(
        matchesConditions(
          { type: 'FATURA_RECEBIDA' as any, supplier: 'EDP' },
          { type: 'FATURA_RECEBIDA' as any, supplier: 'Galp' },
        ),
      ).toBe(false);
    });

    it('matches AI suggestedCategory as part of the keyword haystack', () => {
      expect(
        matchesConditions(
          { keywords: ['62.2.4', 'Honorários'] },
          {
            type: 'FATURA_RECEBIDA' as any,
            keywords: [],
            suggestedCategory: '62.2.4 — Honorários',
          },
        ),
      ).toBe(true);
      expect(
        matchesConditions(
          { keywords: ['62.4.1 — Eletricidade'] },
          {
            type: 'FATURA_RECEBIDA' as any,
            keywords: [],
            suggestedCategory: '62.4.2 — Combustíveis',
          },
      ),
      ).toBe(false);
    });
  });

  // ──────────────────────────────────────────────── substitutePattern
  describe('substitutePattern()', () => {
    const ctx = {
      Ano: '2026',
      Mes: '08',
      Tipo: 'fatura_recebida',
      Entidade: 'EDP Comercial',
      Categoria: 'Refeições',
      Pais: 'pt',
      Origem: 'Nacional',
    };

    it('replaces all known tokens', () => {
      expect(substitutePattern('/{Ano}/{Mes}/{Tipo}/{Entidade}', ctx)).toBe(
        '/2026/08/fatura_recebida/edp_comercial',
      );
    });

    it('sanitizes Entidade for filesystem use', () => {
      expect(substitutePattern('/Faturas/{Entidade}', { ...ctx, Entidade: 'Fornecedor Açôres Lda' }))
        .toBe('/Faturas/fornecedor_acores_lda');
    });

    it('replaces Categoria / Pais / Origem with sanitised values', () => {
      expect(
        substitutePattern('/Despesas/{Categoria}/{Ano}/{Mes}', ctx),
      ).toBe('/Despesas/refeicoes/2026/08');
      expect(
        substitutePattern('/Estrangeiras/{Origem}/{Pais}', ctx),
      ).toBe('/Estrangeiras/nacional/pt');
    });

    it('renders _ for missing category / country / entity', () => {
      const empty = { ...ctx, Categoria: '', Pais: '', Origem: '', Entidade: '' };
      expect(
        substitutePattern('/Despesas/{Categoria}/{Ano}/{Mes}', empty),
      ).toBe('/Despesas/_/2026/08');
      expect(
        substitutePattern('/Fornecedores/{Entidade}/{Ano}/{Mes}', empty),
      ).toBe('/Fornecedores/_/2026/08');
    });

    it('preserves unknown tokens as _TOKEN_', () => {
      expect(substitutePattern('/{Ano}/{Unknown}/{Tipo}', ctx)).toBe('/2026/_Unknown_/fatura_recebida');
    });

    it('handles patterns without tokens', () => {
      expect(substitutePattern('/Inbox/Faturas', ctx)).toBe('/Inbox/Faturas');
    });
  });

  // ──────────────────────────────────────────────── buildPatternContext
  describe('buildPatternContext()', () => {
    it('uses UTC components and falls back to customer when no supplier', () => {
      const ctx = buildPatternContext(
        { type: 'FATURA_EMITIDA' as any, customer: 'Cliente Demo SA' },
        new Date('2026-08-15T23:00:00Z'),
      );
      expect(ctx.Ano).toBe('2026');
      expect(ctx.Mes).toBe('08');
      expect(ctx.Tipo).toBe('FATURA_EMITIDA');
      expect(ctx.Entidade).toBe('Cliente Demo SA');
      expect(ctx.Categoria).toBe('');
      expect(ctx.Pais).toBe('');
      expect(ctx.Origem).toBe('');
    });

    it('prefers supplier over customer', () => {
      const ctx = buildPatternContext(
        {
          type: 'FATURA_RECEBIDA' as any,
          supplier: 'EDP',
          customer: 'Cliente',
        },
        new Date('2026-01-01T00:00:00Z'),
      );
      expect(ctx.Entidade).toBe('EDP');
    });

    it('pads month to 2 digits', () => {
      const ctx = buildPatternContext(
        { type: 'OUTRO' as any },
        new Date('2026-03-15T00:00:00Z'),
      );
      expect(ctx.Mes).toBe('03');
    });

    it('derives Origem from supplierCountry (PT → Nacional, else Estrangeira)', () => {
      const pt = buildPatternContext(
        { type: 'OUTRO' as any, supplier: 'EDP', supplierCountry: 'PT' },
        new Date('2026-08-15T00:00:00Z'),
      );
      expect(pt.Origem).toBe('Nacional');
      expect(pt.Pais).toBe('PT');

      const es = buildPatternContext(
        { type: 'OUTRO' as any, supplier: 'Iberdrola', supplierCountry: 'ES' },
        new Date('2026-08-15T00:00:00Z'),
      );
      expect(es.Origem).toBe('Estrangeira');
      expect(es.Pais).toBe('ES');
    });
  });

  // ──────────────────────────────────────────────── category mapping
  describe('mapToExpenseCategory()', () => {
    it('maps a free Portuguese phrase to the right category', () => {
      expect(mapToExpenseCategory('Restaurante')).toBe('Refeições');
      expect(mapToExpenseCategory('combustivel')).toBe('Combustível');
      expect(mapToExpenseCategory('Hotel Lisboa')).toBe('Alojamento');
      expect(mapToExpenseCategory('Portagem A5')).toBe('Deslocações');
    });

    it('is case- and diacritic-insensitive', () => {
      expect(mapToExpenseCategory('COMBUSTÍVEL')).toBe('Combustível');
      expect(mapToExpenseCategory('Alojamento')).toBe('Alojamento');
      expect(mapToExpenseCategory('REFEIÇÕES')).toBe('Refeições');
    });

    it('maps SNC codes (62.x.y) onto the right bucket', () => {
      expect(mapToExpenseCategory('62.4.2 — Combustíveis')).toBe('Combustível');
      // 62.4.1 isn't in the table → no match
      expect(mapToExpenseCategory('62.4.1 — Eletricidade')).toBeNull();
      expect(mapToExpenseCategory('62.4.3 — Deslocações')).toBe('Deslocações');
    });

    it('returns null when nothing matches', () => {
      expect(mapToExpenseCategory('')).toBeNull();
      expect(mapToExpenseCategory(null)).toBeNull();
      expect(mapToExpenseCategory(undefined)).toBeNull();
      expect(mapToExpenseCategory('xyz não é categoria')).toBeNull();
    });

    it('first match wins (62.4.2 Combustível before any 62.x generic)', () => {
      expect(mapToExpenseCategory('62.4.2 Combustivel')).toBe('Combustível');
    });
  });

  // ──────────────────────────────────────────────── isExpenseCategory
  describe('isExpenseCategory()', () => {
    it('accepts slugs from the canonical list', () => {
      expect(isExpenseCategory('Refeições')).toBe(true);
      expect(isExpenseCategory('Combustível')).toBe(true);
      expect(isExpenseCategory('Serviços/FSE')).toBe(true);
    });
    it('rejects unknown slugs', () => {
      expect(isExpenseCategory('NaoExiste')).toBe(false);
      expect(isExpenseCategory('')).toBe(false);
      expect(isExpenseCategory(null)).toBe(false);
      expect(isExpenseCategory(undefined)).toBe(false);
    });
    it('exposes the canonical list for callers', () => {
      expect(EXPENSE_CATEGORIES).toContain('Refeições');
      expect(EXPENSE_CATEGORIES.length).toBeGreaterThanOrEqual(7);
    });
  });

  // ──────────────────────────────────────────────── normalise
  describe('normalise()', () => {
    it('lowercases and strips diacritics', () => {
      expect(normalise('Restaurante')).toBe('restaurante');
      expect(normalise('Alojamento')).toBe('alojamento');
      expect(normalise('COMBUSTÍVEL')).toBe('combustivel');
    });
    it('returns empty string for null / undefined', () => {
      expect(normalise(null)).toBe('');
      expect(normalise(undefined)).toBe('');
    });
  });

  // ──────────────────────────────────────────────── origemFromCountry
  describe('origemFromCountry()', () => {
    it('maps PT (any case) to Nacional', () => {
      expect(origemFromCountry('PT')).toBe('Nacional');
      expect(origemFromCountry('pt')).toBe('Nacional');
      expect(origemFromCountry(' Pt ')).toBe('Nacional');
    });
    it('maps every other country to Estrangeira', () => {
      expect(origemFromCountry('ES')).toBe('Estrangeira');
      expect(origemFromCountry('FR')).toBe('Estrangeira');
      expect(origemFromCountry('US')).toBe('Estrangeira');
    });
    it('returns empty string when country is unknown', () => {
      expect(origemFromCountry(null)).toBe('');
      expect(origemFromCountry(undefined)).toBe('');
      expect(origemFromCountry('')).toBe('');
    });
  });

  // ──────────────────────────────────────────────── decideFilingFolder
  describe('decideFilingFolder()', () => {
    const baseCtx = {
      Ano: '2026',
      Mes: '08',
      Tipo: 'FATURA_RECEBIDA',
      Entidade: '',
      Categoria: '',
      Pais: '',
      Origem: 'Nacional',
    };

    it('(a) meals → /Despesas/refeicoes/2026/08', () => {
      expect(
        decideFilingFolder({ ...baseCtx, Categoria: 'Refeições' }, false),
      ).toBe('/Despesas/refeicoes/2026/08');
    });

    it('(b) fuel → /Despesas/combustivel/2026/08', () => {
      expect(
        decideFilingFolder({ ...baseCtx, Categoria: 'Combustível' }, false),
      ).toBe('/Despesas/combustivel/2026/08');
    });

    it('(c) recurring supplier → /Fornecedores/{Nome}/2026/08 (national)', () => {
      expect(
        decideFilingFolder(
          { ...baseCtx, Entidade: 'EDP Comercial' },
          true,
        ),
      ).toBe('/Fornecedores/edp_comercial/2026/08');
    });

    it('(d) foreign (PT absent) routes to /Estrangeiras/...', () => {
      expect(
        decideFilingFolder(
          { ...baseCtx, Pais: 'ES', Origem: 'Estrangeira', Categoria: 'Refeições' },
          false,
        ),
      ).toBe('/Estrangeiras/Despesa/refeicoes/2026/08');
      expect(
        decideFilingFolder(
          { ...baseCtx, Pais: 'ES', Origem: 'Estrangeira', Entidade: 'Iberdrola' },
          true,
        ),
      ).toBe('/Estrangeiras/Fornecedor/iberdrola/2026/08');
    });

    it('foreign without supplier or category lands in /Estrangeiras/Geral/{Ano}/{Mes}', () => {
      expect(
        decideFilingFolder(
          { ...baseCtx, Pais: 'FR', Origem: 'Estrangeira' },
          false,
        ),
      ).toBe('/Estrangeiras/Geral/2026/08');
    });

    it('national without supplier AND without category → null (engine falls through)', () => {
      expect(decideFilingFolder(baseCtx, false)).toBeNull();
    });

    it('recurring flag wins over category when both are set (recurring supplier with a category)', () => {
      expect(
        decideFilingFolder(
          { ...baseCtx, Entidade: 'EDP', Categoria: 'Refeições' },
          true,
        ),
      ).toBe('/Fornecedores/edp/2026/08');
    });

    it('requires both Ano and Mes; returns null otherwise', () => {
      expect(decideFilingFolder({ ...baseCtx, Ano: '' }, false)).toBeNull();
      expect(decideFilingFolder({ ...baseCtx, Mes: '' }, false)).toBeNull();
    });
  });
});
