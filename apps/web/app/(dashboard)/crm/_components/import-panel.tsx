'use client';

/**
 * DocFlow — CRM import panel (HubSpot / Pipedrive adapters).
 */

import { useState } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle2, History } from 'lucide-react';
import { useImportContacts, useSyncHistory } from './use-crm';
import type { ImportSummary } from '../_lib/types';

export function ImportPanel() {
  const importM = useImportContacts();
  const [source, setSource] = useState<'hubspot' | 'pipedrive'>('hubspot');
  const [dryRun, setDryRun] = useState(true);
  const [merge, setMerge] = useState(true);
  const [lastRun, setLastRun] = useState<{ summary: ImportSummary; dryRun: boolean } | null>(null);
  const { data: history } = useSyncHistory();

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <header>
          <h3 className="text-sm font-semibold">Importar contactos</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Os adapters HubSpot / Pipedrive estão em modo mock. O mapeamento, deduplicação por NIF/email
            e escrita na base são reais — uma sincronização a sério só precisa do token OAuth.
          </p>
        </header>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Fonte</label>
            <select className="select mt-1 w-full" value={source} onChange={(e) => setSource(e.target.value as 'hubspot' | 'pipedrive')}>
              <option value="hubspot">HubSpot</option>
              <option value="pipedrive">Pipedrive</option>
            </select>
          </div>
          <div className="space-y-2 pt-5">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry-run (não escreve)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              Fundir duplicados (NIF / email)
            </label>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary text-sm"
          disabled={importM.isPending}
          onClick={async () => {
            const res = await importM.mutateAsync({ source, dryRun, mergeDuplicates: merge });
            setLastRun({ summary: res.summary, dryRun: res.dryRun });
          }}
        >
          {importM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {importM.isPending ? 'A importar…' : dryRun ? 'Pré-visualizar' : 'Executar importação'}
        </button>

        {lastRun && (
          <div
            className="rounded-md p-3 text-xs space-y-1.5"
            style={{
              background: lastRun.dryRun ? 'rgba(56,189,248,0.10)' : 'rgba(34,197,94,0.10)',
              border: lastRun.dryRun ? '1px solid rgba(56,189,248,0.30)' : '1px solid rgba(34,197,94,0.30)',
            }}
          >
            <div className="flex items-center gap-2 font-semibold">
              {lastRun.dryRun ? <AlertCircle size={14} className="text-sky-500" /> : <CheckCircle2 size={14} className="text-emerald-500" />}
              {lastRun.dryRun ? 'Pré-visualização (dry-run)' : 'Importação concluída'} — fonte {lastRun.summary.source}
            </div>
            <div className="grid grid-cols-5 gap-2">
              <Stat label="Total" value={lastRun.summary.total} />
              <Stat label="Criados" value={lastRun.summary.created} />
              <Stat label="Atualizados" value={lastRun.summary.updated} />
              <Stat label="Saltados" value={lastRun.summary.skipped} />
              <Stat label="Erros" value={lastRun.summary.errors} />
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <header className="flex items-center gap-2">
          <History size={16} />
          <h3 className="text-sm font-semibold">Histórico de sincronização</h3>
        </header>
        {(history ?? []).length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem sincronizações registadas.</p>
        )}
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {(history ?? []).map((h) => (
            <li key={h.id} className="py-2 text-xs flex items-center justify-between">
              <div>
                <span className="badge text-[10px] mr-2">{h.source}</span>
                <span className="text-sm font-medium">
                  {h.summary.created} criados · {h.summary.updated} atualizados · {h.summary.errors} erros
                </span>
                {h.user && <span className="ml-2" style={{ color: 'var(--text-muted)' }}>por {h.user.name}</span>}
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{new Date(h.createdAt).toLocaleString('pt-PT')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md p-2 text-center" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border)' }}>
      <div className="text-base font-bold">{value}</div>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}