'use client';

/**
 * DocFlow â€” PipelineBoard (F.6): Kanban of deals by stage.
 *
 * Native HTML5 drag-and-drop moves a deal card to another column, firing
 * an optimistic stage move. Columns are the DealStage values; each shows a
 * count + summed value. Keyboard users get a per-card stage <select> as an
 * accessible alternative to dragging.
 */

import { useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { Badge, Skeleton } from '../../../_components/ui';
import { formatCurrency } from '../../../_lib/format';
import { DEAL_STAGES, type Deal, type DealStage } from '../_lib/types';
import { useMoveDealStage } from '../_lib/use-crm-queries';

export function PipelineBoard({
  deals,
  loading,
}: {
  deals: Deal[];
  loading: boolean;
}) {
  const move = useMoveDealStage();
  const [dragId, setDragId] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    for (const stage of DEAL_STAGES) map.set(stage.id, []);
    for (const deal of deals) {
      const list = map.get(deal.stage);
      if (list) list.push(deal);
    }
    return map;
  }, [deals]);

  const onDrop = (stage: DealStage) => {
    if (dragId) {
      const deal = deals.find((d) => d.id === dragId);
      if (deal && deal.stage !== stage) move.mutate({ id: dragId, stage });
    }
    setDragId(null);
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {DEAL_STAGES.map((s) => (
          <div key={s.id} className="card p-4 space-y-3">
            <Skeleton height="h-5" width="w-24" />
            <Skeleton height="h-20" />
            <Skeleton height="h-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6 items-start">
      {DEAL_STAGES.map((stage) => {
        const list = byStage.get(stage.id) ?? [];
        const sum = list.reduce((acc, d) => acc + (d.value ?? 0), 0);
        return (
          <section
            key={stage.id}
            className="card p-3 min-h-40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(stage.id)}
            aria-label={`Coluna ${stage.label}`}
          >
            <header className="flex items-center justify-between gap-2 mb-3 px-1">
              <div className="flex items-center gap-2">
                <Badge tone={stage.tone}>{stage.label}</Badge>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-subtle)' }}>
                  {list.length}
                </span>
              </div>
            </header>
            <p className="text-xs tabular-nums px-1 mb-2" style={{ color: 'var(--text-muted)' }}>
              {formatCurrency(sum)}
            </p>
            <div className="space-y-2">
              {list.map((deal) => (
                <article
                  key={deal.id}
                  draggable
                  onDragStart={() => setDragId(deal.id)}
                  onDragEnd={() => setDragId(null)}
                  className="rounded-lg p-3 cursor-grab active:cursor-grabbing transition-shadow"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical size={14} style={{ color: 'var(--text-subtle)' }} className="mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                        {deal.title}
                      </p>
                      {deal.contact?.name && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                          {deal.contact.name}
                        </p>
                      )}
                      <p className="text-sm font-semibold tabular-nums mt-1" style={{ color: 'var(--accent)' }}>
                        {formatCurrency(deal.value)}
                      </p>
                    </div>
                  </div>
                  <label className="sr-only" htmlFor={`stage-${deal.id}`}>
                    Mover {deal.title} para outra etapa
                  </label>
                  <select
                    id={`stage-${deal.id}`}
                    className="input input-sm mt-2"
                    value={deal.stage}
                    onChange={(e) => move.mutate({ id: deal.id, stage: e.target.value as DealStage })}
                  >
                    {DEAL_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
              {list.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-subtle)' }}>
                  Sem oportunidades
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

