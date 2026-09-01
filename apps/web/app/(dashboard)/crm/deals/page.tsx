'use client';

import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { DealsBoard } from '../_components/deals-board';
import { Button } from '../../../_components/ui';

export default function CrmDealsPage() {
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
        title="Pipeline de Oportunidades"
        subtitle="Quadro Kanban de negócios — mova oportunidades entre etapas e consulte projeções."
        actions={
          <Link href="/crm/deals/new">
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />}>
              Novo Negócio
            </Button>
          </Link>
        }
      />

      <DealsBoard />
    </div>
  );
}
