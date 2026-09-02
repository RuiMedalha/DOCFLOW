/**
 * DocFlow — Document Inbox types.
 *
 * Mirrors the contract exposed by the backend `documents` module
 * (responses wrapped as `{ data: ... }` by TransformInterceptor).
 */

export type DocumentStatus =
  | 'novo'
  | 'processado'
  | 'em_revisao'
  | 'arquivado'
  | 'conciliado'
  | 'erro';

export type DocumentType =
  | 'fatura'
  | 'recibo'
  | 'nota_credito'
  | 'nota_debito'
  | 'guia_transporte'
  | 'outro';

export interface DocumentFolder {
  id: string;
  name: string;
  color?: string | null;
}

export interface DocumentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  type: DocumentType;
  origin?: string | null;
  supplier?: string | null;
  nif?: string | null;
  documentDate?: string | null;
  total?: number | null;
  iva?: number | null;
  folder?: DocumentFolder | null;
  tags?: string[];
  rank?: number | null;
  createdAt: string;
}

export interface DocumentListResponse {
  items: DocumentRecord[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface DocumentFiltersState {
  search: string;
  status: '' | DocumentStatus;
  type: '' | DocumentType;
  dateFrom: string;
  dateTo: string;
}

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  novo: 'Novo',
  processado: 'Processado',
  em_revisao: 'Em revisão',
  arquivado: 'Arquivado',
  conciliado: 'Conciliado',
  erro: 'Erro',
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  fatura: 'Fatura',
  recibo: 'Recibo',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  guia_transporte: 'Guia de transporte',
  outro: 'Outro',
};
