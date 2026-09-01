'use client';

/**
 * Pagination — page control shared by every paginated table.
 *
 * Shows "N–M de TOTAL" plus prev/next buttons. Keeps logic minimal;
 * callers own the `page` state and pass `pageSize` + `total`.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs tabular-nums px-2" style={{ color: 'var(--text-muted)' }}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Página seguinte"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
