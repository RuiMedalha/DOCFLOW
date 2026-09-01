'use client';

/**
 * DocFlow — Payments (F.7) TanStack Query hooks.
 *
 * Full coverage for:
 *   - Payables CRUD, Approvals, Mark-paid
 *   - Payment Schedules & Calendar view (recurrence expansion)
 *   - ISO 20022 SEPA pain.001 XML & Homebanking CSV exports
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, downloadBlob } from './http';
import type {
  CalendarOccurrence,
  PayableFilters,
  PayableInput,
  PayableItem,
  PayableListResponse,
  PaymentSchedule,
  PaymentScheduleInput,
  PaymentScheduleListResponse,
  SepaExportInput,
} from '../(dashboard)/payments/_lib/types';

export const paymentsKeys = {
  all: ['payments'] as const,
  payables: (filters?: PayableFilters, page = 1, limit = 25) =>
    [...paymentsKeys.all, 'payables', filters, page, limit] as const,
  payable: (id: string) => [...paymentsKeys.all, 'payables', id] as const,
  schedules: (page = 1, limit = 25) =>
    [...paymentsKeys.all, 'schedules', page, limit] as const,
  calendar: (from: string, to: string) =>
    [...paymentsKeys.all, 'calendar', from, to] as const,
};

// ============================================================================
// Payables
// ============================================================================

export function usePayables(
  filters: PayableFilters = {},
  page = 1,
  limit = 25,
) {
  return useQuery({
    queryKey: paymentsKeys.payables(filters, page, limit),
    queryFn: () =>
      http.get<PayableListResponse>('/payments/payables', {
        page,
        limit,
        status: filters.status || undefined,
        partyId: filters.partyId || undefined,
        approvedOnly: filters.approvedOnly ? 'true' : undefined,
        overdueOnly: filters.overdueOnly ? 'true' : undefined,
        dueDateFrom: filters.dueDateFrom || undefined,
        dueDateTo: filters.dueDateTo || undefined,
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function usePayable(id: string | null | undefined) {
  return useQuery({
    queryKey: paymentsKeys.payable(id ?? ''),
    queryFn: () => http.get<PayableItem>(`/payments/payables/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateManualPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PayableInput) =>
      http.post<PayableItem>('/payments/payables', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
    },
  });
}

export function useCreatePayableFromDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; dueDate?: string; notes?: string }) =>
      http.post<PayableItem>('/payments/payables/from-document', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
    },
  });
}

export function useUpdatePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: Partial<PayableInput> & { id: string }) =>
      http.patch<PayableItem>(`/payments/payables/${id}`, dto),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
      void qc.invalidateQueries({ queryKey: paymentsKeys.payable(vars.id) });
    },
  });
}

export function useApprovePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      http.post<PayableItem>(`/payments/payables/${id}/approve`, { notes }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
      void qc.invalidateQueries({ queryKey: paymentsKeys.payable(vars.id) });
    },
  });
}

export function useMarkPaidPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...dto
    }: {
      id: string;
      paidAt?: string;
      paidAmount?: number;
      paymentMethod?: string;
      paymentRef?: string;
      bankTxId?: string;
    }) => http.post<PayableItem>(`/payments/payables/${id}/mark-paid`, dto),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
      void qc.invalidateQueries({ queryKey: paymentsKeys.payable(vars.id) });
    },
  });
}

// ============================================================================
// Payment Schedules & Calendar
// ============================================================================

export function usePaymentSchedules(page = 1, limit = 25) {
  return useQuery({
    queryKey: paymentsKeys.schedules(page, limit),
    queryFn: () =>
      http.get<PaymentScheduleListResponse>('/payments/schedule', {
        page,
        limit,
      }),
    placeholderData: (prev) => prev,
    staleTime: 20_000,
  });
}

export function usePaymentCalendar(from: string, to: string, maxOccurrences = 12) {
  return useQuery({
    queryKey: paymentsKeys.calendar(from, to),
    queryFn: () =>
      http.get<CalendarOccurrence[]>('/payments/schedule/calendar', {
        from,
        to,
        maxOccurrences,
      }),
    enabled: Boolean(from && to),
    staleTime: 30_000,
  });
}

export function useCreatePaymentSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentScheduleInput) =>
      http.post<PaymentSchedule>('/payments/schedule', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
    },
  });
}

export function useUpdatePaymentSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: Partial<PaymentScheduleInput> & { id: string }) =>
      http.patch<PaymentSchedule>(`/payments/schedule/${id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
    },
  });
}

export function useDeletePaymentSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.del<{ deleted: boolean }>(`/payments/schedule/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentsKeys.all });
    },
  });
}

// ============================================================================
// SEPA Exports
// ============================================================================

export function useExportSepaXml() {
  return useMutation({
    mutationFn: async (input: SepaExportInput) => {
      const blob = await http.postForBlob('/payments/sepa/export', input);
      const filename = `sepa-${new Date().toISOString().slice(0, 10)}.xml`;
      downloadBlob(blob, filename);
      return true;
    },
  });
}

export function useExportSepaCsv() {
  return useMutation({
    mutationFn: async (input: SepaExportInput) => {
      const blob = await http.postForBlob('/payments/sepa/export-csv', input);
      const filename = `sepa-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(blob, filename);
      return true;
    },
  });
}

// Aliases for component convenience
export const useMarkPaid = useMarkPaidPayable;
export const useDeleteSchedule = useDeletePaymentSchedule;
export const useSepaExport = useExportSepaXml;
export const useSepaExportCsv = useExportSepaCsv;

