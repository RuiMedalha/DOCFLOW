'use client';

/**
 * DocFlow — Deals Kanban board (moves stages via PATCH /deals/:id/stage).
 */

import { useState } from 'react';
import { Plus, Loader2, TrendingUp } from 'lucide-react';
import { useDeals, usePipelines, useMoveDealStage, useDealStats } from './use-crm';
import type { Deal, DealFilters, DealStage } from '../_lib/types';

const STAGES: DealStage[] = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const STAGE_LABEL: Record<DealStage, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Qualificado',
  PROPOSAL: 'Proposta',
  NEGOTIATION: 'Negociação',
  WON: 'Ganho',
  LOST: 'Perdido',
};
const STAGE_COLOR: Record<DealStage, string> = {
  LEAD: 'rgba(148,163,184,0.20)',
  QUALIFIED: 'rgba(56,189,248,0.20)',
  PROPOSAL: 'rgba(168,85,247,0.20)',
  NEGOTIATION: 'rgba(245,158,11,0.20)',
  WON: 'rgba(34,197,94,0.20)',
  LOST: 'rgba(248,113,113,0.20)',
};

const INITIAL: DealFilters = { search: '', stage: '', pipelineId: '', contactId: '' };

export function DealsBoard() {
  const [filters, setFilters] = useState<DealFilters>(INITIAL);
  const { data: dealsData, isLoading } = useDeals(filters, 1, 200);
  const { data: pipelines } = usePipelines();
  const { data: stats } = useDealStats();
  const move = useMoveDealStage();

  const items = dealsData?.items ?? [];

  const byStage: Record<DealStage, Deal[]> = {
    LEAD: [],
    QUALIFIED: [],
    PROPOSAL: [],
    NEGOTIATION: [],
    WON: [],
    LOST: [],
  };
  items.forEach((d: Deal) => {
    if (d.stage && byStage[d.stage]) {
      byStage[d.stage].push(d);
    }
  });

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          type="search"
          placeholder="Pesquisar título…"
          className="input"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select
          className="select"
          value={filters.pipelineId}
          onChange={(e) => setFilters({ ...filters, pipelineId: e.target.value })}
        >
          <option value="">Todos os pipelines</option>
          {pipelines?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {stats && (
        <div className="grid sm:grid-cols-4 gap-3">
          <StatTile label="Total em pipeline" value={new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(stats.totalValue)} />
          <StatTile label="Ponderado" value={new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(stats.weightedTotal)} />
          <StatTile label="Ganho" value={new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(stats.wonValue)} accent="emerald" />
          <StatTile label="Perdido" value={new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(stats.lostValue)} accent="red" />
        </div>
      )}

      {isLoading ? (
        <div className="card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="inline animate-spin mr-2" /> A carregar…
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 overflow-x-auto">
          {STAGES.map((stage) => (
            <div
              key={stage}
              className="rounded-lg p-3 min-h-[280px]"
              style={{ background: STAGE_COLOR[stage], border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide">{STAGE_LABEL[stage]}</h3>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{byStage[stage].length}</span>
              </div>
              <div className="space-y-2">
                {byStage[stage].map((d) => (
                  <DealCard key={d.id} deal={d} onMove={(to) => move.mutate({ id: d.id, stage: to })} />
                ))}
                {byStage[stage].length === 0 && (
                  <p className="text-[10px] text-center py-4" style={{ color: 'var(--text-muted)' }}>
                    Sem negócios
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-center pt-2">
        <a href="/crm/deals/new" className="btn-primary text-xs inline-flex items-center gap-1">
          <Plus size={12} /> Novo negócio
        </a>
      </div>
    </div>
  );
}

function DealCard({ deal, onMove }: { deal: Deal; onMove: (stage: DealStage) => void }) {
  const format = (n: number) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n);
  return (
    <article className="card-solid p-2.5 text-xs space-y-1.5 hover:shadow-md transition-shadow">
      <div className="font-medium truncate">{deal.title}</div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-emerald-500">{format(deal.value)}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{deal.probability}%</span>
      </div>
      {deal.contact && (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{deal.contact.name}</div>
      )}
      <div className="flex items-center gap-1 pt-1 flex-wrap">
        {STAGES.filter((s) => s !== deal.stage).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onMove(s)}
            className="text-[9px] px-1.5 py-0.5 rounded-full hover:bg-sky-500/10"
            style={{ border: '1px solid var(--border)' }}
            title={`Mover para ${STAGE_LABEL[s]}`}
          >
            → {STAGE_LABEL[s]}
          </button>
        ))}
      </div>
    </article>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'red' }) {
  return (
    <div className="card p-3">
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div
        className="text-lg font-bold mt-1 inline-flex items-center gap-1.5"
        style={{ color: accent === 'emerald' ? '#10b981' : accent === 'red' ? '#ef4444' : 'var(--text)' }}
      >
        <TrendingUp size={14} />
        {value}
      </div>
    </div>
  );
}