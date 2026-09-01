'use client';

/**
 * DocFlow — CRM contacts list.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Search, Plus, Building2, User2, Filter } from 'lucide-react';
import { useCrmContacts, useDeleteContact } from './use-crm';
import type { CrmContactFilters } from '../_lib/types';

const INITIAL: CrmContactFilters = { search: '', type: '', isActive: '' };

export function ContactsList() {
  const [filters, setFilters] = useState<CrmContactFilters>(INITIAL);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useCrmContacts(filters, page, 25);
  const del = useDeleteContact();

  const items = data?.items ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <FiltersBar value={filters} onChange={(v) => { setFilters(v); setPage(1); }} />

      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{total} contacto{total !== 1 ? 's' : ''}</span>
        <Link href="/crm/contacts/new" className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1">
          <Plus size={12} /> Novo contacto
        </Link>
      </div>

      {isError ? (
        <div className="card p-6 text-sm text-red-500">Erro ao carregar os contactos.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>NIF</th>
                <th>Email</th>
                <th>Cidade</th>
                <th className="text-right">Negócios</th>
                <th className="text-right">Atividades</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>A carregar…</td></tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>Sem contactos.</td></tr>
              )}
              {items.map((c: import('../_lib/types').CrmContact) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/crm/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    {!c.isActive && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-red-500">inativo</span>
                    )}
                  </td>
                  <td>
                    <span className="badge text-[10px] inline-flex items-center gap-1">
                      {c.type === 'COMPANY' ? <Building2 size={10} /> : <User2 size={10} />}
                      {c.type === 'COMPANY' ? 'Empresa' : 'Individual'}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{c.nif ?? '—'}</td>
                  <td className="text-xs">{c.email ?? '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.city ?? '—'}</td>
                  <td className="text-right text-xs">{c._count?.deals ?? 0}</td>
                  <td className="text-right text-xs">{c._count?.activities ?? 0}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => {
                        if (confirm(`Eliminar ${c.name}?`)) del.mutate(c.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>Página {page} de {totalPages}</span>
          <div className="flex gap-1">
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Seguinte</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FiltersBar({ value, onChange }: { value: CrmContactFilters; onChange: (v: CrmContactFilters) => void }) {
  return (
    <div className="card p-4 grid sm:grid-cols-3 gap-3">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Pesquisar nome, NIF, email…"
          className="input pl-8 w-full"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
        />
      </div>
      <div className="relative">
        <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <select
          className="select pl-8 w-full"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as '' | 'COMPANY' | 'INDIVIDUAL' })}
        >
          <option value="">Todos os tipos</option>
          <option value="COMPANY">Empresa</option>
          <option value="INDIVIDUAL">Individual</option>
        </select>
      </div>
      <select
        className="select"
        value={String(value.isActive ?? '')}
        onChange={(e) => onChange({ ...value, isActive: (e.target.value as '' | 'true' | 'false') })}
      >
        <option value="">Ativos e inativos</option>
        <option value="true">Apenas ativos</option>
        <option value="false">Apenas inativos</option>
      </select>
    </div>
  );
}