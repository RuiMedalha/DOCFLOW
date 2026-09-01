'use client';

import { useState } from 'react';
import { Plus, Loader2, Search } from 'lucide-react';
import { useAccounts, useCreateAccount } from './use-parties';
import type { AccountType } from '../_lib/types';

const TYPE_LABEL: Record<AccountType, string> = {
  ATIVO: 'Ativo',
  PASSIVO: 'Passivo',
  CAPITAL_PROPRIO: 'Capital próprio',
  RECEITA: 'Receita',
  CUSTO: 'Custo',
  OUTRO: 'Outro',
};

export function AccountsList() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAccounts(1, 200, search);
  const create = useCreateAccount();
  const [form, setForm] = useState<{ code: string; name: string; type: AccountType; parentCode: string }>({ code: '', name: '', type: 'OUTRO', parentCode: '' });

  return (
    <div className="space-y-4">
      <div className="card p-4 grid sm:grid-cols-5 gap-3 items-end">
        <div className="sm:col-span-2 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Pesquisar código ou nome…"
            className="input pl-8 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input
          className="input text-xs font-mono"
          placeholder="Código"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <input
          className="input text-xs"
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select className="select text-xs" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
          {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <input
          className="input text-xs font-mono sm:col-span-2"
          placeholder="Código-pai (opcional)"
          value={form.parentCode}
          onChange={(e) => setForm({ ...form, parentCode: e.target.value })}
        />
        <button
          type="button"
          className="btn-primary text-xs px-3 py-2 inline-flex items-center justify-center gap-1 sm:col-span-3"
          disabled={!form.code.trim() || !form.name.trim() || create.isPending}
          onClick={async () => {
            try {
              await create.mutateAsync({
                code: form.code.trim(),
                name: form.name.trim(),
                type: form.type,
                parentCode: form.parentCode.trim() || undefined,
              });
              setForm({ code: '', name: '', type: 'OUTRO', parentCode: '' });
            } catch (err) {
              alert((err as Error).message);
            }
          }}
        >
          {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Criar conta
        </button>
      </div>

      {isLoading ? (
        <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={14} className="inline animate-spin mr-2" /> A carregar…
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th className="text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>Sem contas.</td></tr>
              )}
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs">{a.code}</td>
                  <td className="text-sm">{a.name}</td>
                  <td><span className="badge text-[10px]">{TYPE_LABEL[a.type]}</span></td>
                  <td className="text-right text-xs">{a.isActive ? 'Ativa' : 'Inativa'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}