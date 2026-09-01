'use client';

/**
 * DocFlow â€” SepaExportModal (F.7).
 *
 * Confirms a SEPA batch for the selected (or all approved) payables.
 * Generates ISO 20022 pain.001.001.03 XML or homebanking CSV.
 */

import { useState } from 'react';
import { FileDown, Download } from 'lucide-react';
import { Dialog, Button, Input, toastBus } from '../../../_components/ui';
import { useExportSepaXml, useExportSepaCsv } from '../_lib/use-payments-queries';

export function SepaExportModal({
  open,
  onClose,
  payableIds,
}: {
  open: boolean;
  onClose: () => void;
  payableIds: string[];
}) {
  const [execDate, setExecDate] = useState('');
  const [debtorIban, setDebtorIban] = useState('PT50000000000000000000000');
  const [debtorName, setDebtorName] = useState('DocFlow Enterprise');
  const exportXml = useExportSepaXml();
  const exportCsv = useExportSepaCsv();

  const scope = payableIds.length > 0 ? `${payableIds.length} selecionados` : 'todos os aprovados';

  const runXml = async () => {
    try {
      await exportXml.mutateAsync({
        payableIds,
        debtorIban,
        debtorName,
        executionDate: execDate || undefined,
      });
      toastBus.success('Ficheiro SEPA XML gerado e transferido');
      onClose();
    } catch (err) {
      toastBus.error('A exportaÃ§Ã£o SEPA falhou', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const runCsv = async () => {
    try {
      await exportCsv.mutateAsync({
        payableIds,
        debtorIban,
        debtorName,
        executionDate: execDate || undefined,
      });
      toastBus.success('Ficheiro SEPA CSV gerado e transferido');
      onClose();
    } catch (err) {
      toastBus.error('A exportaÃ§Ã£o CSV falhou', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const close = () => {
    setExecDate('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      title="ExportaÃ§Ã£o SEPA"
      description={`Gerar ficheiro de transferÃªncias (pain.001) para ${scope}.`}
    >
      <div className="space-y-4">
        <Input
          label="IBAN Ordenante (DÃ©bito)"
          placeholder="PT50..."
          value={debtorIban}
          onChange={setDebtorIban}
          required
        />
        <Input
          label="Nome do Ordenante"
          placeholder="Nome da sua empresa"
          value={debtorName}
          onChange={setDebtorName}
          required
        />
        <Input
          label="Data de execuÃ§Ã£o (opcional)"
          type="date"
          value={execDate}
          onChange={setExecDate}
          description="Se vazio, Ã© usada a data de vencimento mais prÃ³xima + 2 dias Ãºteis."
        />

        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            leftIcon={<FileDown size={15} />}
            loading={exportCsv.isPending}
            onClick={runCsv}
          >
            Exportar CSV
          </Button>
          <Button
            variant="primary"
            leftIcon={<Download size={15} />}
            loading={exportXml.isPending}
            onClick={runXml}
          >
            Gerar SEPA XML
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

