/**
 * DocFlow — Banking (F.5) & Reconciliation types.
 *
 * Mirrors the NestJS `banking` and `reconciliation` modules contract:
 *   GET    /banking/templates
 *   POST   /banking/templates
 *   GET    /banking/templates/:id
 *   PATCH  /banking/templates/:id
 *   DELETE /banking/templates/:id
 *   POST   /banking/csv/preview
 *   POST   /banking/csv/import
 *   POST   /banking/camt/import
 *   GET    /banking/transactions
 *   GET    /banking/transactions/:id
 *   GET    /banking/transactions/export
 *   POST   /reconciliation/run
 *   GET    /reconciliation/suggestions
 *   POST   /reconciliation/suggestions/:id/accept
 *   POST   /reconciliation/suggestions/:id/reject
 */

export interface CsvColumnMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  reference?: string;
}

export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY';

export interface CsvTemplate {
  id: string;
  name: string;
  mapping: CsvColumnMapping;
  dateFormat: DateFormat;
  decimalSep: string;
  thousandSep: string;
  hasHeader: boolean;
  createdAt: string;
}

export interface CsvTemplateInput {
  name: string;
  mapping: CsvColumnMapping;
  dateFormat?: DateFormat;
  decimalSep?: string;
  thousandSep?: string;
  hasHeader?: boolean;
}

export interface PreviewRow {
  date: string | null;
  description: string;
  amount: number | null;
  balance: number | null;
  reference: string | null;
  /** Parse issues flagged by the backend (per row). */
  warning?: string | null;
}

export interface PreviewResult {
  headers?: string[];
  preview?: PreviewRow[];
  rows?: PreviewRow[];
  detectedColumns?: string[];
  totalRows: number;
  errors?: string[];
  hasMoreErrors?: boolean;
}

export interface ImportResult {
  imported: number;
  skipped?: number;
  skippedDuplicates?: number;
  duplicates?: number;
  templateId?: string | null;
  importBatch?: string;
  totalRows?: number;
  totalEntries?: number;
  errors?: string[];
  hasMoreErrors?: boolean;
}

export interface BankTransaction {
  id: string;
  tenantId?: string;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  counterpartyName: string | null;
  counterpartyIban?: string | null;
  importBatch?: string | null;
  source: string;
  importHash?: string;
  reconciledAt?: string | null;
  reconciled?: boolean;
  createdAt: string;
  expenseId?: string | null;
  invoiceId?: string | null;
  payableItemId?: string | null;
  rawRowJson?: Record<string, unknown> | null;
}

export interface BankTransactionListResponse {
  items: BankTransaction[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface BankTransactionFilters {
  search: string;
  from: string;
  to: string;
  source: '' | 'CSV' | 'CAMT.053';
}

/** The 4 steps of the CSV import wizard. */
export type WizardStep = 'upload' | 'mapping' | 'preview' | 'done';

export const WIZARD_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'upload', label: 'Carregar ficheiro' },
  { id: 'mapping', label: 'Mapear colunas' },
  { id: 'preview', label: 'Pré-visualizar' },
  { id: 'done', label: 'Concluído' },
];

/** Well-known Portuguese bank presets for the mapping step. */
export const BANK_PRESETS: Array<{ name: string; mapping: CsvColumnMapping; dateFormat: DateFormat }> = [
  {
    name: 'Millennium BCP',
    dateFormat: 'DD/MM/YYYY',
    mapping: { date: 'Data', description: 'Descrição', amount: 'Valor', balance: 'Saldo' },
  },
  {
    name: 'Caixa Geral de Depósitos',
    dateFormat: 'DD-MM-YYYY',
    mapping: { date: 'Data mov.', description: 'Descrição', debit: 'Débito', credit: 'Crédito', balance: 'Saldo' },
  },
  {
    name: 'Novo Banco',
    dateFormat: 'DD/MM/YYYY',
    mapping: { date: 'Data valor', description: 'Descritivo', amount: 'Montante', balance: 'Saldo contabilístico' },
  },
  {
    name: 'BPI',
    dateFormat: 'DD-MM-YYYY',
    mapping: { date: 'Data', description: 'Descrição', debit: 'Débito', credit: 'Crédito' },
  },
  {
    name: 'Santander Totta',
    dateFormat: 'DD/MM/YYYY',
    mapping: { date: 'Data Mov.', description: 'Movimento', amount: 'Importe', balance: 'Saldo' },
  },
  {
    name: 'Banco CTT',
    dateFormat: 'DD/MM/YYYY',
    mapping: { date: 'Data Mov.', description: 'Descrição', amount: 'Montante', balance: 'Saldo' },
  },
];

// ============================================================================
// Reconciliation Types
// ============================================================================

export type MatchStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type MatchType = 'STRONG' | 'MEDIUM' | 'WEAK';

export interface MatchSuggestion {
  id: string;
  status: MatchStatus;
  matchType: MatchType;
  score: number;
  reason?: string | null;
  createdAt: string;
  expenseId?: string | null;
  invoiceId?: string | null;
  documentId?: string | null;
  bankTransaction: {
    id: string;
    date: string;
    description: string;
    amount: number;
    reference: string | null;
    counterpartyName: string | null;
  };
  expense?: {
    id: string;
    description: string | null;
    amount: number;
    supplier: string | null;
  } | null;
  invoice?: {
    id: string;
    number: string | null;
    amount: number;
    customer: string | null;
  } | null;
  document?: {
    id: string;
    fileName: string;
    docNumber: string | null;
    total: number | null;
    supplier: string | null;
  } | null;
}

export interface PaginatedSuggestions {
  items: MatchSuggestion[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface ReconciliationFilters {
  status?: MatchStatus;
  matchType?: MatchType | '';
  search?: string;
  statementId?: string;
}

export interface RunMatchingResult {
  scannedTransactions: number;
  suggestionsCreated: number;
  byType: {
    STRONG: number;
    MEDIUM: number;
    WEAK: number;
  };
  durationMs: number;
}
