'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { BlacklistPanel } from '../_components/blacklist-panel';

export default function BlacklistPage() {
  return (
    <>
      <Link href="/parties" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Lista negra de IBANs" subtitle="IBANs sinalizados como fraudulentos neste tenant." />
      <BlacklistPanel />
    </>
  );
}