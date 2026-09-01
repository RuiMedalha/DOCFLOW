'use client';

/**
 * DocFlow â€” Payments (F.7) Hub page.
 *
 * Full production dashboard for payables and payment schedules:
 *   - Payables table (filtering, inline approval, mark-paid, multi-select)
 *   - Scheduled payments & Calendar view (recurring expansion)
 *   - ISO 20022 SEPA pain.001 XML & Homebanking CSV export
 *   - Manual payable creation & schedule modal
 */

import { useState } from 'react';
import {
  Wallet,
  CalendarClock,
  FileDown,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../_components/page-header';
import {
  Tabs,
  Button,
  Dialog,
  Input,
  toastBus,
} from '@/_components/ui';
import { PayablesTable } from './_components/payables-table';
import { ScheduleTable } from './_components/schedule-table';
import { SepaExportModal } from './_components/sepa-export-modal';
import {
  usePayables,
  usePaymentSchedules,
  useCreateManualPayable,
  useCreatePaymentSchedule,
} from './_lib/use-payments-queries';
import type {
  PayableFilters,
  RecurrenceType,
} from './_lib/types';
import { formatCurrency } from '@/_lib/format';

const LIMIT = 25;

export default function PaymentsPage() {
  const [tab, setTab] = useState('payables');
  const [filters, setFilters] = useState<PayableFilters>({});
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sepaModalOpen, setSepaModalOpen] = useState(false);

  // Creation modals state
  const [createPayableOpen, setCreatePayableOpen] = useState(false);
  const [payableForm, setPayableForm] = useState({
    description: '',
    amount: '',
    dueDate: '',
    notes: '',
  });

  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    description: '',
    amount: '',
    dueDate: '',
    category: '',
    recurring: false,
    recurrenceType: 'MONTHLY' as RecurrenceType,
    recurrenceInterval: 1,
  });

  // Queries
  const {
    data: payablesData,
    isLoading: loadingPayables,
    isFetching: fetchingPayables,
    refetch: refetchPayables,
  } = usePayables(filters, page, LIMIT);

  const {
    data: schedulesData,
    isLoading: loadingSchedules,
    isFetching: fetchingSchedules,
    refetch: refetchSchedules,
  } = usePaymentSchedules(1, 100);

  // Mutations
  const createPayable = useCreateManualPayable();
  const createSchedule = useCreatePaymentSchedule();

  const payables = payablesData?.items ?? [];
  const totalPayables = payablesData?.meta?.total ?? 0;
  const schedules = schedulesData?.items ?? [];

  // Summary Metrics calculation
  const totalToPay = payables
    .filter((p) => p.status === 'TO_PAY' || p.status === 'OVERDUE')
    .reduce((acc, p) => acc + p.amount, 0);

  const totalOverdue = payables
    .filter((p) => p.status === 'OVERDUE')
    .reduce((acc, p) => acc + p.amount, 0);

  const totalApproved = payables
    .filter((p) => p.approved || p.approvedAt)
    .reduce((acc, p) => acc + p.amount, 0);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleCreatePayable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payableForm.description || !payableForm.amount) return;
    try {
      await createPayable.mutateAsync({
        description: payableForm.description,
        amount: Number(payableForm.amount),
        dueDate: payableForm.dueDate || undefined,
        notes: payableForm.notes || undefined,
      });
      toastBus.success('Conta a pagar criada com sucesso');
      setCreatePayableOpen(false);
      setPayableForm({ description: '', amount: '', dueDate: '', notes: '' });
    } catch (err) {
      toastBus.error('Erro ao criar conta a pagar', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.title || !scheduleForm.amount || !scheduleForm.dueDate) return;
    try {
      await createSchedule.mutateAsync({
        title: scheduleForm.title,
        description: scheduleForm.description || undefined,
        amount: Number(scheduleForm.amount),
        dueDate: scheduleForm.dueDate,
        category: scheduleForm.category || undefined,
        recurring: scheduleForm.recurring,
        recurrenceType: scheduleForm.recurring ? scheduleForm.recurrenceType : undefined,
        recurrenceInterval: scheduleForm.recurring ? scheduleForm.recurrenceInterval : undefined,
      });
      toastBus.success('Pagamento agendado criado');
      setCreateScheduleOpen(false);
      setScheduleForm({
        title: '',
        description: '',
        amount: '',
        dueDate: '',
        category: '',
        recurring: false,
        recurrenceType: 'MONTHLY',
        recurrenceInterval: 1,
      });
    } catch (err) {
      toastBus.error('Erro ao criar agendamento', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <>
      <PageHeader
        title="GestÃ£o de Pagamentos & SEPA"
        subtitle="Contas a pagar, aprovaÃ§Ã£o de despesas, agendamentos e emissÃ£o de ficheiros SEPA ISO 20022."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FileDown size={14} />}
              onClick={() => setSepaModalOpen(true)}
            >
              ExportaÃ§Ã£o SEPA
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setCreatePayableOpen(true)}
            >
              Nova Conta a Pagar
            </Button>
          </div>
        }
      />

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
              Total a Pagar
            </span>
            <Wallet size={16} className="text-amber-500" />
          </div>
          <div className="text-xl font-bold font-mono" style={{ color: 'var(--text)' }}>
            {formatCurrency(totalToPay)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {payables.filter((p) => p.status === 'TO_PAY').length} pendentes
          </div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
              Vencidos
            </span>
            <AlertTriangle size={16} className="text-red-500" />
          </div>
          <div className="text-xl font-bold font-mono text-red-500">
            {formatCurrency(totalOverdue)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {payables.filter((p) => p.status === 'OVERDUE').length} fora do prazo
          </div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
              Aprovados para Pagamento
            </span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-500">
            {formatCurrency(totalApproved)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Prontos para lote SEPA
          </div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
              Agendados
            </span>
            <CalendarClock size={16} className="text-sky-500" />
          </div>
          <div className="text-xl font-bold font-mono text-sky-500">
            {schedules.length}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Recorrentes e pontuais
          </div>
        </div>
      </div>

      <Tabs
        items={[
          {
            value: 'payables',
            label: 'Contas a Pagar',
            icon: <Wallet size={15} />,
            count: totalPayables,
          },
          {
            value: 'schedules',
            label: 'Agenda & RecorrÃªncias',
            icon: <CalendarClock size={15} />,
            count: schedules.length,
          },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === 'payables' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant={filters.status === undefined ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setFilters({});
                  setPage(1);
                }}
              >
                Todos
              </Button>
              <Button
                variant={filters.status === 'TO_PAY' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setFilters({ status: 'TO_PAY' });
                  setPage(1);
                }}
              >
                A Pagar
              </Button>
              <Button
                variant={filters.status === 'OVERDUE' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setFilters({ status: 'OVERDUE' });
                  setPage(1);
                }}
              >
                Vencidos
              </Button>
              <Button
                variant={filters.status === 'PAID' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setFilters({ status: 'PAID' });
                  setPage(1);
                }}
              >
                Pagos
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FileDown size={14} />}
                  onClick={() => setSepaModalOpen(true)}
                >
                  Exportar {selectedIds.length} SEPA
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw size={13} className={fetchingPayables ? 'animate-spin' : ''} />}
                onClick={() => refetchPayables()}
                disabled={fetchingPayables}
              >
                Atualizar
              </Button>
            </div>
          </div>

          <PayablesTable
            data={payables}
            loading={loadingPayables}
            page={page}
            limit={LIMIT}
            total={totalPayables}
            onPageChange={setPage}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        </div>
      )}

      {tab === 'schedules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Pagamentos Agendados e Recorrentes
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Rendas, avenÃ§as, salÃ¡rios e impostos com projeÃ§Ã£o automÃ¡tica no calendÃ¡rio.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => setCreateScheduleOpen(true)}
              >
                Novo Agendamento
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw size={13} className={fetchingSchedules ? 'animate-spin' : ''} />}
                onClick={() => refetchSchedules()}
                disabled={fetchingSchedules}
              >
                Atualizar
              </Button>
            </div>
          </div>

          <ScheduleTable data={schedules} loading={loadingSchedules} />
        </div>
      )}

      {/* SEPA Export Modal */}
      <SepaExportModal
        open={sepaModalOpen}
        onClose={() => setSepaModalOpen(false)}
        payableIds={selectedIds}
      />

      {/* Create Manual Payable Dialog */}
      <Dialog
        open={createPayableOpen}
        onClose={() => setCreatePayableOpen(false)}
        title="Registar Nova Conta a Pagar"
        description="Introduza manualmente um valor a pagar a fornecedor ou prestador."
      >
        <form onSubmit={handleCreatePayable} className="space-y-4">
          <Input
            label="DescriÃ§Ã£o *"
            placeholder="ex.: Renda escritÃ³rio / LicenÃ§a Software"
            required
            value={payableForm.description}
            onChange={(v: string) => setPayableForm({ ...payableForm, description: v })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Montante (â‚¬) *"
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={payableForm.amount}
              onChange={(v: string) => setPayableForm({ ...payableForm, amount: v })}
            />
            <Input
              label="Data de Vencimento"
              type="date"
              value={payableForm.dueDate}
              onChange={(v: string) => setPayableForm({ ...payableForm, dueDate: v })}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Notas (opcional)
            </label>
            <textarea
              className="textarea w-full mt-1"
              rows={3}
              value={payableForm.notes}
              onChange={(e) => setPayableForm({ ...payableForm, notes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <Button variant="ghost" onClick={() => setCreatePayableOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" loading={createPayable.isPending}>
              Guardar Conta a Pagar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Create Schedule Dialog */}
      <Dialog
        open={createScheduleOpen}
        onClose={() => setCreateScheduleOpen(false)}
        title="Novo Pagamento Agendado"
        description="Agende uma saÃ­da de tesouraria pontual ou recorrente."
      >
        <form onSubmit={handleCreateSchedule} className="space-y-4">
          <Input
            label="TÃ­tulo *"
            placeholder="ex.: E-Redes Eletricidade / Renda"
            required
            value={scheduleForm.title}
            onChange={(v: string) => setScheduleForm({ ...scheduleForm, title: v })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Montante (â‚¬) *"
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={scheduleForm.amount}
              onChange={(v: string) => setScheduleForm({ ...scheduleForm, amount: v })}
            />
            <Input
              label="Data de Vencimento *"
              type="date"
              required
              value={scheduleForm.dueDate}
              onChange={(v: string) => setScheduleForm({ ...scheduleForm, dueDate: v })}
            />
          </div>

          <Input
            label="Categoria (opcional)"
            placeholder="ex.: Utilidades / Rendas / Pessoal"
            value={scheduleForm.category}
            onChange={(v: string) => setScheduleForm({ ...scheduleForm, category: v })}
          />

          <div className="p-3 rounded-lg border space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--hover)' }}>
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleForm.recurring}
                onChange={(e) => setScheduleForm({ ...scheduleForm, recurring: e.target.checked })}
              />
              Pagamento Recorrente
            </label>

            {scheduleForm.recurring && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>FrequÃªncia</label>
                  <select
                    className="select mt-1 w-full text-xs"
                    value={scheduleForm.recurrenceType}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, recurrenceType: e.target.value as RecurrenceType })}
                  >
                    <option value="MONTHLY">Mensal</option>
                    <option value="QUARTERLY">Trimestral</option>
                    <option value="YEARLY">Anual</option>
                    <option value="WEEKLY">Semanal</option>
                  </select>
                </div>
                <Input
                  label="Intervalo"
                  type="number"
                  min="1"
                  value={String(scheduleForm.recurrenceInterval)}
                  onChange={(v: string) => setScheduleForm({ ...scheduleForm, recurrenceInterval: Number(v) || 1 })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <Button variant="ghost" onClick={() => setCreateScheduleOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" loading={createSchedule.isPending}>
              Criar Agendamento
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

