'use client';

import { PageHeader } from '../../../_components/page-header';
import { ContactForm } from '../../_components/contact-form';

export default function NewContactPage() {
  return (
    <>
      <PageHeader title="Novo contacto" subtitle="Adicione uma empresa ou pessoa ao CRM." />
      <ContactForm />
    </>
  );
}