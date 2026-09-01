'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  GitCompare,
  Play,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Landmark,
  FileText,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  Badge,
  Button,
  Pagination,
  Skeleton,
  toastBus,
} from '../../../_components/ui';
import { formatCurrency, formatDate } from '../../../_lib/format';
import {
  useReconciliationSuggestions,
  useRunReconciliation,
  useAcceptSuggestion,
  useRejectSuggestion,
} from '../_lib/use-banking-queries';
import type {
  MatchStatus,
  MatchType,
  MatchSuggestion,
  ReconciliationFilters,
} from '../_lib/types';

const LIMIT = 20;

export function ReconciliationBoard({
  initialFilters = { status: 'PENDING' },
}: {
  initialFilters?: ReconciliationFilters;
}) {
  const [filters, setFilters] = useState<ReconciliationFilters>(initialFilters);
  const [page, setPage] = useState(1);

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useReconciliationSuggestions(filters, page, LIMIT);

  const runMutation = useRunReconciliation();
  const acceptMutation = useAcceptSuggestion();
  const rejectMutation = useRejectSuggestion();

  const items = data?.items ?? [];
  const total = data?.meta?.total ?? 0;

  const handleRunMatching = async () => {
    try {
      const res = await runMutation.mutateAsync();
      toastBus.success(
        `Motor concluÃ­do: ${res.suggestionsCreated} sugestÃµes geradas`,
        {
          description: `Forte: ${res.byType.STRONG}, MÃ©dio: ${res.byType.MEDIUM}, Fraco: ${res.byType.WEAK} em ${res.durationMs}ms`,
        },
      );
      void refetch();
    } catch (err) {
      toastBus.error('Falha ao executar motor de conciliaÃ§Ã£o', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleAccept = async (id: string) => {
    try {
      await acceptMutation.mutateAsync(id);
      toastBus.success('CorrespondÃªncia aceite e movimento conciliado');
    } catch (err) {
      toastBus.error('Erro ao aceitar correspondÃªncia', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectMutation.mutateAsync(id);
      toastBus.success('SugestÃ£o rejeitada');
    } catch (err) {
      toastBus.error('Erro ao rejeitar correspondÃªncia', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Banner / Engine Trigger */}
      <div
        className="card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
        style={{
          background: 'linear-gradient(135deg, var(--card) 0%, rgba(56,189,248,0.06) 100%)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-sky-500" />
            <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
              Motor de ReconciliaÃ§Ã£o IA
            </h3>
          </div>
          <p className="text-xs max-w-xl" style={{ color: 'var(--text-muted)' }}>
            Compara automaticamente todos os movimentos bancÃ¡rios nÃ£o conciliados contra
            faturas recebidas, despesas e pagamentos registados com pontuaÃ§Ã£o de 0 a 100%.
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<Play size={15} />}
          loading={runMutation.isPending}
          onClick={handleRunMatching}
        >
          Executar ConciliaÃ§Ã£o
        </Button>
      </div>

      {/* Filter & Controls Bar */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-lg" style={{ background: 'var(--hover)' }}>
            {(['PENDING', 'ACCEPTED', 'REJECTED'] as MatchStatus[]).map((st) => {
              const active = (filters.status ?? 'PENDING') === st;
              const labels: Record<MatchStatus, string> = {
                PENDING: 'Pendentes',
                ACCEPTED: 'Aceites',
                REJECTED: 'Rejeitados',
              };
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setFilters((prev) => ({ ...prev, status: st }));
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    active ? 'shadow-sm' : ''
                  }`}
                  style={{
                    background: active ? 'var(--card)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {labels[st]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {/* Match Tier Filter */}
            <select
              className="select text-xs"
              value={filters.matchType ?? ''}
              onChange={(e) => {
                setFilters((prev) => ({
                  ...prev,
                  matchType: (e.target.value as MatchType) || '',
                }));
                setPage(1);
              }}
              aria-label="Filtrar por grau de confianÃ§a"
            >
              <option value="">Todos os graus (Forte/MÃ©dio/Fraco)</option>
              <option value="STRONG">Apenas Forte (Score &ge; 85%)</option>
              <option value="MEDIUM">Apenas MÃ©dio (60% - 84%)</option>
              <option value="WEAK">Apenas Fraco (&lt; 60%)</option>
            </select>

            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />}
              onClick={() => refetch()}
              disabled={isFetching}
            >
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {/* Suggestions List */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <GitCompare size={36} className="mx-auto" style={{ color: 'var(--text-muted)' }} />
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Nenhuma sugestÃ£o encontrada
          </h4>
          <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-muted)' }}>
            {filters.status === 'PENDING'
              ? 'NÃ£o existem correspondÃªncias pendentes de revisÃ£o. Execute o motor para analisar novos movimentos.'
              : 'NÃ£o existem registos com os filtros selecionados.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((sugg) => (
            <SuggestionCard
              key={sugg.id}
              suggestion={sugg}
              onAccept={handleAccept}
              onReject={handleReject}
              isAccepting={acceptMutation.isPending}
              isRejecting={rejectMutation.isPending}
            />
          ))}
        </div>
      )}

      {total > LIMIT && (
        <Pagination
          page={page}
          pageSize={LIMIT}
          total={total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion: s,
  onAccept,
  onReject,
  isAccepting,
  isRejecting,
}: {
  suggestion: MatchSuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isAccepting: boolean;
  isRejecting: boolean;
}) {
  const isPending = s.status === 'PENDING';
  const tierTone =
    s.matchType === 'STRONG'
      ? 'emerald'
      : s.matchType === 'MEDIUM'
      ? 'amber'
      : 'neutral';

  const txAmount = s.bankTransaction.amount;

  return (
    <div
      className="card p-5 transition-all hover:shadow-sm space-y-4"
      style={{
        borderLeftWidth: '4px',
        borderLeftColor:
          s.matchType === 'STRONG'
            ? 'var(--success)'
            : s.matchType === 'MEDIUM'
            ? 'var(--warning)'
            : 'var(--border-strong)',
      }}
    >
      {/* Card Header: Tier + Score + Dates */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={tierTone}>
            {s.matchType === 'STRONG'
              ? 'Grau Forte'
              : s.matchType === 'MEDIUM'
              ? 'Grau MÃ©dio'
              : 'Grau Fraco'}{' '}
            ({Math.round(s.score * 100)}%)
          </Badge>

          {s.reason && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--hover)', color: 'var(--text-muted)' }}
            >
              {s.reason}
            </span>
          )}
        </div>

        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Detetado em {formatDate(s.createdAt)}
        </span>
      </div>

      {/* Comparison Grid: Bank Tx vs Document/Invoice/Expense */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center rounded-lg p-4" style={{ background: 'var(--hover)' }}>
        {/* Left: Bank Transaction */}
        <div className="md:col-span-5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>
            <Landmark size={14} className="text-sky-500" />
            Movimento BancÃ¡rio
          </div>
          <Link
            href={`/banking/statements/${s.bankTransaction.id}`}
            className="text-sm font-medium hover:text-sky-500 hover:underline block truncate"
          >
            {s.bankTransaction.description}
          </Link>
          <div className="text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
            <span>{formatDate(s.bankTransaction.date)}</span>
            <span className="font-mono font-bold text-sm" style={{ color: txAmount < 0 ? 'var(--danger)' : 'var(--success)' }}>
              {formatCurrency(txAmount)}
            </span>
          </div>
          {s.bankTransaction.counterpartyName && (
            <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              Entidade: {s.bankTransaction.counterpartyName}
            </div>
          )}
        </div>

        {/* Center: Match Arrow */}
        <div className="md:col-span-2 flex flex-col items-center justify-center py-2 md:py-0">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" style={{ background: 'var(--card)' }}>
            <ArrowRight size={16} className="text-sky-500" />
          </div>
        </div>

        {/* Right: Matched Entity */}
        <div className="md:col-span-5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>
            <FileText size={14} className="text-emerald-500" />
            {s.document ? 'Documento / Fatura' : s.invoice ? 'Fatura' : 'Despesa'}
          </div>

          {s.document && (
            <div>
              <Link
                href={`/documents/${s.document.id}`}
                className="text-sm font-medium hover:text-sky-500 hover:underline block truncate"
              >
                {s.document.fileName}
              </Link>
              <div className="text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
                <span>NÂº {s.document.docNumber ?? 'â€”'}</span>
                <span className="font-mono font-bold text-sm" style={{ color: 'var(--text)' }}>
                  {formatCurrency(s.document.total)}
                </span>
              </div>
              {s.document.supplier && (
                <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                  Fornecedor: {s.document.supplier}
                </div>
              )}
            </div>
          )}

          {s.invoice && !s.document && (
            <div>
              <div className="text-sm font-medium">Fatura {s.invoice.number ?? ''}</div>
              <div className="text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
                <span>Cliente: {s.invoice.customer ?? 'â€”'}</span>
                <span className="font-mono font-bold text-sm">{formatCurrency(s.invoice.amount)}</span>
              </div>
            </div>
          )}

          {s.expense && !s.document && !s.invoice && (
            <div>
              <div className="text-sm font-medium">{s.expense.description ?? 'Despesa'}</div>
              <div className="text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
                <span>Fornecedor: {s.expense.supplier ?? 'â€”'}</span>
                <span className="font-mono font-bold text-sm">{formatCurrency(s.expense.amount)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card Actions */}
      {isPending ? (
        <div className="flex items-center justify-end gap-2 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<XCircle size={14} />}
            loading={isRejecting}
            onClick={() => onReject(s.id)}
          >
            Rejeitar SugestÃ£o
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<CheckCircle2 size={14} />}
            loading={isAccepting}
            onClick={() => onAccept(s.id)}
          >
            Aceitar e Conciliar
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between pt-1 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <span>
            Estado: <strong className="uppercase font-semibold">{s.status}</strong>
          </span>
          {s.status === 'ACCEPTED' ? (
            <span className="text-emerald-500 font-medium inline-flex items-center gap-1">
              <CheckCircle2 size={13} /> Movimento e documento vinculados
            </span>
          ) : (
            <span className="text-red-500 font-medium inline-flex items-center gap-1">
              <XCircle size={13} /> SugestÃ£o descartada
            </span>
          )}
        </div>
      )}
    </div>
  );
}


