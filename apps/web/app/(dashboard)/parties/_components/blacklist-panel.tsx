'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useBlacklist, useAddBlacklist } from './use-parties';

export function BlacklistPanel() {
  const { data, isLoading } = useBlacklist(1, 100);
  const add = useAddBlacklist();
  const [form, setForm] = useState({ iban: '', reason: '', source: 'manual' });

  return (
    <div className="space-y-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.iban.trim() || !form.reason.trim()) return;
          await add.mutateAsync({
            iban: form.iban.trim(),
            reason: form.reason.trim(),
            source: form.source,
          });
          setForm({ iban: '', reason: '', source: 'manual' });
        }}
        className="card p-4 grid sm:grid-cols-4 gap-3 items-end"
      >
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>IBAN</label>
          <input
            className="input mt-1 w-full font-mono text-xs"
            placeholder="PT50…"
            value={form.iban}
            onChange={(e) => setForm({ ...form, iban: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Motivo</label>
          <input
            className="input mt-1 w-full text-xs"
            placeholder="ex: phishing"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
        </div>
        <button type="submit" className="btn-primary text-xs px-3 py-2 inline-flex items-center justify-center gap-1" disabled={add.isPending}>
          {add.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Adicionar
        </button>
      </form>

      {isLoading ? (
        <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={14} className="inline animate-spin mr-2" /> A carregar…
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>IBAN</th>
                <th>Motivo</th>
                <th>Origem</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>Lista vazia.</td></tr>
              )}
              {data?.items.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">{b.iban}</td>
                  <td className="text-sm">{b.reason}</td>
                  <td><span className="badge text-[10px]">{b.source}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(b.createdAt).toLocaleString('pt-PT')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}