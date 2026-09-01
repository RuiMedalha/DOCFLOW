'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { ActivitiesList } from '../_components/activities-list';

export default function CrmActivitiesPage() {
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
        title="Registo de Atividades & Tarefas"
        subtitle="Chamadas, reuniões, emails e follow-ups associados a contactos e negócios."
      />

      <ActivitiesList />
    </div>
  );
}
