'use client';

import Link from 'next/link';
import { ArrowLeft, Landmark, Upload } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { ReconciliationBoard } from '../_components/reconciliation-board';
import { Button } from '../../../_components/ui';

export default function BankingReconciliationPage() {
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
          <Link href="/banking/statements">
            <Button variant="ghost" size="sm" leftIcon={<Landmark size={14} />}>
              Ver Movimentos
            </Button>
          </Link>
          <Link href="/banking/import-wizard">
            <Button variant="secondary" size="sm" leftIcon={<Upload size={14} />}>
              Importar Extrato
            </Button>
          </Link>
        </div>
      </div>

      <PageHeader
        title="Quadro de Conciliação Bancária"
        subtitle="Sugestões automáticas de correspondência entre movimentos de extrato e faturas/despesas."
      />

      <ReconciliationBoard />
    </div>
  );
}
