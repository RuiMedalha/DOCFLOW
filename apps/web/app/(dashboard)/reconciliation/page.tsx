'use client';

import { PageHeader } from '../_components/page-header';
import { ReconciliationBoard } from '../banking/_components/reconciliation-board';

export default function ReconciliationPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Conciliação Bancária & Documental"
        subtitle="Correspondência inteligente entre movimentos bancários e faturas/despesas."
      />
      <ReconciliationBoard />
    </div>
  );
}