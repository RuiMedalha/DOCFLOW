'use client';

/**
 * DataTable — generic TanStack-Table wrapper with sorting, empty/loading
 * states, and the DocFlow table styling. Keeps every Wave 3 module table
 * consistent (banking, payments, CRM, audit).
 */

import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ChevronsUpDown, Inbox } from 'lucide-react';
import { SkeletonTable } from './skeleton';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  /** Empty-state message when there are no rows and not loading. */
  emptyLabel?: string;
  emptyIcon?: ReactNode;
  /** Optional row click handler. */
  onRowClick?: (row: T) => void;
  /** Stable row id accessor. */
  getRowId?: (row: T, index: number) => string;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyLabel = 'Sem registos.',
  emptyIcon,
  onRowClick,
  getRowId,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });

  if (loading) {
    return (
      <div className="card p-5">
        <SkeletonTable rows={6} cols={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="card p-10 text-center animate-in">
        <div
          className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
          style={{ background: 'var(--hover)', color: 'var(--text-subtle)' }}
        >
          {emptyIcon ?? <Inbox size={22} aria-hidden="true" />}
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden animate-in">
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
                      className="text-left font-medium px-4 py-3 whitespace-nowrap"
                      style={{ color: 'var(--text-subtle)' }}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-[var(--text)] transition-colors"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ChevronUp size={13} />
                          ) : sorted === 'desc' ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronsUpDown size={13} style={{ opacity: 0.5 }} />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className="transition-colors"
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: onRowClick ? 'pointer' : undefined,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
