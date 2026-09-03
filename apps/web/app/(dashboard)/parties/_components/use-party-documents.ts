'use client';

/**
 * usePartyDocuments — TanStack Query hook for the "Faturas recentes"
 * section on `/parties/:id`.
 *
 * Endpoint:
 *   GET /api/v1/parties/:id/documents?limit&from&to  → { items, meta }
 *
 * Shape mirrors `useDocuments` (the inbox) so the UI can reuse the
 * same row primitive. Falls back to an empty list on error so the
 * party page still renders without a banner when the endpoint is
 * missing or the tenant has no docs linked.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { authedFetch } from '../../../_lib/auth-refresh';
import type { PartyDocument } from '../_lib/types';

const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')) ||
  'http://localhost:4000/api/v1';

export interface PartyDocumentsResponse {
  items: PartyDocument[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.message) detail = Array.isArray(data.message) ? data.message.join(': ') : data.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export function usePartyDocuments(
  partyId: string | null,
  limit = 10,
): UseQueryResult<PartyDocumentsResponse> {
  return useQuery({
    enabled: Boolean(partyId),
    queryKey: ['party-documents', partyId, limit] as const,
    queryFn: async (): Promise<PartyDocumentsResponse> => {
      if (!partyId) {
        return { items: [], meta: { total: 0, page: 1, limit, totalPages: 0 } };
      }
      const sp = new URLSearchParams({ limit: String(limit) });
      const res = await authedFetch(`${API_BASE}/parties/${partyId}/documents?${sp}`);
      if (!res.ok) {
        // Soft-fail to an empty list so the section still renders. The
        // backend may legitimately return 404 if the party was just
        // deleted between the detail query and this one.
        return { items: [], meta: { total: 0, page: 1, limit, totalPages: 0 } };
      }
      return unwrap<PartyDocumentsResponse>(res);
    },
    staleTime: 30_000,
  });
}