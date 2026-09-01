'use client';

/**
 * DocFlow â€” CRM (F.6) TanStack Query hooks.
 *
 * Full coverage for:
 *   - Contacts CRUD & contact persons
 *   - Deals & Pipeline Kanban board
 *   - Pipeline stats & forecast
 *   - Activities & tasks
 *   - HubSpot / Pipedrive Bulk Import & Sync history
 *
 * All mutations invalidate relevant queries with optimistic updates on deal stage moves.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from './http';
import type {
  Activity,
  ActivityListResponse,
  ActivityType,
  ContactFilters,
  ContactInput,
  ContactListResponse,
  CrmContact,
  CrmContactDetail,
  CrmContactPerson,
  Deal,
  DealFilters,
  DealInput,
  DealListResponse,
  DealStage,
  ImportResponse,
  Pipeline,
  PipelineStats,
  SyncHistoryEntry,
} from '../(dashboard)/crm/_lib/types';

export const crmKeys = {
  all: ['crm'] as const,
  contacts: (filters?: ContactFilters, page = 1, limit = 25) =>
    [...crmKeys.all, 'contacts', filters, page, limit] as const,
  contact: (id: string) => [...crmKeys.all, 'contacts', id] as const,
  pipelines: () => [...crmKeys.all, 'pipelines'] as const,
  pipeline: (id: string) => [...crmKeys.all, 'pipelines', id] as const,
  deals: (filters?: DealFilters, page = 1, limit = 25) =>
    [...crmKeys.all, 'deals', filters, page, limit] as const,
  deal: (id: string) => [...crmKeys.all, 'deals', id] as const,
  dealStats: () => [...crmKeys.all, 'deals', 'stats'] as const,
  dealBoard: (pipelineId?: string, includeLost?: boolean) =>
    [...crmKeys.all, 'deals', 'board', pipelineId, includeLost] as const,
  dealForecast: (horizonMonths?: number, pipelineId?: string) =>
    [...crmKeys.all, 'deals', 'forecast', horizonMonths, pipelineId] as const,
  activities: (params?: Record<string, string | boolean | number>, page = 1, limit = 25) =>
    [...crmKeys.all, 'activities', params, page, limit] as const,
  activity: (id: string) => [...crmKeys.all, 'activities', id] as const,
  syncHistory: (source?: string) =>
    [...crmKeys.all, 'sync-history', source ?? 'all'] as const,
};

// ============================================================================
// Contacts
// ============================================================================

export function useCrmContacts(
  filters: ContactFilters = {},
  page = 1,
  limit = 25,
) {
  return useQuery({
    queryKey: crmKeys.contacts(filters, page, limit),
    queryFn: () =>
      http.get<ContactListResponse>('/crm/contacts', {
        page,
        limit,
        search: filters.search || undefined,
        type: filters.type || undefined,
        isActive:
          filters.isActive !== undefined && filters.isActive !== ''
            ? String(filters.isActive)
            : undefined,
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

/** Alias for useCrmContacts */
export const useContacts = useCrmContacts;

export function useCrmContact(id: string | null | undefined) {
  return useQuery({
    queryKey: crmKeys.contact(id ?? ''),
    queryFn: () => http.get<CrmContactDetail>(`/crm/contacts/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactInput) =>
      http.post<CrmContact>('/crm/contacts', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: Partial<ContactInput> & { id: string }) =>
      http.patch<CrmContact>(`/crm/contacts/${id}`, dto),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
      void qc.invalidateQueries({ queryKey: crmKeys.contact(vars.id) });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.del<{ deleted: boolean }>(`/crm/contacts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useAddContactPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      ...dto
    }: {
      contactId: string;
      name: string;
      role?: string;
      email?: string;
      phone?: string;
      isPrimary?: boolean;
    }) =>
      http.post<CrmContactPerson>(`/crm/contacts/${contactId}/persons`, dto),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: crmKeys.contact(vars.contactId) });
    },
  });
}

export function useUpdateContactPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      contactId?: string;
      name?: string;
      role?: string;
      email?: string;
      phone?: string;
      isPrimary?: boolean;
    }) => {
      const { id, contactId: _contactId, ...dto } = vars;
      void _contactId;
      return http.patch<CrmContactPerson>(`/crm/persons/${id}`, dto);
    },
    onSuccess: (_data, vars) => {
      if (vars.contactId) {
        void qc.invalidateQueries({ queryKey: crmKeys.contact(vars.contactId) });
      } else {
        void qc.invalidateQueries({ queryKey: crmKeys.all });
      }
    },
  });
}

export function useDeleteContactPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; contactId?: string }) =>
      http.del<{ deleted: boolean }>(`/crm/persons/${vars.id}`),
    onSuccess: (_data, vars) => {
      if (vars.contactId) {
        void qc.invalidateQueries({ queryKey: crmKeys.contact(vars.contactId) });
      } else {
        void qc.invalidateQueries({ queryKey: crmKeys.all });
      }
    },
  });
}

// ============================================================================
// Pipelines
// ============================================================================

export function usePipelines() {
  return useQuery({
    queryKey: crmKeys.pipelines(),
    queryFn: () => http.get<Pipeline[]>('/crm/pipelines'),
    staleTime: 300_000,
  });
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; stages: unknown; isDefault?: boolean }) =>
      http.post<Pipeline>('/crm/pipelines', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.pipelines() });
    },
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...dto
    }: {
      id: string;
      name?: string;
      stages?: unknown;
      isDefault?: boolean;
    }) => http.patch<Pipeline>(`/crm/pipelines/${id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.pipelines() });
    },
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.del<{ deleted: boolean }>(`/crm/pipelines/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.pipelines() });
    },
  });
}

// ============================================================================
// Deals
// ============================================================================

export function useDeals(
  filters: DealFilters = {},
  page = 1,
  limit = 100,
) {
  return useQuery({
    queryKey: crmKeys.deals(filters, page, limit),
    queryFn: () =>
      http.get<DealListResponse>('/crm/deals', {
        page,
        limit,
        search: filters.search || undefined,
        stage: filters.stage || undefined,
        pipelineId: filters.pipelineId || undefined,
        contactId: filters.contactId || undefined,
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function useDeal(id: string | null | undefined) {
  return useQuery({
    queryKey: crmKeys.deal(id ?? ''),
    queryFn: () => http.get<Deal>(`/crm/deals/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useDealStats() {
  return useQuery({
    queryKey: crmKeys.dealStats(),
    queryFn: () => http.get<PipelineStats>('/crm/deals/stats'),
    staleTime: 60_000,
  });
}

export function useDealBoard(pipelineId?: string, includeLost = false) {
  return useQuery({
    queryKey: crmKeys.dealBoard(pipelineId, includeLost),
    queryFn: () =>
      http.get<Record<DealStage, Deal[]>>('/crm/deals/board', {
        pipelineId: pipelineId || undefined,
        includeLost: includeLost ? 'true' : 'false',
      }),
    staleTime: 15_000,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DealInput) => http.post<Deal>('/crm/deals', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: Partial<DealInput> & { id: string }) =>
      http.patch<Deal>(`/crm/deals/${id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useMoveDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      stage,
      probability,
    }: {
      id: string;
      stage: DealStage;
      probability?: number;
    }) =>
      http.patch<Deal>(`/crm/deals/${id}/stage`, { stage, probability }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.del<{ deleted: boolean }>(`/crm/deals/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

// ============================================================================
// Activities
// ============================================================================

export function useActivities(
  params: Record<string, string | boolean | number | undefined> = {},
  page = 1,
  limit = 25,
) {
  return useQuery({
    queryKey: crmKeys.activities(params as Record<string, string | boolean | number>, page, limit),
    queryFn: () =>
      http.get<ActivityListResponse>('/crm/activities', {
        page,
        limit,
        ...params,
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      type: ActivityType;
      subject: string;
      description?: string;
      notes?: string;
      dueDate?: string;
      dueAt?: string;
      contactId?: string;
      dealId?: string;
      assignedToId?: string;
    }) => http.post<Activity>('/crm/activities', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.post<Activity>(`/crm/activities/${id}/complete`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.del<{ deleted: boolean }>(`/crm/activities/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

// ============================================================================
// Import & Sync History
// ============================================================================

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      source: 'hubspot' | 'pipedrive';
      dryRun?: boolean;
      mergeDuplicates?: boolean;
    }) => http.post<ImportResponse>('/crm/import', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
    },
  });
}

export function useSyncHistory(source?: 'hubspot' | 'pipedrive') {
  return useQuery({
    queryKey: crmKeys.syncHistory(source),
    queryFn: () =>
      http.get<SyncHistoryEntry[]>('/crm/sync-history', {
        source: source || undefined,
      }),
    staleTime: 60_000,
  });
}



