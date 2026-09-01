'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, GitBranch, Trash2 } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { Button, Badge, Skeleton, toastBus } from '../../../_components/ui';
import {
  usePipelines,
  useCreatePipeline,
  useDeletePipeline,
  useDealStats,
} from '../_lib/use-crm-queries';
import { formatCurrency } from '../../../_lib/format';
import type { Pipeline } from '../_lib/types';

export default function CrmPipelinesPage() {
  const { data: pipelines, isLoading, refetch } = usePipelines();
  const { data: stats } = useDealStats();
  const createMutation = useCreatePipeline();
  const deleteMutation = useDeletePipeline();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createMutation.mutateAsync({
        name,
        isDefault,
        stages: [
          { id: 'LEAD', name: 'Lead', probability: 20 },
          { id: 'QUALIFIED', name: 'Qualificado', probability: 40 },
          { id: 'PROPOSAL', name: 'Proposta', probability: 60 },
          { id: 'NEGOTIATION', name: 'NegociaÃ§Ã£o', probability: 80 },
          { id: 'WON', name: 'Ganho', probability: 100 },
          { id: 'LOST', name: 'Perdido', probability: 0 },
        ],
      });
      toastBus.success('Pipeline criado com sucesso');
      setName('');
      setShowCreate(false);
      void refetch();
    } catch (err) {
      toastBus.error('Erro ao criar pipeline', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleDelete = async (id: string, pName: string) => {
    if (!confirm(`Tem a certeza que deseja eliminar o pipeline "${pName}"?`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      toastBus.success('Pipeline eliminado');
      void refetch();
    } catch (err) {
      toastBus.error('Erro ao eliminar pipeline', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-5">
      <Link
        href="/crm"
        className="text-xs inline-flex items-center gap-1 transition-colors hover:text-sky-500"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={12} /> Voltar ao CRM
      </Link>

      <PageHeader
        title="GestÃ£o de Pipelines"
        subtitle="Configure fluxos de vendas e etapas de qualificaÃ§Ã£o de oportunidades."
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => setShowCreate(true)}
          >
            Novo Pipeline
          </Button>
        }
      />

      {/* Stats Tile */}
      {stats && (
        <div className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Valor em Aberto</div>
            <div className="text-lg font-bold font-mono mt-1" style={{ color: 'var(--text)' }}>
              {formatCurrency(stats.totalValue)}
            </div>
          </div>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Valor Ponderado</div>
            <div className="text-lg font-bold font-mono text-sky-500 mt-1">
              {formatCurrency(stats.weightedTotal)}
            </div>
          </div>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Ganhos Fechados</div>
            <div className="text-lg font-bold font-mono text-emerald-500 mt-1">
              {formatCurrency(stats.wonValue)}
            </div>
          </div>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Perdas</div>
            <div className="text-lg font-bold font-mono text-red-500 mt-1">
              {formatCurrency(stats.lostValue)}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal / Card */}
      {showCreate && (
        <form onSubmit={handleCreate} className="card p-5 space-y-4 max-w-xl animate-in">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Criar Novo Pipeline de Vendas
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Nome do Pipeline *
              </label>
              <input
                type="text"
                className="input mt-1 w-full"
                placeholder="ex.: Vendas Enterprise / ServiÃ§os Contabilidade"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Definir como pipeline predefinido
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              type="submit"
            >
              Criar Pipeline
            </Button>
          </div>
        </form>
      )}

      {/* Pipelines List */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : !pipelines || pipelines.length === 0 ? (
        <div className="card p-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          <GitBranch size={28} className="mx-auto mb-2" />
          Nenhum pipeline configurado.
        </div>
      ) : (
        <div className="space-y-4">
          {pipelines.map((p: Pipeline) => (
            <div key={p.id} className="card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
                    {p.name}
                  </h3>
                  {p.isDefault && <Badge tone="sky">Predefinido</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Array.isArray(p.stages) &&
                    p.stages.map((st: { name?: string; id?: string } | string, idx: number) => {
                      const stageLabel = typeof st === 'string' ? st : st.name ?? st.id;
                      return (
                        <span
                          key={idx}
                          className="text-[11px] px-2 py-0.5 rounded font-medium"
                          style={{ background: 'var(--hover)', color: 'var(--text)' }}
                        >
                          {stageLabel}
                        </span>
                      );
                    })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link href={`/crm/deals?pipelineId=${p.id}`}>
                  <Button variant="secondary" size="sm">
                    Ver Oportunidades
                  </Button>
                </Link>
                {!p.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={deleteMutation.isPending}
                    onClick={() => handleDelete(p.id, p.name)}
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

