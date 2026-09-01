'use client';

/**
 * DocFlow — Document Inbox page.
 *
 * Tabela paginada de documentos com extração IA. Inclui:
 *  - drag-and-drop upload com progresso e aviso de duplicados
 *  - filtros (pesquisa, estado, tipo, intervalo de datas)
 *  - seleção + ações em massa (mover pasta, etiquetar, eliminar)
 *  - estados vazio / loading / erro consistentes com o resto do dashboard
 *
 * O backend é contactado em http://localhost:4000/api/v1/documents (per
 * CONTRACT.md). Se o endpoint ainda não existir, o hook `useDocumentsList`
 * devolve uma lista vazia — a UI degrada com graça.
 */

import { useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import type { RowSelectionState } from '@tanstack/react-table';
import { PageHeader } from '../_components/page-header';
import { UploadZone } from './_components/upload-zone';
import { DocumentFilters } from './_components/document-filters';
import { DocumentTable } from './_components/document-table';
import { BulkActions } from './_components/bulk-actions';
import {
  useDocumentsList,
} from './_components/use-documents';
import type { DocumentFiltersState } from './_components/types';

const PAGE_SIZE = 20;

const INITIAL_FILTERS: DocumentFiltersState = {
  search: '',
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
};

export default function DocumentsPage() {
  const [filters, setFilters] = useState<DocumentFiltersState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const { data, isLoading, isError, refetch, isFetching } = useDocumentsList(
    filters,
    page,
    PAGE_SIZE,
  );

  const items = data?.items ?? [];
  const total = data?.meta?.total ?? 0;

  const selectedIds = Object.entries(selection)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const resetSelection = () => setSelection({});

  return (
    <>
      <PageHeader
        title="Documentos"
        subtitle="Inbox documental com extração IA — faturas, recibos e notas."
        actions={
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Atualizar lista"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Atualizar
          </button>
        }
      />

      <div className="space-y-5">
        <UploadZone />

        <DocumentFilters value={filters} onChange={(next) => {
          setFilters(next);
          setPage(1);
        }} total={total} />

        {isError ? (
          <div
            className="card p-6 flex items-start gap-3"
            role="alert"
            style={{
              background: 'rgba(248,113,113,0.08)',
              borderColor: 'rgba(248,113,113,0.30)',
            }}
          >
            <AlertCircle size={18} style={{ color: 'var(--danger)' }} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--danger-fg)' }}>
                Não foi possível carregar os documentos
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Verifique a sua ligação ou tente novamente.
              </p>
            </div>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => refetch()}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <DocumentTable
            data={items}
            loading={isLoading}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            selection={selection}
            onSelectionChange={setSelection}
            onPageChange={setPage}
          />
        )}
      </div>

      <BulkActions selectedIds={selectedIds} onClear={resetSelection} />
    </>
  );
}
