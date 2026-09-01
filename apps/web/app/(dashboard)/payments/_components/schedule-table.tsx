'use client';

/**
 * DocFlow — ScheduleTable (F.7): payment history / scheduled payments.
 *
 * Read-oriented list of the recurring + one-off scheduled payments, with a
 * delete action. Recurring items show their cadence. Feeds the "Agenda"
 * tab of the payments page.
 */

import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Trash2, CalendarClock, Repeat } from 'lucide-react';
import { DataTable, Badge, Button } from '../../../_components/ui';
import { formatCurrency, formatDate } from '../../../_lib/format';
import {
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  type PaymentSchedule,
} from '../_lib/types';
import { useDeleteSchedule } from '../_lib/use-payments-queries';

const columnHelper = createColumnHelper<PaymentSchedule>();

export function ScheduleTable({
  data,
  loading,
}: {
  data: PaymentSchedule[];
  loading: boolean;
}) {
  const del = useDeleteSchedule();

  const columns = useMemo<ColumnDef<PaymentSchedule, unknown>[]>(
    () => [
      columnHelper.accessor('title', {
        header: 'Título',
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            {row.original.recurring && (
              <Repeat size={13} style={{ color: 'var(--accent)' }} aria-label="Recorrente" />
            )}
            <div className="min-w-0">
              <p className="font-medium truncate" style={{ color: 'var(--text)' }}>
                {row.original.title}
              </p>
              {row.original.category && (
                <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                  {row.original.category}
                </p>
              )}
            </div>
          </div>
        ),
      }) as ColumnDef<PaymentSchedule, unknown>,
      columnHelper.accessor('dueDate', {
        header: 'Vencimento',
        cell: ({ getValue }) => (
          <span className="tabular-nums whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {formatDate(getValue() as string | null)}
          </span>
        ),
      }) as ColumnDef<PaymentSchedule, unknown>,
      columnHelper.accessor('amount', {
        header: 'Montante',
        cell: ({ getValue }) => (
          <span className="tabular-nums font-medium whitespace-nowrap" style={{ color: 'var(--text)' }}>
            {formatCurrency(getValue() as number)}
          </span>
        ),
      }) as ColumnDef<PaymentSchedule, unknown>,
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue }) => {
          const s = getValue() as PaymentSchedule['status'];
          return <Badge tone={PAYMENT_STATUS_TONE[s]}>{PAYMENT_STATUS_LABEL[s]}</Badge>;
        },
      }) as ColumnDef<PaymentSchedule, unknown>,
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            loading={del.isPending && del.variables === row.original.id}
            onClick={() => del.mutate(row.original.id)}
            aria-label={`Eliminar ${row.original.title}`}
          >
            <span className="sr-only">Eliminar</span>
          </Button>
        ),
      }) as ColumnDef<PaymentSchedule, unknown>,
    ],
    [del],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      loading={loading}
      emptyIcon={<CalendarClock size={22} aria-hidden="true" />}
      emptyLabel="Sem pagamentos agendados."
      getRowId={(row) => row.id}
    />
  );
}
