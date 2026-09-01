'use client';

/**
 * DocFlow — Contact form (create + edit).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Loader2 } from 'lucide-react';
import { useCreateContact, useUpdateContact, type ContactInput } from './use-crm';

export function ContactForm({ initial, contactId }: { initial?: ContactInput; contactId?: string }) {
  const router = useRouter();
  const create = useCreateContact();
  const update = useUpdateContact();
  const [form, setForm] = useState<ContactInput>(
    initial ?? {
      type: 'COMPANY',
      name: '',
      nif: '',
      email: '',
      phone: '',
      mobile: '',
      address: '',
      city: '',
      postalCode: '',
      country: 'Portugal',
      website: '',
      notes: '',
    },
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setError(null); }, [form]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const cleaned: ContactInput = {
        ...form,
        nif: form.nif?.trim() || undefined,
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        mobile: form.mobile?.trim() || undefined,
        address: form.address?.trim() || undefined,
        city: form.city?.trim() || undefined,
        postalCode: form.postalCode?.trim() || undefined,
        country: form.country?.trim() || undefined,
        website: form.website?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      };
      if (contactId) {
        const res = await update.mutateAsync({ id: contactId, ...cleaned });
        router.push(`/crm/contacts/${res.id}`);
      } else {
        const res = await create.mutateAsync(cleaned);
        router.push(`/crm/contacts/${res.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const submitting = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'COMPANY' | 'INDIVIDUAL' })}>
            <option value="COMPANY">Empresa</option>
            <option value="INDIVIDUAL">Individual</option>
          </select>
        </Field>
        <Field label="Nome *">
          <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="NIF (9 dígitos)">
          <input className="input font-mono" maxLength={9} value={form.nif ?? ''} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Telefone">
          <input className="input" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Telemóvel">
          <input className="input" value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
        </Field>
        <Field label="Morada" full>
          <input className="input" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Código postal">
          <input className="input" value={form.postalCode ?? ''} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </Field>
        <Field label="Cidade">
          <input className="input" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="País">
          <input className="input" value={form.country ?? 'Portugal'} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </Field>
        <Field label="Website">
          <input type="url" className="input" value={form.website ?? ''} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </Field>
        <Field label="Notas" full>
          <textarea className="textarea w-full" rows={4} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>

      {error && (
        <div className="rounded-md p-3 text-xs" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.30)', color: 'var(--danger-fg)' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => router.back()}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={submitting}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {submitting ? 'A guardar…' : 'Guardar contacto'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}