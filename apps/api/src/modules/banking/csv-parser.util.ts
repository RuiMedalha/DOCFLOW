import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { parse as parseCsvStream } from 'csv-parse/sync';

/**
 * A normalized row produced by the CSV import wizard. The `raw` field keeps
 * the original header→value map so we can persist an audit trail and offer
 * re-mapping later.
 */
export interface ParsedRow {
  date: Date;
  description: string;
  amount: number;
  balance?: number | null;
  reference?: string | null;
  raw: Record<string, string>;
}

export interface ParseOptions {
  mapping: {
    date?: string;
    description?: string;
    amount?: string;
    debit?: string;
    credit?: string;
    balance?: string;
    reference?: string;
  };
  dateFormat?: string; // DD/MM/YYYY | YYYY-MM-DD | DD-MM-YYYY
  decimalSep?: string; // , or .
  thousandSep?: string;
  hasHeader?: boolean;
}

/**
 * PT banks export with either `;` or `,` as the field separator. Pick the
 * dominant one from the first non-empty line so we don't trip over decimal
 * commas in values.
 */
function detectDelimiter(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

/**
 * Parse a date string in one of the supported PT formats. Returns null for
 * unparseable input — callers skip the row and record an error.
 */
export function parseDate(
  value: string,
  format = 'DD/MM/YYYY',
): Date | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, '');
  let day: number;
  let month: number;
  let year: number;

  if (format === 'YYYY-MM-DD' || /^\d{4}[-/.]\d{2}[-/.]\d{2}/.test(cleaned)) {
    const parts = cleaned.split(/[-/.]/);
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (
    format === 'DD-MM-YYYY' ||
    format === 'DD/MM/YYYY' ||
    /^[\d]{1,2}[-/.][\d]{1,2}[-/.][\d]{2,4}/.test(cleaned)
  ) {
    const parts = cleaned.split(/[-/.]/);
    if (parts.length < 3) return null;
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
  } else {
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }

  if (!day || !month || !year) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/**
 * Convert a Portuguese-formatted monetary string into a JS number. We strip
 * thousand separators, swap decimal commas for dots, and discard currency
 * symbols. Null means "unparseable".
 */
export function parseAmount(
  value: string,
  decimalSep = ',',
  thousandSep = '.',
): number | null {
  if (value == null || value === '') return null;
  let s = String(value).trim().replace(/\s/g, '');
  // European format: 1.234,56 → 1234.56
  if (decimalSep === ',') {
    if (thousandSep) {
      s = s.replace(new RegExp(`\\${thousandSep}`, 'g'), '');
    }
    s = s.replace(',', '.');
  } else if (thousandSep) {
    s = s.replace(new RegExp(`\\${thousandSep}`, 'g'), '');
  }
  // Strip currency symbols
  s = s.replace(/[€$£¥]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Parse the full CSV buffer using csv-parse (handles quoted fields and
 * embedded delimiters), then map rows using the user-supplied mapping.
 *
 * Returns three collections:
 *   - `rows`    successfully parsed transactions
 *   - `errors`  per-line diagnostic strings for the wizard
 *   - `headers` column names from the file (auto-generated if no header row)
 */
export function parseCsvContent(
  content: string,
  options: ParseOptions,
): { headers: string[]; rows: ParsedRow[]; errors: string[] } {
  if (!content || !content.trim()) {
    return { headers: [], rows: [], errors: ['Ficheiro vazio'] };
  }

  const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const delimiter = detectDelimiter(firstLine);
  const hasHeader = options.hasHeader !== false;

  let records: string[][];
  try {
    records = parseCsvStream(content, {
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      bom: true,
    }) as string[][];
  } catch (err) {
    return {
      headers: [],
      rows: [],
      errors: [
        `Falha ao parsear CSV: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }

  if (records.length === 0) {
    return { headers: [], rows: [], errors: ['Ficheiro vazio'] };
  }

  const headers = hasHeader
    ? records[0].map((h) => h.replace(/^"|"$/g, '').trim())
    : records[0].map((_, i) => `Col${i + 1}`);
  const dataRows = hasHeader ? records.slice(1) : records;

  const colIndex = (name: string) => {
    if (!name) return -1;
    const target = name.toLowerCase().trim();
    return headers.findIndex(
      (h) => h.toLowerCase().trim() === target,
    );
  };

  // Defensive: a malformed request body (e.g. body shape that does not match
  // the CSV wizard DTO) may arrive with `options.mapping` undefined. We must
  // return clear mapping errors instead of crashing with a TypeError deep
  // inside the row loop — the wizard depends on those errors to highlight
  // which columns the user still has to map.
  const m = options.mapping;
  const errors: string[] = [];
  if (!m) {
    errors.push(
      'mapping em falta — forneça mapping { date, description, amount }',
    );
    return { headers, rows: [], errors };
  }

  const dateIdx = m.date ? colIndex(m.date) : -1;
  const descIdx = m.description ? colIndex(m.description) : -1;
  const amountIdx = m.amount ? colIndex(m.amount) : -1;
  const debitIdx = m.debit ? colIndex(m.debit) : -1;
  const creditIdx = m.credit ? colIndex(m.credit) : -1;
  const balanceIdx = m.balance ? colIndex(m.balance) : -1;
  const refIdx = m.reference ? colIndex(m.reference) : -1;

  if (dateIdx < 0) {
    errors.push(
      m.date
        ? `Coluna de data "${m.date}" não encontrada`
        : 'Coluna de data em falta — forneça mapping.date (ou dateColumn no body)',
    );
  }
  if (descIdx < 0) {
    errors.push(
      m.description
        ? `Coluna de descrição "${m.description}" não encontrada`
        : 'Coluna de descrição em falta — forneça mapping.description (ou descriptionColumn no body)',
    );
  }
  if (amountIdx < 0 && (debitIdx < 0 || creditIdx < 0)) {
    errors.push('É necessário mapear amount OU debit+credit');
  }

  if (errors.length) {
    return { headers, rows: [], errors };
  }

  // dateIdx/descIdx/amountIdx are guaranteed >= 0 by the early-return above.
  // We re-bind to const so the row loop body can use them with no `!` noise.
  const dIdx = dateIdx;
  const descIdxSafe = descIdx;
  const amtIdx = amountIdx;
  const dbIdx = debitIdx;
  const crIdx = creditIdx;

  const rows: ParsedRow[] = [];
  dataRows.forEach((cols, i) => {
    const raw: Record<string, string> = {};
    headers.forEach((h, hi) => {
      raw[h] = cols[hi] ?? '';
    });

    const dateVal = cols[dIdx] ?? '';
    const date = parseDate(dateVal, options.dateFormat || 'DD/MM/YYYY');
    if (!date) {
      errors.push(`Linha ${i + 2}: data inválida "${dateVal}"`);
      return;
    }

    let amount: number | null = null;
    if (amtIdx >= 0) {
      amount = parseAmount(
        cols[amtIdx] ?? '',
        options.decimalSep,
        options.thousandSep,
      );
    } else {
      const debit = parseAmount(
        cols[dbIdx] ?? '0',
        options.decimalSep,
        options.thousandSep,
      ) || 0;
      const credit = parseAmount(
        cols[crIdx] ?? '0',
        options.decimalSep,
        options.thousandSep,
      ) || 0;
      // PT convention: debit = outflow (negative), credit = inflow (positive)
      amount = credit - debit;
    }

    if (amount == null) {
      errors.push(`Linha ${i + 2}: valor inválido`);
      return;
    }

    const balance =
      balanceIdx >= 0
        ? parseAmount(
            cols[balanceIdx] ?? '',
            options.decimalSep,
            options.thousandSep,
          )
        : null;

    const reference =
      refIdx >= 0 && cols[refIdx] && cols[refIdx].trim().length > 0
        ? cols[refIdx].trim()
        : null;

    rows.push({
      date,
      description: cols[descIdxSafe] ?? '',
      amount,
      balance,
      reference,
      raw,
    });
  });

  return { headers, rows, errors };
}

/**
 * SHA-256 of the raw import content — used to short-circuit duplicate
 * imports of the same file. Returns a 64-char hex digest.
 */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Canonical row hash for per-transaction dedup. The hash is stable for the
 * same logical transaction even if the source file is re-imported with
 * different whitespace, so users can re-run imports safely.
 *
 * NOTE: this is the per-row hash, complementing `computeFileHash` which
 * deduplicates at the file level.
 */
export function computeRowHash(input: {
  date: Date;
  description: string;
  amount: number | Prisma.Decimal;
  reference?: string | null;
}): string {
  const dateIso = input.date.toISOString().slice(0, 10); // YYYY-MM-DD only
  const ref = (input.reference ?? '').trim();
  const desc = input.description.trim();
  const amount = input.amount.toFixed(2);
  const canonical = `${dateIso}|${amount}|${desc}|${ref}`;
  return createHash('sha256').update(canonical).digest('hex');
}
