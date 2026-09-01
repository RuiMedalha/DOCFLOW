'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Landmark,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import { PageHeader } from '../../../_components/page-header';
import { Badge, Button, Skeleton } from '../../../../_components/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../../../_lib/format';
import {
  useBankTransaction,
  useReconciliationSuggestions,
  useAcceptSuggestion,
  useRejectSuggestion,
} from '../../_lib/use-banking-queries';
import { toastBus } from '../../../../_components/ui';

export default function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const transactionId = resolvedParams.id;

  const { data: tx, isLoading, isError, refetch } = useBankTransaction(transactionId);
  const { data: suggestionsData, isLoading: loadingSuggestions } = useReconciliationSuggestions({
    statementId: transactionId,
  });

  const acceptMutation = useAcceptSuggestion();
  const rejectMutation = useRejectSuggestion();

  const handleAccept = async (suggId: string) => {
    try {
      await acceptMutation.mutateAsync(suggId);
      toastBus.success('Movimento conciliado com sucesso!');
      void refetch();
    } catch (err) {
      toastBus.error('Erro ao aceitar correspondÃªncia', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleReject = async (suggId: string) => {
    try {
      await rejectMutation.mutateAsync(suggId);
      toastBus.success('SugestÃ£o rejeitada');
      void refetch();
    } catch (err) {
      toastBus.error('Erro ao rejeitar correspondÃªncia', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <div className="grid md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !tx) {
    return (
      <div className="space-y-4">
        <Link
          href="/banking/statements"
          className="text-xs inline-flex items-center gap-1 hover:text-sky-500"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={12} /> Voltar aos movimentos
        </Link>
        <div
          className="card p-6 flex items-start gap-3"
          style={{
            background: 'rgba(248,113,113,0.08)',
            borderColor: 'rgba(248,113,113,0.30)',
          }}
        >
          <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-red-500">
              Movimento bancÃ¡rio nÃ£o encontrado
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              O registo pode ter sido removido ou o identificador Ã© invÃ¡lido.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isCredit = tx.amount >= 0;
  const isReconciled = Boolean(tx.reconciledAt || tx.reconciled);
  const suggestions = suggestionsData?.items ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/banking/statements"
        className="text-xs inline-flex items-center gap-1 transition-colors hover:text-sky-500"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={12} /> Voltar aos movimentos
      </Link>

      <PageHeader
        title={tx.description}
        subtitle={`Movimento de ${formatDate(tx.date)} (${tx.source})`}
        actions={
          <div className="flex items-center gap-2">
            {isReconciled ? (
              <Badge tone="emerald">Conciliado</Badge>
            ) : (
              <Badge tone="amber">Pendente de ConciliaÃ§Ã£o</Badge>
            )}
          </div>
        }
      />

      {/* Main Stats Card */}
      <div className="card p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
            Montante
          </span>
          <div
            className="text-2xl font-bold font-mono flex items-center gap-1.5"
            style={{ color: isCredit ? 'var(--success)' : 'var(--danger)' }}
          >
            {isCredit ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
            {formatCurrency(tx.amount)}
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
            Saldo apÃ³s Movimento
          </span>
          <div className="text-2xl font-bold font-mono" style={{ color: 'var(--text)' }}>
            {formatCurrency(tx.balance)}
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
            Data do Movimento
          </span>
          <div className="text-lg font-medium" style={{ color: 'var(--text)' }}>
            {formatDate(tx.date)}
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
            Origem / Batch
          </span>
          <div className="text-sm font-mono truncate" style={{ color: 'var(--text-muted)' }}>
            {tx.source} Â· {tx.importBatch ?? 'â€”'}
          </div>
        </div>
      </div>

      {/* Two Column details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Metadata */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Landmark size={16} className="text-sky-500" />
            Detalhes do Movimento
          </h3>

          <dl className="divide-y text-xs" style={{ borderColor: 'var(--border)' }}>
            <div className="py-2.5 flex justify-between">
              <dt style={{ color: 'var(--text-muted)' }}>Contraparte</dt>
              <dd className="font-medium">{tx.counterpartyName || 'â€”'}</dd>
            </div>
            {tx.counterpartyIban && (
              <div className="py-2.5 flex justify-between">
                <dt style={{ color: 'var(--text-muted)' }}>IBAN Contraparte</dt>
                <dd className="font-mono font-medium">{tx.counterpartyIban}</dd>
              </div>
            )}
            <div className="py-2.5 flex justify-between">
              <dt style={{ color: 'var(--text-muted)' }}>ReferÃªncia</dt>
              <dd className="font-mono">{tx.reference || 'â€”'}</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt style={{ color: 'var(--text-muted)' }}>ID do Movimento</dt>
              <dd className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{tx.id}</dd>
            </div>
            {tx.importHash && (
              <div className="py-2.5 flex justify-between">
                <dt style={{ color: 'var(--text-muted)' }}>Hash Anti-DuplicaÃ§Ã£o</dt>
                <dd className="font-mono text-[10px] truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                  {tx.importHash}
                </dd>
              </div>
            )}
            <div className="py-2.5 flex justify-between">
              <dt style={{ color: 'var(--text-muted)' }}>Importado em</dt>
              <dd>{formatDateTime(tx.createdAt)}</dd>
            </div>
            {tx.reconciledAt && (
              <div className="py-2.5 flex justify-between">
                <dt style={{ color: 'var(--text-muted)' }}>Conciliado em</dt>
                <dd className="text-emerald-500 font-medium">{formatDateTime(tx.reconciledAt)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Reconciliation Status & Matches */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <FileText size={16} className="text-emerald-500" />
            CorrespondÃªncia & ConciliaÃ§Ã£o
          </h3>

          {isReconciled ? (
            <div className="rounded-lg p-4 space-y-2" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div className="flex items-center gap-2 text-emerald-500 font-medium text-sm">
                <CheckCircle2 size={16} />
                Este movimento estÃ¡ conciliado
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                O movimento foi associado a um documento / despesa / fatura do sistema.
              </p>
              {tx.expenseId && (
                <div className="text-xs pt-1">
                  Despesa associada: <span className="font-mono">{tx.expenseId}</span>
                </div>
              )}
              {tx.invoiceId && (
                <div className="text-xs pt-1">
                  Fatura associada: <span className="font-mono">{tx.invoiceId}</span>
                </div>
              )}
              {tx.payableItemId && (
                <div className="text-xs pt-1">
                  Item a pagar associado: <span className="font-mono">{tx.payableItemId}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                SugestÃµes geradas pelo motor de reconciliaÃ§Ã£o para este movimento:
              </p>

              {loadingSuggestions ? (
                <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  A carregar sugestÃµesâ€¦
                </div>
              ) : suggestions.length === 0 ? (
                <div className="p-6 text-center text-xs rounded-lg border border-dashed" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  NÃ£o existem sugestÃµes pendentes para este movimento.
                  <div className="mt-3">
                    <Link href="/banking/reconciliation">
                      <Button variant="secondary" size="sm">
                        Abrir Painel de ConciliaÃ§Ã£o
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {suggestions.map((sugg) => (
                    <div
                      key={sugg.id}
                      className="p-3 rounded-lg border text-xs space-y-2 transition-all hover:shadow-sm"
                      style={{ borderColor: 'var(--border)', background: 'var(--hover)' }}
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          tone={
                            sugg.matchType === 'STRONG'
                              ? 'emerald'
                              : sugg.matchType === 'MEDIUM'
                              ? 'amber'
                              : 'neutral'
                          }
                        >
                          {sugg.matchType} ({Math.round(sugg.score * 100)}%)
                        </Badge>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {formatDate(sugg.createdAt)}
                        </span>
                      </div>

                      {sugg.document && (
                        <div className="font-medium text-sm">
                          Documento: {sugg.document.fileName}
                          {sugg.document.total != null && (
                            <span className="font-mono ml-2 font-bold">
                              {formatCurrency(sugg.document.total)}
                            </span>
                          )}
                        </div>
                      )}
                      {sugg.invoice && (
                        <div className="font-medium text-sm">
                          Fatura {sugg.invoice.number ?? ''} ({formatCurrency(sugg.invoice.amount)})
                        </div>
                      )}
                      {sugg.expense && (
                        <div className="font-medium text-sm">
                          Despesa: {sugg.expense.description ?? ''} ({formatCurrency(sugg.expense.amount)})
                        </div>
                      )}

                      {sugg.reason && (
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {sugg.reason}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={rejectMutation.isPending}
                          onClick={() => handleReject(sugg.id)}
                        >
                          Rejeitar
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={acceptMutation.isPending}
                          onClick={() => handleAccept(sugg.id)}
                        >
                          Aceitar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

