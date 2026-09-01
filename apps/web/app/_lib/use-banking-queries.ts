'use client';

/**
 * DocFlow â€” Banking (F.5) & Reconciliation TanStack Query hooks.
 *
 * Provides full coverage for:
 *   - Bank transactions & statements listing + detail
 *   - CSV & CAMT.053 import wizard (preview + commit)
 *   - CSV column mapping templates CRUD
 *   - Transaction export (PT formatted CSV)
 *   - Reconciliation suggestions (pending, accepted, rejected)
 *   - Matching engine execution & match approval/rejection
 *
 * All requests route through the authenticated `http` client which automatically
 * sends the Authorization Bearer token from auth-store and unwraps the { data: ... } envelope.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, downloadBlob } from './http';
import type {
  BankTransaction,
  BankTransactionFilters,
  BankTransactionListResponse,
  CsvTemplate,
  CsvTemplateInput,
  ImportResult,
  PaginatedSuggestions,
  PreviewResult,
  ReconciliationFilters,
  RunMatchingResult,
} from '../(dashboard)/banking/_lib/types';

export const bankingKeys = {
  all: ['banking'] as const,
  templates: () => [...bankingKeys.all, 'templates'] as const,
  template: (id: string) => [...bankingKeys.all, 'templates', id] as const,
  transactions: (filters: Partial<BankTransactionFilters>, page: number, limit: number) =>
    [...bankingKeys.all, 'transactions', filters, page, limit] as const,
  transaction: (id: string) => [...bankingKeys.all, 'transaction', id] as const,
  reconciliation: {
    all: ['reconciliation'] as const,
    suggestions: (filters: ReconciliationFilters, page: number, limit: number) =>
      ['reconciliation', 'suggestions', filters, page, limit] as const,
  },
};

// ============================================================================
// CSV Templates
// ============================================================================

export function useCsvTemplates() {
  return useQuery({
    queryKey: bankingKeys.templates(),
    queryFn: () => http.get<CsvTemplate[]>('/banking/templates'),
    staleTime: 60_000,
  });
}

export function useCsvTemplate(id: string | null | undefined) {
  return useQuery({
    queryKey: bankingKeys.template(id ?? ''),
    queryFn: () => http.get<CsvTemplate>(`/banking/templates/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CsvTemplateInput) =>
      http.post<CsvTemplate>('/banking/templates', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.templates() });
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: Partial<CsvTemplateInput> & { id: string }) =>
      http.patch<CsvTemplate>(`/banking/templates/${id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.templates() });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.del<{ deleted: true }>(`/banking/templates/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: bankingKeys.templates() });
      const prev = qc.getQueryData<CsvTemplate[]>(bankingKeys.templates());
      qc.setQueryData<CsvTemplate[]>(bankingKeys.templates(), (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(bankingKeys.templates(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.templates() });
    },
  });
}

// ============================================================================
// Imports & Previews
// ============================================================================

export function usePreviewCsv() {
  return useMutation({
    mutationFn: (input: {
      content: string;
      mapping: CsvTemplate['mapping'];
      dateFormat?: string;
      decimalSep?: string;
      thousandSep?: string;
      hasHeader?: boolean;
    }) => http.post<PreviewResult>('/banking/csv/preview', input),
  });
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content: string;
      mapping: CsvTemplate['mapping'];
      dateFormat?: string;
      decimalSep?: string;
      thousandSep?: string;
      hasHeader?: boolean;
      saveAsTemplate?: string;
    }) => http.post<ImportResult>('/banking/csv/import', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.all });
    },
  });
}

export function useImportCamt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { xml: string; batchLabel?: string }) =>
      http.post<ImportResult>('/banking/camt/import', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.all });
    },
  });
}

/** Convenient wrapper for statement uploading (supports CSV string or CAMT.053 XML) */
export function useUploadStatement() {
  const importCsv = useImportCsv();
  const importCamt = useImportCamt();

  return useMutation({
    mutationFn: async (input: {
      type: 'CSV' | 'CAMT';
      content: string;
      mapping?: CsvTemplate['mapping'];
      dateFormat?: string;
      decimalSep?: string;
      thousandSep?: string;
      saveAsTemplate?: string;
      batchLabel?: string;
    }) => {
      if (input.type === 'CAMT') {
        return importCamt.mutateAsync({
          xml: input.content,
          batchLabel: input.batchLabel,
        });
      }
      return importCsv.mutateAsync({
        content: input.content,
        mapping: input.mapping ?? { date: '', description: '' },
        dateFormat: input.dateFormat,
        decimalSep: input.decimalSep,
        thousandSep: input.thousandSep,
        hasHeader: true,
        saveAsTemplate: input.saveAsTemplate,
      });
    },
  });
}

// ============================================================================
// Bank Transactions & Statements
// ============================================================================

export function useBankTransactions(
  filters: Partial<BankTransactionFilters> = {},
  page = 1,
  limit = 25,
) {
  return useQuery({
    queryKey: bankingKeys.transactions(filters, page, limit),
    queryFn: () =>
      http.get<BankTransactionListResponse>('/banking/transactions', {
        page,
        limit,
        search: filters.search || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        source: filters.source || undefined,
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

/** Alias for useBankTransactions conforming to task contract */
export const useBankStatements = useBankTransactions;

export function useBankTransaction(id: string | null | undefined) {
  return useQuery({
    queryKey: bankingKeys.transaction(id ?? ''),
    queryFn: () => http.get<BankTransaction>(`/banking/transactions/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Alias for useBankTransaction conforming to task contract */
export const useStatementDetail = useBankTransaction;

export function useExportTransactions() {
  return useMutation({
    mutationFn: async (filters: Partial<BankTransactionFilters> = {}) => {
      const blob = await http.getBlob('/banking/transactions/export', {
        search: filters.search || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        source: filters.source || undefined,
      });
      const filename = `movimentos-bancarios-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(blob, filename);
      return true;
    },
  });
}

// ============================================================================
// Reconciliation
// ============================================================================

export function useReconciliationSuggestions(
  filters: ReconciliationFilters = { status: 'PENDING' },
  page = 1,
  limit = 25,
) {
  return useQuery({
    queryKey: bankingKeys.reconciliation.suggestions(filters, page, limit),
    queryFn: () =>
      http.get<PaginatedSuggestions>('/reconciliation/suggestions', {
        status: filters.status || 'PENDING',
        matchType: filters.matchType || undefined,
        page,
        limit,
      }),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<RunMatchingResult>('/reconciliation/run', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.reconciliation.all });
      void qc.invalidateQueries({ queryKey: bankingKeys.all });
    },
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.post<{ accepted: true; bankTransactionId: string }>(
        `/reconciliation/suggestions/${id}/accept`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.reconciliation.all });
      void qc.invalidateQueries({ queryKey: bankingKeys.all });
    },
  });
}

export function useRejectSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.post<{ rejected: true }>(`/reconciliation/suggestions/${id}/reject`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankingKeys.reconciliation.all });
      void qc.invalidateQueries({ queryKey: bankingKeys.all });
    },
  });
}

