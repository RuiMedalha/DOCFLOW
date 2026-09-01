'use client';

/**
 * DocFlow — StatementTable (F.5): sortable, filterable bank statement view.
 *
 * Wraps the shared DataTable with banking-specific columns and a filter
 * bar (search + date range + source). Reconciliation status is shown as a
 * badge; export streams a PT-friendly CSV.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Search, Download, Landmark } from 'lucide-react';
import { DataTable, Badge, Button, Pagination, Select } from '../../../_components/ui';
import { formatCurrency, formatDate } from '../../../_lib/format';
import type { BankTransaction, BankTransactionFilters } from '../_lib/types';
import { useExportTransactions } from '../_lib/use-banking-queries';

const columnHelper = createColumnHelper<BankTransaction>();

const SOURCE_OPTIONS = [
  { value: '', label: 'Todas as origens' },
  { value: 'CSV', label: 'CSV' },
  { value: 'CAMT.053', label: 'CAMT.053' },
];

export function StatementTable({
  data,
  loading,
  filters,
  onFiltersChange,
  page,
  limit,
  total,
  onPageChange,
}: {
  data: BankTransaction[];
  loading: boolean;
  filters: BankTransactionFilters;
  onFiltersChange: (next: BankTransactionFilters) => void;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const exportMutation = useExportTransactions();

  const columns = useMemo<ColumnDef<BankTransaction, unknown>[]>(
    () => [
      columnHelper.accessor('date', {
        header: 'Data',
        cell: ({ getValue }) => (
          <span className="tabular-nums whitespace-nowrap">{formatDate(getValue())}</span>
        ),
      }) as ColumnDef<BankTransaction, unknown>,
      columnHelper.accessor('description', {
        header: 'Descrição',
        enableSorting: false,
        cell: ({ getValue, row }) => (
          <div className="min-w-0">
            <Link
              href={`/banking/statements/${row.original.id}`}
              className="font-medium truncate hover:text-sky-500 hover:underline block"
              style={{ color: 'var(--text)' }}
            >
              {getValue()}
            </Link>
            {row.original.counterpartyName && (
              <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                {row.original.counterpartyName}
              </p>
            )}
          </div>
        ),
      }) as ColumnDef<BankTransaction, unknown>,
      columnHelper.accessor('reference', {
        header: 'Referência',
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {getValue() ?? '—'}
          </span>
        ),
      }) as ColumnDef<BankTransaction, unknown>,
      columnHelper.accessor('amount', {
        header: 'Valor',
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span
              className="tabular-nums font-medium whitespace-nowrap"
              style={{ color: v < 0 ? 'var(--danger)' : 'var(--success)' }}
            >
              {formatCurrency(v)}
            </span>
          );
        },
      }) as ColumnDef<BankTransaction, unknown>,
      columnHelper.accessor('balance', {
        header: 'Saldo',
        cell: ({ getValue }) => (
          <span className="tabular-nums whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {formatCurrency(getValue() as number | null)}
          </span>
        ),
      }) as ColumnDef<BankTransaction, unknown>,
      columnHelper.accessor('reconciled', {
        header: 'Estado',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge tone="emerald">Conciliado</Badge>
          ) : (
            <Badge tone="amber">Pendente</Badge>
          ),
      }) as ColumnDef<BankTransaction, unknown>,
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
            placeholder="Pesquisar descrição ou referência…"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            aria-label="Pesquisar movimentos"
          />
        </div>
        <input
          type="date"
          className="input md:w-auto"
          value={filters.from}
          onChange={(e) => onFiltersChange({ ...filters, from: e.target.value })}
          aria-label="Data inicial"
        />
        <input
          type="date"
          className="input md:w-auto"
          value={filters.to}
          onChange={(e) => onFiltersChange({ ...filters, to: e.target.value })}
          aria-label="Data final"
        />
        <Select
          options={SOURCE_OPTIONS}
          value={filters.source}
          onChange={(v) => onFiltersChange({ ...filters, source: v as BankTransactionFilters['source'] })}
          containerClassName="md:w-44 !mb-0"
          aria-label="Filtrar por origem"
        />
        <Button
          variant="secondary"
          leftIcon={<Download size={15} />}
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate(filters)}
        >
          Exportar CSV
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyIcon={<Landmark size={22} aria-hidden="true" />}
        emptyLabel="Sem movimentos. Importe um extrato para começar."
        getRowId={(row) => row.id}
      />

      {total > limit && (
        <Pagination page={page} pageSize={limit} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}
