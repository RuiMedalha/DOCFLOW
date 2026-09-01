'use client';

/**
 * DocFlow — ContactList (F.6): paginated contact list with advanced search.
 *
 * Search filters by name/NIF/email (server-side), plus type + active
 * toggle. Rows open the edit dialog via the parent. Uses the shared
 * DataTable for consistent sorting + empty states.
 */

import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Search, Building2, User, Plus, Users } from 'lucide-react';
import { DataTable, Badge, Button, Pagination, Select } from '../../../_components/ui';
import { formatDate } from '../../../_lib/format';
import { CONTACT_TYPE_LABEL, type ContactFilters, type CrmContact } from '../_lib/types';

const columnHelper = createColumnHelper<CrmContact>();

const TYPE_OPTIONS = [
  { value: '', label: 'Todos os tipos' },
  { value: 'COMPANY', label: 'Empresa' },
  { value: 'INDIVIDUAL', label: 'Particular' },
];

export function ContactList({
  data,
  loading,
  filters,
  onFiltersChange,
  page,
  limit,
  total,
  onPageChange,
  onEdit,
  onCreate,
}: {
  data: CrmContact[];
  loading: boolean;
  filters: ContactFilters;
  onFiltersChange: (next: ContactFilters) => void;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onEdit: (contact: CrmContact) => void;
  onCreate: () => void;
}) {
  const columns = useMemo<ColumnDef<CrmContact, unknown>[]>(
    () => [
      columnHelper.accessor('name', {
        header: 'Nome',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--hover)', color: 'var(--accent)' }}
            >
              {row.original.type === 'COMPANY' ? <Building2 size={15} /> : <User size={15} />}
            </span>
            <div className="min-w-0">
              <p className="font-medium truncate" style={{ color: 'var(--text)' }}>
                {row.original.name}
              </p>
              {row.original.email && (
                <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                  {row.original.email}
                </p>
              )}
            </div>
          </div>
        ),
      }) as ColumnDef<CrmContact, unknown>,
      columnHelper.accessor('type', {
        header: 'Tipo',
        cell: ({ getValue }) => (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {CONTACT_TYPE_LABEL[getValue() as CrmContact['type']]}
          </span>
        ),
      }) as ColumnDef<CrmContact, unknown>,
      columnHelper.accessor('nif', {
        header: 'NIF',
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {getValue() ?? '—'}
          </span>
        ),
      }) as ColumnDef<CrmContact, unknown>,
      columnHelper.accessor('phone', {
        header: 'Contacto',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {row.original.phone ?? row.original.mobile ?? '—'}
          </span>
        ),
      }) as ColumnDef<CrmContact, unknown>,
      columnHelper.accessor('isActive', {
        header: 'Estado',
        cell: ({ getValue }) =>
          getValue() ? <Badge tone="emerald">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>,
      }) as ColumnDef<CrmContact, unknown>,
      columnHelper.accessor('createdAt', {
        header: 'Criado',
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-subtle)' }}>
            {formatDate(getValue() as string)}
          </span>
        ),
      }) as ColumnDef<CrmContact, unknown>,
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-subtle)' }}
          />
          <input
            type="search"
            className="input pl-10"
            placeholder="Pesquisar por nome, NIF ou email…"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            aria-label="Pesquisar contactos"
          />
        </div>
        <Select
          options={TYPE_OPTIONS}
          value={filters.type}
          onChange={(v) => onFiltersChange({ ...filters, type: v as ContactFilters['type'] })}
          containerClassName="md:w-44 !mb-0"
          aria-label="Filtrar por tipo"
        />
        <label className="flex items-center gap-2 text-sm whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={Boolean(filters.isActive)}
            onChange={(e) => onFiltersChange({ ...filters, isActive: e.target.checked })}
          />
          Apenas ativos
        </label>
        <Button variant="primary" leftIcon={<Plus size={15} />} onClick={onCreate}>
          Novo contacto
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyIcon={<Users size={22} aria-hidden="true" />}
        emptyLabel="Sem contactos. Crie o primeiro para começar."
        onRowClick={onEdit}
        getRowId={(row) => row.id}
      />

      {total > limit && (
        <Pagination page={page} pageSize={limit} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}
