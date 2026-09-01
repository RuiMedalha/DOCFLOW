'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { PartyForm } from '../_components/party-form';

export default function NewPartyPage() {
  return (
    <>
      <Link href="/parties" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Nova entidade" subtitle="Adicione fornecedor, cliente ou ambos." />
      <PartyForm />
    </>
  );
}