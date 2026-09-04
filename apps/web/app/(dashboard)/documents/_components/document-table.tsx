'use client';

/**
 * DocFlow — DocumentTable.
 *
 * TanStack Table with columns: file, type, supplier, NIF, date, total,
 * IVA, status, folder. Supports selection (used by bulk actions),
 * empty/loading states, and pagination via the parent.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ChevronsUpDown, FileText, Folder } from 'lucide-react';
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  type DocumentRecord,
  type DocumentStatus,
} from './types';

const STATUS_BADGE: Record<DocumentStatus, string> = {
  novo: 'badge-amber',
  processado: 'badge-emerald',
  em_revisao: 'badge-sky',
  arquivado: 'badge-violet',
  conciliado: 'badge-emerald',
  erro: 'badge-rose',
};

const columnHelper = createColumnHelper<DocumentRecord>();

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentTable({
  data,
  loading,
  page,
  pageSize,
  total,
  selection,
  onSelectionChange,
  onPageChange,
}: {
  data: DocumentRecord[];
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  selection: RowSelectionState;
  onSelectionChange: (next: RowSelectionState) => void;
  onPageChange: (page: number) => void;
}) {
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
            onChange={(v) => table.toggleAllRowsSelected(v)}
            ariaLabel="Selecionar todas as linhas"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={(v) => row.toggleSelected(v)}
            ariaLabel={`Selecionar ${row.original.fileName}`}
          />
        ),
        size: 36,
        enableSorting: false,
      }),
      columnHelper.accessor('fileName', {
        header: 'Ficheiro',
        cell: ({ row }) => (
          <Link
            href={`/documents/${row.original.id}`}
            className="flex items-center gap-2.5 group min-w-0"
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
              style={{
                background: 'linear-gradient(135deg, rgba(56,189,248,0.15), rgba(129,140,248,0.10))',
                border: '1px solid rgba(56,189,248,0.25)',
              }}
            >
              <FileText size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="min-w-0">
              <p
                className="font-medium text-sm truncate group-hover:text-sky-400 transition-colors"
                style={{ color: 'var(--text)' }}
              >
                {row.original.fileName}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>
                {formatSize(row.original.fileSize)}
                {row.original.rank != null ? ` · Relevância ${row.original.rank.toFixed(3)}` : ''}
              </p>
            </div>
          </Link>
        ),
      }),
      columnHelper.accessor('type', {
        header: 'Tipo',
        cell: ({ getValue }) => (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {DOCUMENT_TYPE_LABEL[getValue()] ?? getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('supplier', {
        header: 'Fornecedor',
        cell: ({ getValue }) => (
          <span className="text-sm" style={{ color: 'var(--text)' }}>
            {getValue() ?? '—'}
          </span>
        ),
      }),
      columnHelper.accessor('nif', {
        header: 'NIF',
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {getValue() ?? '—'}
          </span>
        ),
      }),
      columnHelper.accessor('documentDate', {
        header: 'Data',
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {formatDate(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('total', {
        header: 'Total',
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums font-medium" style={{ color: 'var(--text)' }}>
            {formatCurrency(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('iva', {
        header: 'IVA',
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {formatCurrency(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue }) => {
          const v = getValue();
          return <span className={STATUS_BADGE[v]}>{DOCUMENT_STATUS_LABEL[v] ?? v}</span>;
        },
      }),
      columnHelper.accessor((row) => row.folder?.name ?? null, {
        id: 'folder',
        header: 'Pasta',
        cell: ({ row }) => (
          <span
            className="inline-flex items-center gap-1.5 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <Folder size={12} style={{ color: 'var(--text-subtle)' }} />
            {row.original.folder?.name ?? '—'}
          </span>
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { rowSelection: selection },
    enableRowSelection: true,
    onRowSelectionChange: (updater) => {
      // When state is controlled, the updater receives the new state directly.
      const next = typeof updater === 'function' ? updater(selection) : updater;
      onSelectionChange(next as RowSelectionState);
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => row.id,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3 animate-in animate-delay-2">
      <div
        className="card overflow-hidden"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className="text-left text-xs font-medium uppercase tracking-wider px-3.5 py-3 select-none"
                        style={{
                          color: 'var(--text-subtle)',
                          width: header.column.columnDef.size ?? undefined,
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : canSort
                            ? (
                              <button
                                type="button"
                                onClick={header.column.getToggleSortingHandler()}
                                className="inline-flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
                                style={{ color: 'inherit' }}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sorted === 'asc' ? (
                                  <ChevronUp size={12} />
                                ) : sorted === 'desc' ? (
                                  <ChevronDown size={12} />
                                ) : (
                                  <ChevronsUpDown size={12} />
                                )}
                              </button>
                            )
                            : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    {columns.map((_, j) => (
                      <td key={j} className="px-3.5 py-3.5">
                        <div className="skeleton h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3.5 py-16 text-center">
                    <div
                      className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
                      style={{ background: 'var(--hover)' }}
                    >
                      <FileText size={20} style={{ color: 'var(--text-subtle)' }} />
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Sem documentos com os filtros atuais.
                    </p>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3.5 py-3 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && data.length > 0 && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="tabular-nums">
            Página {page} de {totalPages} · {total} no total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
            >
              Seguinte
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="w-4 h-4 rounded-md border flex items-center justify-center transition-colors"
      style={{
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)',
        background: checked || indeterminate ? 'var(--accent)' : 'transparent',
      }}
    >
      {checked && (
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path
            d="M3 8.5l3.2 3.2L13 4.8"
            stroke="#020617"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      )}
      {indeterminate && (
        <span
          aria-hidden="true"
          className="block w-2 h-0.5 rounded-full"
          style={{ background: '#020617' }}
        />
      )}
    </button>
  );
}
