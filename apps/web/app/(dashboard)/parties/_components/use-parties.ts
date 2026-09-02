'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from '../../../_lib/auth-refresh';
import type {
  Account,
  AccountListResponse,
  IbanBlacklistEntry,
  IbanHistoryEntry,
  IbanRiskReport,
  Party,
  PartyFilters,
  PartyInput,
  PartyListResponse,
} from '../_lib/types';

const API_BASE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')) || 'http://localhost:4000/api/v1';

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.message) detail = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    } catch {}
    throw new Error(detail);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const partyKeys = {
  all: ['parties'] as const,
  list: (f: PartyFilters, page: number, limit: number) => ['parties', 'list', f, page, limit] as const,
  one: (id: string) => ['parties', id] as const,
  ibanHistory: (id: string) => ['parties', id, 'iban-history'] as const,
  ibanRisk: (id: string) => ['parties', id, 'iban-risk'] as const,
  blacklist: (page: number, limit: number) => ['parties', 'blacklist', page, limit] as const,
  accounts: (page: number, limit: number, search: string) => ['parties', 'accounts', page, limit, search] as const,
  seedAccounts: () => ['parties', 'accounts', 'seed'] as const,
};

// ─────────────────────────────────────────── PARTIES ───────────────────────

export function useParties(filters: PartyFilters, page = 1, limit = 25) {
  const sp = new URLSearchParams();
  if (filters.search) sp.set('search', filters.search);
  if (filters.type) sp.set('type', filters.type);
  if (filters.isActive) sp.set('isActive', filters.isActive);
  sp.set('page', String(page));
  sp.set('limit', String(limit));

  return useQuery<PartyListResponse>({
    queryKey: partyKeys.list(filters, page, limit),
    queryFn: async () => {
      const res = await authedFetch(`${API_BASE}/parties?${sp}`);
      if (!res.ok) {
        return { items: [] as Party[], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      return unwrap<PartyListResponse>(res);
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useParty(id: string | null) {
  return useQuery<Party | null>({
    queryKey: partyKeys.one(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      const res = await authedFetch(`${API_BASE}/parties/${id}`);
      if (!res.ok) return null;
      return unwrap<Party>(res);
    },
    enabled: !!id,
  });
}

export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PartyInput) => {
      const res = await authedFetch(`${API_BASE}/parties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return unwrap<Party>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: partyKeys.all }),
  });
}

export function useUpdateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<PartyInput> & { id: string }) => {
      const res = await authedFetch(`${API_BASE}/parties/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return unwrap<Party>(res);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: partyKeys.all });
      qc.invalidateQueries({ queryKey: partyKeys.one(vars.id) });
    },
  });
}

export function useDeleteParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authedFetch(`${API_BASE}/parties/${id}`, {
        method: 'DELETE',
      });
      return unwrap<{ deleted: boolean }>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: partyKeys.all }),
  });
}

// ─────────────────────────────────────────── IBAN ANTI-FRAUD ──────────────

export function useIbanHistory(id: string | null) {
  return useQuery<IbanHistoryEntry[]>({
    queryKey: partyKeys.ibanHistory(id ?? ''),
    queryFn: async () => {
      if (!id) return [];
      const res = await authedFetch(`${API_BASE}/parties/${id}/iban-history`);
      if (!res.ok) return [] as IbanHistoryEntry[];
      const body = unwrap<{ items?: IbanHistoryEntry[] } | IbanHistoryEntry[]>(res) as any;
      return Array.isArray(body) ? body : (body.items ?? []);
    },
    enabled: !!id,
  });
}

export function useIbanRisk(id: string | null) {
  return useQuery<IbanRiskReport | null>({
    queryKey: partyKeys.ibanRisk(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      const res = await authedFetch(`${API_BASE}/parties/${id}/iban/risk-score`);
      if (!res.ok) return null;
      return unwrap<IbanRiskReport>(res);
    },
    enabled: !!id,
  });
}

export function useVerifyIban() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await authedFetch(`${API_BASE}/parties/${id}/iban/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      return unwrap<Party>(res);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: partyKeys.one(vars.id) });
      qc.invalidateQueries({ queryKey: partyKeys.ibanHistory(vars.id) });
      qc.invalidateQueries({ queryKey: partyKeys.ibanRisk(vars.id) });
    },
  });
}

export function useFlagIban() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await authedFetch(`${API_BASE}/parties/${id}/iban/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      return unwrap<Party>(res);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: partyKeys.all });
    },
  });
}

// ─────────────────────────────────────────── BLACKLIST ─────────────────────

export function useBlacklist(page = 1, limit = 50) {
  return useQuery<{ items: IbanBlacklistEntry[]; meta: { total: number; page: number; limit: number } }>({
    queryKey: partyKeys.blacklist(page, limit),
    queryFn: async () => {
      const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await authedFetch(`${API_BASE}/parties/blacklist?${sp}`);
      if (!res.ok) return { items: [] as IbanBlacklistEntry[], meta: { total: 0, page, limit } };
      return unwrap<{ items: IbanBlacklistEntry[]; meta: { total: number; page: number; limit: number } }>(res);
    },
  });
}

export function useAddBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { iban: string; reason: string; source?: string }) => {
      const res = await authedFetch(`${API_BASE}/parties/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return unwrap<IbanBlacklistEntry>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: partyKeys.blacklist(1, 50) }),
  });
}

// ─────────────────────────────────────────── ACCOUNTS ──────────────────────

export function useAccounts(page = 1, limit = 100, search = '') {
  const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) sp.set('search', search);
  return useQuery<AccountListResponse>({
    queryKey: partyKeys.accounts(page, limit, search),
    queryFn: async () => {
      const res = await authedFetch(`${API_BASE}/accounts?${sp}`);
      if (!res.ok) return { items: [] as Account[], meta: { total: 0, page, limit, totalPages: 0 } };
      return unwrap<AccountListResponse>(res);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSeedAccounts() {
  return useQuery<{ items: Account[]; meta: { total: number; page: number; limit: number } } | Account[]>({
    queryKey: partyKeys.seedAccounts(),
    queryFn: async () => {
      const res = await authedFetch(`${API_BASE}/accounts/seed`);
      if (!res.ok) return [] as Account[];
      const body = unwrap<{ items?: Account[] } | Account[]>(res) as any;
      return Array.isArray(body) ? body : (body.items ?? []);
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; name: string; type: import('../_lib/types').AccountType; parentCode?: string }) => {
      const res = await authedFetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return unwrap<Account>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: partyKeys.all }),
  });
}
