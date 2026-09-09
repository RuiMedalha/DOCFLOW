'use client';

import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * Sprint I — Party enrichment badge.
 *
 * Renders the "last enriched" status from `/parties/:id/enrichment`
 * and exposes a "Re-extrair dados" button that hits
 * `POST /parties/:id/enrich` to fire a fresh lookup. The badge has
 * four visual states:
 *
 *   - never        — no enrichedAt, no error
 *   - cached       — enrichedAt < 30d, source ok
 *   - stale        — enrichedAt > 30d OR error, source ok
 *   - manual       — enrichmentError set (no public registry match)
 *
 * The button is admin-only and disabled while a request is in flight.
 */

type EnrichmentMetadata = {
  lastEnrichedAt: string | null;
  source: string | null;
  error: string | null;
  provider: 'sabi-pt' | 'vies' | 'manual' | 'none';
};

type EnrichmentResponse = {
  source: 'sabi-pt' | 'vies' | 'manual' | 'cached' | 'no_data';
  fieldsPopulated: string[];
  error: string | null;
  fetchedAt: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  'sabi-pt': 'Sabi PT',
  vies: 'VIES (UE)',
  manual: 'Manual',
  cached: 'cache',
  no_data: 'sem dados externos',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours === 0) {
      const mins = Math.floor(ms / (60 * 1000));
      return mins < 1 ? 'agora' : `há ${mins} min`;
    }
    return `há ${hours} h`;
  }
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

export function PartyEnrichmentBadge({
  partyId,
  isAdmin,
}: {
  partyId: string;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const metadata = useQuery<EnrichmentMetadata>({
    queryKey: ['party', partyId, 'enrichment-metadata'],
    queryFn: async () => {
      const res = await fetch(`/api/v1/parties/${partyId}/enrichment`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const enrich = useMutation<EnrichmentResponse, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/parties/${partyId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['party', partyId] });
      queryClient.invalidateQueries({
        queryKey: ['party', partyId, 'enrichment-metadata'],
      });
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const m = metadata.data;
  const isLoading = metadata.isLoading;
  const isMutating = enrich.isPending;

  // Determine visual state.
  let state: 'never' | 'cached' | 'stale' | 'manual' = 'never';
  if (m?.error) {
    state = 'manual';
  } else if (m?.lastEnrichedAt) {
    const ageMs = Date.now() - new Date(m.lastEnrichedAt).getTime();
    if (ageMs < 30 * 24 * 60 * 60 * 1000) state = 'cached';
    else state = 'stale';
  } else if (m?.provider === 'manual') {
    state = 'manual';
  }

  const lastEnrichedAt = m?.lastEnrichedAt ?? null;
  const sourceLabel = m?.source ? PROVIDER_LABEL[m.source] ?? m.source : '—';

  let label: string;
  let icon: ReactElement;
  if (isLoading) {
    label = 'A carregar estado de enriquecimento…';
    icon = <Loader2 size={10} className="inline animate-spin mr-1" aria-hidden="true" />;
  } else if (state === 'never') {
    label = 'Nunca enriquecido';
    icon = <Sparkles size={10} className="inline mr-0.5" aria-hidden="true" />;
  } else if (state === 'manual') {
    label = m?.error
      ? `Enriquecimento manual necessário (${m.error})`
      : 'Enriquecimento manual necessário';
    icon = <AlertCircle size={10} className="inline mr-0.5" aria-hidden="true" />;
  } else if (state === 'cached') {
    label = `Enriquecido ${timeAgo(lastEnrichedAt)} via ${sourceLabel}`;
    icon = <CheckCircle2 size={10} className="inline mr-0.5" aria-hidden="true" />;
  } else {
    label = `Cache expirado (último: ${timeAgo(lastEnrichedAt)} via ${sourceLabel})`;
    icon = <AlertCircle size={10} className="inline mr-0.5" aria-hidden="true" />;
  }

  const badgeClass =
    state === 'cached'
      ? 'badge-emerald'
      : state === 'manual'
      ? 'badge-amber'
      : state === 'stale'
      ? 'badge-amber'
      : 'badge-neutral';

  return (
    <span className="inline-flex items-center gap-2">
      <span className={badgeClass} title={label}>
        {icon}
        {label}
      </span>
      {isAdmin && (
        <button
          type="button"
          onClick={() => enrich.mutate()}
          disabled={isMutating}
          className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          title="Re-extrair dados externos (Sabi PT / VIES / manual)"
        >
          {isMutating ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <RefreshCw size={10} />
          )}
          Re-extrair dados
        </button>
      )}
      {enrich.data && enrich.data.fieldsPopulated.length > 0 && (
        <span
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
          title={`Campos preenchidos: ${enrich.data.fieldsPopulated.join(', ')}`}
        >
          ({enrich.data.fieldsPopulated.length} campo{enrich.data.fieldsPopulated.length === 1 ? '' : 's'})
        </span>
      )}
      {error && (
        <span className="text-xs text-red-500" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
