'use client';

/**
 * DocFlow — PayablesTable (F.7): editable payment schedule / payables.
 *
 * Lists to-pay items with inline approve + mark-paid actions. Selecting
 * rows feeds the SEPA export modal. Overdue rows are visually flagged.
 */

import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, BadgeEuro, Wallet } from 'lucide-react';
import { DataTable, Badge, Button, Pagination } from '../../../_components/ui';
import { formatCurrency, formatDate } from '../../../_lib/format';
import {
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  type Payable,
} from '../_lib/types';
import { useApprovePayable, useMarkPaid } from '../_lib/use-payments-queries';

const columnHelper = createColumnHelper<Payable>();

export function PayablesTable({
  data,
  loading,
  page,
  limit,
  total,
  onPageChange,
  selectedIds,
  onToggleSelect,
}: {
  data: Payable[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
}) {
  const approve = useApprovePayable();
  const markPaid = useMarkPaid();

  const columns = useMemo<ColumnDef<Payable, unknown>[]>(
    () => [
      columnHelper.display({
        id: 'select',
        header: '',
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIds.includes(row.original.id)}
            onChange={() => onToggleSelect(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Selecionar ${row.original.description}`}
          />
        ),
        size: 32,
      }) as ColumnDef<Payable, unknown>,
      columnHelper.accessor('description', {
        header: 'Descrição',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium truncate" style={{ color: 'var(--text)' }}>
              {row.original.description}
            </p>
            {row.original.party?.name && (
              <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                {row.original.party.name}
              </p>
            )}
          </div>
        ),
      }) as ColumnDef<Payable, unknown>,
      columnHelper.accessor('dueDate', {
        header: 'Vencimento',
        cell: ({ getValue, row }) => {
          const overdue = row.original.status === 'OVERDUE';
          return (
            <span
              className="tabular-nums whitespace-nowrap"
              style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}
            >
              {formatDate(getValue() as string | null)}
            </span>
          );
        },
      }) as ColumnDef<Payable, unknown>,
      columnHelper.accessor('amount', {
        header: 'Montante',
        cell: ({ getValue }) => (
          <span className="tabular-nums font-medium whitespace-nowrap" style={{ color: 'var(--text)' }}>
            {formatCurrency(getValue() as number)}
          </span>
        ),
      }) as ColumnDef<Payable, unknown>,
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue }) => {
          const s = getValue() as Payable['status'];
          return <Badge tone={PAYMENT_STATUS_TONE[s]}>{PAYMENT_STATUS_LABEL[s]}</Badge>;
        },
      }) as ColumnDef<Payable, unknown>,
      columnHelper.display({
        id: 'actions',
        header: 'Ações',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {!p.approved && p.status !== 'PAID' && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<CheckCircle2 size={14} />}
                  loading={approve.isPending && approve.variables?.id === p.id}
                  onClick={() => approve.mutate({ id: p.id })}
                >
                  Aprovar
                </Button>
              )}
              {p.status !== 'PAID' && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<BadgeEuro size={14} />}
                  loading={markPaid.isPending && markPaid.variables?.id === p.id}
                  onClick={() => markPaid.mutate({ id: p.id, paidAmount: p.amount })}
                >
                  Marcar pago
                </Button>
              )}
            </div>
          );
        },
      }) as ColumnDef<Payable, unknown>,
    ],
    [approve, markPaid, selectedIds, onToggleSelect],
  );

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyIcon={<Wallet size={22} aria-hidden="true" />}
        emptyLabel="Sem pagamentos pendentes."
        getRowId={(row) => row.id}
      />
      {total > limit && (
        <Pagination page={page} pageSize={limit} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}
