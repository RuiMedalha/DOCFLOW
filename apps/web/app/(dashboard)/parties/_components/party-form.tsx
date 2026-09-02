'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useCreateParty, useUpdateParty, useSeedAccounts } from './use-parties';
import type { PartyInput, Account } from '../_lib/types';

export function PartyForm({ initial, partyId }: { initial?: PartyInput; partyId?: string }) {
  const router = useRouter();
  const create = useCreateParty();
  const update = useUpdateParty();
  const seedAccountsData = useSeedAccounts().data;
  const seedAccounts: Account[] = Array.isArray(seedAccountsData)
    ? seedAccountsData
    : (seedAccountsData && (seedAccountsData as any).items) || [];
  const [form, setForm] = useState<PartyInput>(initial ?? {
    type: 'FORNECEDOR',
    name: '',
    nif: '',
    email: '',
    phone: '',
    mobile: '',
    iban: '',
    bic: '',
    address: '',
    city: '',
    postalCode: '',
    country: 'Portugal',
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const cleaned: PartyInput = {
        type: form.type,
        name: form.name,
        nif: form.nif?.trim() || undefined,
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        mobile: form.mobile?.trim() || undefined,
        iban: form.iban?.trim() || undefined,
        bic: form.bic?.trim() || undefined,
        address: form.address?.trim() || undefined,
        city: form.city?.trim() || undefined,
        postalCode: form.postalCode?.trim() || undefined,
        country: form.country?.trim() || undefined,
        defaultDebitAccountId: form.defaultDebitAccountId,
        defaultCreditAccountId: form.defaultCreditAccountId,
      };
      const res = partyId
        ? await update.mutateAsync({ id: partyId, ...cleaned })
        : await create.mutateAsync(cleaned);
      router.push(`/parties/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-5 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'FORNECEDOR' | 'CLIENTE' | 'AMBOS' })}>
            <option value="FORNECEDOR">Fornecedor</option>
            <option value="CLIENTE">Cliente</option>
            <option value="AMBOS">Ambos</option>
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
        <Field label="IBAN">
          <input className="input font-mono" maxLength={34} value={form.iban ?? ''} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="PT50 0000 0000 0000 0000 0000 0" />
        </Field>
        <Field label="BIC / SWIFT">
          <input className="input font-mono" maxLength={11} value={form.bic ?? ''} onChange={(e) => setForm({ ...form, bic: e.target.value })} />
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
        <Field label="Conta Débito default">
          <select className="select" value={form.defaultDebitAccountId ?? ''} onChange={(e) => setForm({ ...form, defaultDebitAccountId: e.target.value || undefined })}>
            <option value="">—</option>
            {seedAccounts?.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Conta Crédito default">
          <select className="select" value={form.defaultCreditAccountId ?? ''} onChange={(e) => setForm({ ...form, defaultCreditAccountId: e.target.value || undefined })}>
            <option value="">—</option>
            {seedAccounts?.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
      </div>

      {error && (
        <div className="rounded-md p-3 text-xs" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.30)', color: 'var(--danger-fg)' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => router.back()}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar
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