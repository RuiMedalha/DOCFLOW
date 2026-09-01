'use client';

/**
 * DocFlow â€” Banking (F.5) Hub page.
 *
 * Multi-tab hub:
 *   - "Movimentos": list/filter/export bank transactions
 *   - "Importar": 4-step wizard for CSV homebanking & ISO 20022 CAMT.053
 *   - "ConciliaÃ§Ã£o": AI suggestions board with STRONG/MEDIUM/WEAK tiers & 1-click accept
 *   - "Templates": manage saved CSV column mapping presets
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  Upload,
  ListChecks,
  GitCompare,
  SlidersHorizontal,
  Plus,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import { PageHeader } from '../_components/page-header';
import { Tabs, Button, Skeleton, toastBus } from '@/_components/ui';
import { ImportWizard } from './_components/import-wizard';
import { StatementTable } from './_components/statement-table';
import { ReconciliationBoard } from './_components/reconciliation-board';
import {
  useBankTransactions,
  useCsvTemplates,
  useDeleteTemplate,
  useReconciliationSuggestions,
} from './_lib/use-banking-queries';
import type { BankTransactionFilters } from './_lib/types';
import { formatDate } from '../../_lib/format';

const LIMIT = 25;

const INITIAL_FILTERS: BankTransactionFilters = {
  search: '',
  from: '',
  to: '',
  source: '',
};

export default function BankingPage() {
  const [tab, setTab] = useState('transactions');
  const [filters, setFilters] = useState<BankTransactionFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);

  const { data: txData, isLoading: loadingTx, refetch: refetchTx } = useBankTransactions(
    filters,
    page,
    LIMIT,
  );
  const { data: pendingSuggData } = useReconciliationSuggestions({ status: 'PENDING' }, 1, 1);
  const { data: templates, isLoading: loadingTemplates } = useCsvTemplates();
  const deleteTemplate = useDeleteTemplate();

  const items = txData?.items ?? [];
  const total = txData?.meta?.total ?? 0;
  const pendingSuggestionsCount = pendingSuggData?.meta?.total ?? 0;

  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Tem a certeza que deseja eliminar o template "${name}"?`)) return;
    try {
      await deleteTemplate.mutateAsync(id);
      toastBus.success('Template eliminado');
    } catch (err) {
      toastBus.error('Erro ao eliminar template', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Banca & Extratos"
        subtitle="Importe extratos bancÃ¡rios (CSV / CAMT.053), analise movimentos e efetue conciliaÃ§Ã£o IA."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/banking/import-wizard">
              <Button variant="primary" size="sm" leftIcon={<Upload size={14} />}>
                Novo Extrato
              </Button>
            </Link>
          </div>
        }
      />

      <Tabs
        items={[
          {
            value: 'transactions',
            label: 'Movimentos',
            icon: <ListChecks size={15} />,
            count: total,
          },
          {
            value: 'reconciliation',
            label: 'ConciliaÃ§Ã£o',
            icon: <GitCompare size={15} />,
            count: pendingSuggestionsCount > 0 ? pendingSuggestionsCount : undefined,
          },
          {
            value: 'import',
            label: 'Importar Extrato',
            icon: <Upload size={15} />,
          },
          {
            value: 'templates',
            label: 'Templates CSV',
            icon: <SlidersHorizontal size={15} />,
            count: templates?.length,
          },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === 'transactions' && (
        <StatementTable
          data={items}
          loading={loadingTx}
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
      )}

      {tab === 'reconciliation' && <ReconciliationBoard />}

      {tab === 'import' && (
        <ImportWizard
          onDone={() => {
            setTab('transactions');
            void refetchTx();
          }}
        />
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Templates de Mapeamento de Colunas CSV
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Guarde configuraÃ§Ãµes de colunas por banco para acelerar importaÃ§Ãµes futuras.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setTab('import')}
            >
              Criar Novo no Assistente
            </Button>
          </div>

          {loadingTemplates ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="card p-8 text-center text-xs space-y-2" style={{ color: 'var(--text-muted)' }}>
              <FileSpreadsheet size={24} className="mx-auto" />
              <p>Nenhum template personalizado guardado ainda.</p>
              <p className="text-[11px]">
                Ao importar um CSV pelo assistente, marque a opÃ§Ã£o &ldquo;Guardar como template&rdquo;.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="card p-4 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      {tpl.name}
                    </h4>
                    <div className="text-xs flex flex-wrap gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span>Data: <strong>{tpl.dateFormat}</strong></span>
                      <span>Separador: <strong>&ldquo;{tpl.decimalSep}&rdquo;</strong></span>
                    </div>
                    <div className="text-[11px] pt-1" style={{ color: 'var(--text-subtle)' }}>
                      Criado em {formatDate(tpl.createdAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="p-1.5 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Eliminar template"
                    onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

