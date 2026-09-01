'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { IntegrationsPanel } from '../_components/integrations-panel';

export default function IntegrationsPage() {
  return (
    <>
      <Link href="/settings" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Integrações" subtitle="Configure gateways de pagamento, e-commerce e faturação PT." />
      <IntegrationsPanel />
    </>
  );
}