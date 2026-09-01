'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { AccountsList } from '../_components/accounts-list';

export default function AccountsPage() {
  return (
    <>
      <Link href="/parties" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Plano de contas (PGC PT)" subtitle="Contas para classificação contabilística das entidades." />
      <AccountsList />
    </>
  );
}