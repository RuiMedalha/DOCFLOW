'use client';

/**
 * DocFlow — Payments (F.7) query hooks (TanStack Query).
 *
 * Payables CRUD + approve/mark-paid; Payment schedules; SEPA export trigger.
 * Talks to /api/v1/payments/* via the shared `http` client.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, downloadBlob } from '../../../_lib/http';
import type {
  PayableFilters,
  PayableInput,
  PayableItem,
  PayableListResponse,
  PaymentSchedule,
  PaymentScheduleInput,
  PaymentScheduleListResponse,
  RecurrenceType,
  SepaExportInput,
} from './types';

export * from './types';

// Hardcoded fallback is `localhost` so the local dev box still works when the
// env is missing; on phones / remote sessions NEXT_PUBLIC_API_URL must point
// at the LAN IP (see apps/web/.env.local).
const API_BASE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')) || 'http://localhost:4000/api/v1';

export const paymentsKeys = {
  all: ['payments'] as const,
  payables: (filters: PayableFilters, page: number, limit: number) =>
    [...paymentsKeys.all, 'payables', filters, page, limit] as const,
  payable: (id: string) => [...paymentsKeys.all, 'payables', id] as const,
  schedule: (page: number, limit: number) =>
    [...paymentsKeys.all, 'schedule', page, limit] as const,
};

export function usePayables(filters: PayableFilters, page = 1, limit = 25) {
  return useQuery<PayableListResponse>({
    queryKey: paymentsKeys.payables(filters, page, limit),
    queryFn: () =>
      http.get<PayableListResponse>('/payments/payables', {
        page,
        limit,
        status: filters.status,
        search: filters.search,
        partyId: filters.partyId,
        overdueOnly: filters.overdueOnly === true ? 'true' : undefined,
        approvedOnly: filters.approvedOnly === true ? 'true' : undefined,
        dueDateFrom: filters.dueDateFrom,
        dueDateTo: filters.dueDateTo,
      }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useCreateManualPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PayableInput) =>
      http.post<PayableItem>('/payments/payables', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function useUpdatePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<PayableInput> & { id: string }) =>
      http.patch<PayableItem>(`/payments/payables/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function useApprovePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) =>
      http.post<PayableItem>(`/payments/payables/${id}/approve`, { notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function useMarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      paidAmount,
      paymentMethod,
      paymentRef,
    }: {
      id: string;
      paidAmount: number;
      paymentMethod?: string;
      paymentRef?: string;
    }) =>
      http.post<PayableItem>(`/payments/payables/${id}/mark-paid`, {
        paidAmount,
        paymentMethod,
        paymentRef,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function usePaymentSchedules(page = 1, limit = 25) {
  return useQuery<PaymentScheduleListResponse>({
    queryKey: paymentsKeys.schedule(page, limit),
    queryFn: () => http.get<PaymentScheduleListResponse>('/payments/schedule', { page, limit }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useCreatePaymentSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentScheduleInput) =>
      http.post<PaymentSchedule>('/payments/schedule', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function useUpdatePaymentSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<PaymentScheduleInput> & { id: string; recurrenceType?: RecurrenceType }) =>
      http.patch<PaymentSchedule>(`/payments/schedule/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      http.del<{ deleted: boolean }>(`/payments/schedule/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentsKeys.all }),
  });
}

// ─────────────────────────────────────────── SEPA EXPORT ───────────────────

export interface SepaSummary {
  numberOfTransactions: number;
  controlSum: number;
  messageId: string;
}

export function useExportSepaXml() {
  return useMutation<{ summary: SepaSummary }, Error, SepaExportInput>({
    mutationFn: async (input) => {
      const res = await fetch(`${API_BASE}/payments/sepa/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const messageId = res.headers.get('X-DocFlow-Message-Id') ?? `df-${Date.now()}`;
      const controlSum = Number(res.headers.get('X-DocFlow-Control-Sum') ?? '0');
      const numberOfTransactions = Number(res.headers.get('X-DocFlow-Number-Of-Tx') ?? '0');
      const summary: SepaSummary = { messageId, controlSum, numberOfTransactions };
      downloadBlob(blob, `sepa-${messageId}.xml`);
      return { summary };
    },
  });
}

export function useExportSepaCsv() {
  return useMutation<{ summary: SepaSummary }, Error, SepaExportInput>({
    mutationFn: async (input) => {
      const res = await fetch(`${API_BASE}/payments/sepa/export-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const controlSum = Number(res.headers.get('X-DocFlow-Control-Sum') ?? '0');
      const numberOfTransactions = Number(res.headers.get('X-DocFlow-Number-Of-Tx') ?? '0');
      const messageId = `df-csv-${Date.now()}`;
      const summary: SepaSummary = { messageId, controlSum, numberOfTransactions };
      downloadBlob(blob, `sepa-${new Date().toISOString().slice(0, 10)}.csv`);
      return { summary };
    },
  });
}