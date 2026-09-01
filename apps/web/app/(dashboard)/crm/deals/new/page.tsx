'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../../_components/page-header';
import { DealForm } from '../../_components/deal-form';

export default function NewDealPage() {
  return (
    <>
      <Link href="/crm?tab=deals" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Novo negócio" subtitle="Crie uma oportunidade e atribua-a a um contacto." />
      <DealForm />
    </>
  );
}