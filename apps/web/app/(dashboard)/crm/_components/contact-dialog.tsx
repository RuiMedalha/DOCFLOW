'use client';

/**
 * DocFlow — ContactDialog (F.6): create / edit a CRM contact.
 *
 * Controlled dialog; `contact` null = create mode. Validates the required
 * name and (optionally) a 9-digit NIF client-side before submitting. On
 * success the parent list refetches via the mutation's cache invalidation.
 */

import { useEffect, useState } from 'react';
import { Dialog, Input, Select, Button, toastBus } from '../../../_components/ui';
import type { ContactInput, CrmContact } from '../_lib/types';
import { useCreateContact, useUpdateContact } from '../_lib/use-crm-queries';

const TYPE_OPTIONS = [
  { value: 'COMPANY', label: 'Empresa' },
  { value: 'INDIVIDUAL', label: 'Particular' },
];

const EMPTY: ContactInput = {
  type: 'COMPANY',
  name: '',
  nif: '',
  email: '',
  phone: '',
  city: '',
};

export function ContactDialog({
  open,
  contact,
  onClose,
}: {
  open: boolean;
  contact: CrmContact | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ContactInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateContact();
  const update = useUpdateContact();
  const isEdit = Boolean(contact);

  useEffect(() => {
    if (contact) {
      setForm({
        type: contact.type,
        name: contact.name,
        nif: contact.nif ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        city: contact.city ?? '',
      });
    } else {
      setForm(EMPTY);
    }
    setErrors({});
  }, [contact, open]);

  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Nome obrigatório';
    if (form.nif && !/^\d{9}$/.test(form.nif)) next.nif = 'NIF deve ter 9 dígitos';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Email inválido';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    const payload: ContactInput = {
      ...form,
      nif: form.nif || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      city: form.city || undefined,
    };
    try {
      if (isEdit && contact) {
        await update.mutateAsync({ id: contact.id, ...payload });
        toastBus.success('Contacto atualizado');
      } else {
        await create.mutateAsync(payload);
        toastBus.success('Contacto criado');
      }
      onClose();
    } catch (err) {
      toastBus.error('Não foi possível guardar', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Editar contacto' : 'Novo contacto'}
      description="Dados do cliente ou fornecedor. O NIF é validado (mod-11) no servidor."
    >
      <div className="space-y-1">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Tipo"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(v) => set('type', v as ContactInput['type'])}
          />
          <Input
            label="Nome"
            required
            value={form.name}
            onChange={(v) => set('name', v)}
            error={errors.name}
          />
          <Input
            label="NIF"
            value={form.nif ?? ''}
            onChange={(v) => set('nif', v)}
            error={errors.nif}
            inputMode="numeric"
          />
          <Input
            label="Email"
            type="email"
            value={form.email ?? ''}
            onChange={(v) => set('email', v)}
            error={errors.email}
          />
          <Input label="Telefone" value={form.phone ?? ''} onChange={(v) => set('phone', v)} />
          <Input label="Cidade" value={form.city ?? ''} onChange={(v) => set('city', v)} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Guardar' : 'Criar'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
