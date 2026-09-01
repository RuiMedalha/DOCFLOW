'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { ImportWizard } from '../_components/import-wizard';

export default function ImportWizardPage() {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <Link
        href="/banking"
        className="text-xs inline-flex items-center gap-1 transition-colors hover:text-sky-500"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={12} /> Voltar à Banca
      </Link>

      <PageHeader
        title="Assistente de Importação Bancária"
        subtitle="Importe ficheiros CSV de homebanking ou ficheiros normalizados ISO 20022 CAMT.053."
      />

      <ImportWizard
        onDone={() => {
          router.push('/banking/statements');
        }}
      />
    </div>
  );
}
