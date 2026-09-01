'use client';

import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { ContactsList } from '../_components/contacts-list';
import { Button } from '../../../_components/ui';

export default function CrmContactsPage() {
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
        title="Contactos CRM"
        subtitle="Empresas e particulares — vista 360º de clientes e oportunidades."
        actions={
          <Link href="/crm/contacts/new">
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />}>
              Novo Contacto
            </Button>
          </Link>
        }
      />

      <ContactsList />
    </div>
  );
}
