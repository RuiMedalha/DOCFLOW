'use client';

/**
 * DocFlow — DocumentFilters.
 *
 * Search + status + type + date range. Reset button clears the state.
 * Filters are local until "search" debounces; the page wires `onChange`
 * to the parent.
 */

import { Search, X, CalendarDays } from 'lucide-react';
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  type DocumentFiltersState,
  type DocumentStatus,
  type DocumentType,
} from './types';

const STATUS_OPTIONS: Array<{ value: '' | DocumentStatus; label: string }> = [
  { value: '', label: 'Todos os estados' },
  { value: 'novo', label: DOCUMENT_STATUS_LABEL.novo },
  { value: 'processado', label: DOCUMENT_STATUS_LABEL.processado },
  { value: 'em_revisao', label: DOCUMENT_STATUS_LABEL.em_revisao },
  { value: 'conciliado', label: DOCUMENT_STATUS_LABEL.conciliado },
  { value: 'arquivado', label: DOCUMENT_STATUS_LABEL.arquivado },
  { value: 'erro', label: DOCUMENT_STATUS_LABEL.erro },
];

const TYPE_OPTIONS: Array<{ value: '' | DocumentType; label: string }> = [
  { value: '', label: 'Todos os tipos' },
  { value: 'fatura', label: DOCUMENT_TYPE_LABEL.fatura },
  { value: 'recibo', label: DOCUMENT_TYPE_LABEL.recibo },
  { value: 'nota_credito', label: DOCUMENT_TYPE_LABEL.nota_credito },
  { value: 'nota_debito', label: DOCUMENT_TYPE_LABEL.nota_debito },
  { value: 'guia_transporte', label: DOCUMENT_TYPE_LABEL.guia_transporte },
  { value: 'outro', label: DOCUMENT_TYPE_LABEL.outro },
];

export function DocumentFilters({
  value,
  onChange,
  total,
}: {
  value: DocumentFiltersState;
  onChange: (next: DocumentFiltersState) => void;
  total: number;
}) {
  const isFiltered =
    Boolean(value.search) ||
    Boolean(value.status) ||
    Boolean(value.type) ||
    Boolean(value.dateFrom) ||
    Boolean(value.dateTo);

  const reset = () =>
    onChange({ search: '', status: '', type: '', dateFrom: '', dateTo: '' });

  return (
    <div className="card p-4 animate-in animate-delay-1 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-subtle)' }}
          />
          <input
            type="search"
            className="input pl-10"
            placeholder="Pesquisar por nome, fornecedor, NIF…"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            aria-label="Pesquisar documentos"
          />
        </div>

        <select
          className="input md:w-48"
          value={value.status}
          onChange={(e) =>
            onChange({ ...value, status: e.target.value as DocumentFiltersState['status'] })
          }
          aria-label="Filtrar por estado"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          className="input md:w-48"
          value={value.type}
          onChange={(e) =>
            onChange({ ...value, type: e.target.value as DocumentFiltersState['type'] })
          }
          aria-label="Filtrar por tipo"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <CalendarDays size={14} style={{ color: 'var(--text-subtle)' }} />
          <input
            type="date"
            className="input md:w-auto"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            aria-label="Data inicial"
          />
          <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
            até
          </span>
          <input
            type="date"
            className="input md:w-auto"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            aria-label="Data final"
          />
        </div>

        <div className="flex items-center gap-3 justify-between md:justify-end">
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {total} resultado{total === 1 ? '' : 's'}
          </span>
          {isFiltered && (
            <button type="button" onClick={reset} className="btn-ghost text-xs px-3 py-1.5">
              <X size={12} /> Limpar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
