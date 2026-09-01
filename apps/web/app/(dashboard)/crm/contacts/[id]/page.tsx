'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../../_components/page-header';
import { ContactDetail } from '../../_components/contact-detail';

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <Link href="/crm" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar ao CRM
      </Link>
      <PageHeader title="Detalhe do contacto" subtitle="Vista 360º do contacto: pessoas, negócios e histórico." />
      <ContactDetail contactId={params.id} />
    </>
  );
}