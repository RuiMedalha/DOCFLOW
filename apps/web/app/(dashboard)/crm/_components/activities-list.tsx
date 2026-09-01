'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useActivities, useCompleteActivity } from './use-crm';
import type { ActivityType } from '../_lib/types';

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  CALL: 'Chamada',
  EMAIL: 'Email',
  MEETING: 'ReuniÃ£o',
  TASK: 'Tarefa',
  NOTE: 'Nota',
  FOLLOW_UP: 'Follow-up',
};

export function ActivitiesList() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'' | ActivityType>('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const params: Record<string, string> = {};
  if (typeFilter) params.type = typeFilter;
  if (pendingOnly) params.onlyPending = 'true';

  const { data, isLoading } = useActivities(params, page, 25);
  const complete = useCompleteActivity();
  const items = data?.items ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="card p-4 grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Tipo</label>
          <select className="select mt-1 w-full" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as ActivityType | ''); setPage(1); }}>
            <option value="">Todos</option>
            {Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); }} />
          Apenas pendentes
        </label>
        <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{total} atividades</div>
      </div>

      {isLoading ? (
        <div className="card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="inline animate-spin mr-2" /> A carregarâ€¦
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Sem atividades.</div>
      ) : (
        <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
          {items.map((a: import('../_lib/types').Activity) => (
            <div key={a.id} className="p-3 flex items-start gap-3">
              <span className="badge text-[10px] whitespace-nowrap">{ACTIVITY_LABEL[a.type]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{a.subject}</div>
                {a.notes && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.notes}</div>}
                <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {new Date(a.createdAt).toLocaleString('pt-PT')}
                  {a.assignedTo && ` Â· para ${a.assignedTo.name}`}
                  {a.completedAt && ' Â· âœ“'}
                </div>
              </div>
              {!a.completedAt && (
                <button type="button" className="text-xs text-sky-500 hover:underline" onClick={() => complete.mutate(a.id)}>
                  Concluir
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>PÃ¡gina {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Seguinte</button>
          </div>
        </div>
      )}
    </div>
  );
}
