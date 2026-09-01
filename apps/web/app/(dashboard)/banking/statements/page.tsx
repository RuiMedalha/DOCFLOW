'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Upload, RefreshCw, GitCompare, ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { StatementTable } from '../_components/statement-table';
import { useBankTransactions } from '../_lib/use-banking-queries';
import type { BankTransactionFilters } from '../_lib/types';
import { Button } from '../../../_components/ui';

const LIMIT = 25;

const INITIAL_FILTERS: BankTransactionFilters = {
  search: '',
  from: '',
  to: '',
  source: '',
};

export default function StatementsPage() {
  const [filters, setFilters] = useState<BankTransactionFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = useBankTransactions(filters, page, LIMIT);
  const items = data?.items ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/banking"
          className="text-xs inline-flex items-center gap-1 transition-colors hover:text-sky-500"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={12} /> Voltar à Banca
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/banking/reconciliation">
            <Button variant="ghost" size="sm" leftIcon={<GitCompare size={14} />}>
              Conciliação
            </Button>
          </Link>
          <Link href="/banking/import-wizard">
            <Button variant="primary" size="sm" leftIcon={<Upload size={14} />}>
              Importar Extrato
            </Button>
          </Link>
        </div>
      </div>

      <PageHeader
        title="Extratos e Movimentos Bancários"
        subtitle="Consulte todos os movimentos importados, saldos e estado de conciliação."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Atualizar
          </Button>
        }
      />

      <StatementTable
        data={items}
        loading={isLoading}
        filters={filters}
        onFiltersChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        page={page}
        limit={LIMIT}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
