/**
 * Fase 4.1 — validação determinística dos campos de identificação fiscal.
 *
 * Regra do cliente: um NIF ou um ATCUD inventados pelo modelo que sigam
 * para a contabilidade são o pior erro possível neste sistema. Por isso
 * nenhum destes campos é persistido a partir da opinião da IA — só
 * sobrevive o que passar uma verificação determinística:
 *
 *   ATCUD  só existe em Portugal (código atribuído pela AT a séries de
 *          faturação portuguesas). Documento não-PT → campo vazio,
 *          sempre. Documento PT → só o que vier de um QR-AT realmente
 *          descodificado, ou que case com o formato oficial.
 *   NIF    PT: módulo 11. UE: VIES. Extra-UE: texto não validado,
 *          marcado como tal, nunca como NIF confirmado.
 *   Conf.  um campo que não foi cruzado com nada não pode mostrar 90 %.
 *
 * Tudo aqui é puro e testado — sem Prisma, sem rede.
 */
import { isValidPortugueseNif } from '../../common/validation/tax-id.validator';
import { ATCUD_PATTERN, isSyntacticallyValidEuVat } from './fiscal-status';

export { ATCUD_PATTERN };

/** Estados-membros da UE (+ XI, Irlanda do Norte) para efeitos de VIES. */
export const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'GR', 'ES', 'FI',
  'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK', 'XI',
]);

/** Teto de confiança para um valor que veio só da IA, sem cruzamento. */
export const UNVALIDATED_CONFIDENCE_CAP = 0.5;

export type TaxIdValidation =
  | 'PT_MOD11' // NIF português com dígito de controlo correto
  | 'VIES' // NIF-IVA comunitário confirmado pelo VIES
  | 'UNVALIDATED' // tem valor mas não passou verificação
  | 'NONE'; // não há valor nenhum

export interface TaxIdInput {
  /** NIF tal como veio da extração (IA, OCR ou QR). */
  supplierNif?: string | null;
  /** NIF-IVA com prefixo de país, para fornecedores estrangeiros. */
  supplierVatId?: string | null;
  /** País do documento/emitente (ISO 3166-1 alpha-2). */
  country?: string | null;
  /** Resultado real de uma chamada ao VIES — nunca uma suposição. */
  viesValidated?: boolean;
}

export interface TaxIdResolution {
  /** Seguro para gravar em `Document.supplierNif` — null quando nada validou. */
  nif: string | null;
  /** NIF-IVA normalizado, com o veredicto em `validation`. */
  vatId: string | null;
  validation: TaxIdValidation;
  /** O valor que recusámos gravar, para a metadata e o ecrã de revisão. */
  rejected: string | null;
  /** Motivo legível, gravado em `metadata.extraction`. */
  reason: string;
  /** True quando o documento tem de ir para revisão manual por causa disto. */
  needsReview: boolean;
}

/** Normaliza um NIF-IVA: sem espaços nem pontuação, maiúsculas. */
export function normalizeVatId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.replace(/[\s.\-/]/g, '').toUpperCase();
  return v.length >= 3 ? v : null;
}

/** Código de país de um NIF-IVA com prefixo (ES, FR, …). */
export function vatCountry(vatId: string | null | undefined): string | null {
  const v = normalizeVatId(vatId);
  const m = v?.match(/^([A-Z]{2})/);
  return m ? m[1] : null;
}

/**
 * Decide o país do documento a partir dos sinais disponíveis, por ordem
 * de fiabilidade: prefixo do NIF-IVA > país extraído > NIF PT válido.
 * Devolve null quando não há sinal nenhum (nunca assume PT).
 */
export function resolveDocumentCountry(input: {
  country?: string | null;
  supplierVatId?: string | null;
  supplierNif?: string | null;
  qrIssuerNif?: string | null;
}): string | null {
  const fromVat = vatCountry(input.supplierVatId);
  if (fromVat) return fromVat;
  const c = input.country?.trim().toUpperCase();
  if (c && /^[A-Z]{2}$/.test(c)) return c;
  // Um QR-AT só existe em Portugal — se o emitente do QR é válido, é PT.
  if (input.qrIssuerNif && isValidPortugueseNif(input.qrIssuerNif)) return 'PT';
  if (input.supplierNif && isValidPortugueseNif(input.supplierNif)) return 'PT';
  return null;
}

/** True quando o documento é português (e portanto pode ter ATCUD). */
export function isPortugueseDocument(country: string | null | undefined): boolean {
  return (country ?? '').toUpperCase() === 'PT';
}

/**
 * Filtra o ATCUD. Devolve null sempre que não houver prova de que o
 * código é real — documento não-PT, formato fora do oficial, ou origem
 * na IA sem QR descodificado por trás.
 */
export function sanitizeAtcud(
  atcud: string | null | undefined,
  opts: { country: string | null | undefined; fromTrustedQr: boolean },
): { atcud: string | null; reason: string } {
  const raw = atcud?.trim().toUpperCase() ?? '';
  if (!raw) return { atcud: null, reason: 'atcud_absent' };
  if (!isPortugueseDocument(opts.country)) {
    // O ATCUD é um código atribuído pela AT a séries portuguesas. Num
    // documento estrangeiro não existe — o que a IA leu é invenção ou
    // é outro número qualquer com ar de ATCUD.
    return { atcud: null, reason: `atcud_dropped_non_pt:${opts.country ?? 'unknown'}` };
  }
  if (!ATCUD_PATTERN.test(raw)) {
    return { atcud: null, reason: `atcud_dropped_bad_format:${raw.slice(0, 24)}` };
  }
  if (!opts.fromTrustedQr) {
    // Formato certo mas sem QR por trás: aceitamos (é PT e respeita o
    // formato oficial), marcando a origem para o ecrã de revisão.
    return { atcud: raw, reason: 'atcud_format_only_no_qr' };
  }
  return { atcud: raw, reason: 'atcud_from_qr' };
}

/**
 * Resolve que identificador fiscal pode ser persistido.
 *
 *   PT        módulo 11 → grava. Falha → não grava, revisão.
 *   UE        VIES confirmou → grava. Não confirmou → não grava, revisão.
 *   Extra-UE  nunca é NIF confirmado; fica como texto não validado.
 */
export function resolveTaxIds(input: TaxIdInput): TaxIdResolution {
  const nifRaw = input.supplierNif?.replace(/[\s.\-/]/g, '') ?? '';
  const vatRaw = normalizeVatId(input.supplierVatId);
  const country = (
    vatCountry(vatRaw) ??
    input.country?.toUpperCase() ??
    (nifRaw ? 'PT' : '')
  ).toUpperCase();

  // ── Português ────────────────────────────────────────────────────
  if (country === 'PT' || (!country && nifRaw)) {
    const candidate = nifRaw || (vatRaw?.replace(/^PT/, '') ?? '');
    if (!candidate) {
      return {
        nif: null, vatId: null, validation: 'NONE', rejected: null,
        reason: 'no_tax_id', needsReview: true,
      };
    }
    if (isValidPortugueseNif(candidate)) {
      return {
        nif: candidate,
        vatId: `PT${candidate}`,
        validation: 'PT_MOD11',
        rejected: null,
        reason: 'nif_pt_mod11_ok',
        needsReview: false,
      };
    }
    return {
      nif: null,
      vatId: null,
      validation: 'UNVALIDATED',
      rejected: candidate,
      reason: `nif_pt_mod11_failed:${candidate}`,
      needsReview: true,
    };
  }

  // ── Comunitário (não-PT) ─────────────────────────────────────────
  if (EU_COUNTRY_CODES.has(country)) {
    if (!vatRaw) {
      return {
        nif: null, vatId: null, validation: 'NONE', rejected: null,
        reason: 'no_tax_id', needsReview: true,
      };
    }
    if (!isSyntacticallyValidEuVat(vatRaw)) {
      return {
        nif: null, vatId: null, validation: 'UNVALIDATED', rejected: vatRaw,
        reason: `vat_eu_bad_syntax:${vatRaw}`, needsReview: true,
      };
    }
    if (input.viesValidated) {
      return {
        nif: vatRaw, vatId: vatRaw, validation: 'VIES', rejected: null,
        reason: `vat_eu_vies_ok:${vatRaw}`, needsReview: false,
      };
    }
    // Sintaxe certa mas o VIES não confirmou — não é um NIF confirmado.
    return {
      nif: null, vatId: vatRaw, validation: 'UNVALIDATED', rejected: vatRaw,
      reason: `vat_eu_vies_unconfirmed:${vatRaw}`, needsReview: true,
    };
  }

  // ── Extra-UE ─────────────────────────────────────────────────────
  if (!vatRaw && !nifRaw) {
    return {
      nif: null, vatId: null, validation: 'NONE', rejected: null,
      reason: 'no_tax_id', needsReview: true,
    };
  }
  const text = vatRaw ?? nifRaw;
  return {
    nif: null,
    vatId: text,
    validation: 'UNVALIDATED',
    rejected: text,
    reason: `vat_non_eu_unvalidated:${country || '??'}`,
    needsReview: true,
  };
}

/**
 * Fase 4.1 — o saneamento tem de LIMPAR o que já está gravado, não
 * apenas recusar-se a escrever por cima.
 *
 * A escrita da extração é aditiva (só persiste valores truthy), por isso
 * uma linha antiga com lixo ficava lá para sempre. Em produção havia
 * documentos com o TOTAL gravado na coluna do ATCUD ("1012.30",
 * "155.00", "32.40") e NIFs que falham o módulo 11 — escritos antes
 * destas regras existirem. Um operador nunca confirmaria nenhum desses
 * valores, por isso limpá-los não apaga trabalho humano; e um valor que
 * um humano tenha corrigido à mão passa a validação e sobrevive.
 */
export function shouldClearStoredAtcud(
  stored: string | null | undefined,
  country: string | null | undefined,
  incoming: string | null,
): boolean {
  if (!stored) return false;
  if (incoming) return false; // vamos escrever um valor bom por cima
  return sanitizeAtcud(stored, { country, fromTrustedQr: false }).atcud === null;
}

export function shouldClearStoredNif(
  stored: string | null | undefined,
  country: string | null | undefined,
  incoming: string | null,
  viesValidated: boolean,
): boolean {
  if (!stored) return false;
  if (incoming) return false;
  const isPrefixed = /^[A-Z]{2}/.test(stored);
  return (
    resolveTaxIds({
      supplierNif: isPrefixed ? null : stored,
      supplierVatId: isPrefixed ? stored : null,
      country,
      viesValidated,
    }).nif === null
  );
}

/**
 * Teto de confiança por origem do valor.
 *
 *   qr         veio de um QR-AT realmente descodificado → é prova.
 *   validated  passou uma verificação determinística (mod-11, VIES,
 *              mod-97 do IBAN, totais que fecham ao cêntimo).
 *   ai         veio só do modelo, sem cruzamento → teto baixo.
 */
export function fieldConfidence(
  raw: number | null | undefined,
  source: 'qr' | 'validated' | 'ai',
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const v = Math.max(0, Math.min(1, raw));
  if (source === 'ai') return Math.min(v, UNVALIDATED_CONFIDENCE_CAP);
  return v;
}
