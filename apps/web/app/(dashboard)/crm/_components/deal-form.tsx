'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useCreateDeal, usePipelines, useCrmContacts } from './use-crm';
import type { DealInput } from './use-crm';

export function DealForm() {
  const router = useRouter();
  const create = useCreateDeal();
  const { data: pipelines } = usePipelines();
  const { data: contacts } = useCrmContacts({ search: '', type: '', isActive: 'true' }, 1, 100);
  const [form, setForm] = useState<DealInput>({
    title: '',
    value: 0,
    currency: 'EUR',
    contactId: '',
    pipelineId: '',
    stage: 'LEAD',
    probability: 20,
    expectedCloseAt: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!form.pipelineId && pipelines && pipelines.length > 0) {
      const def = pipelines.find((p) => p.isDefault) ?? pipelines[0];
      setForm((f) => ({ ...f, pipelineId: def.id }));
    }
  }, [pipelines, form.pipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!form.contactId || !form.pipelineId) {
        setError('Contacto e pipeline são obrigatórios.');
        return;
      }
      const res = await create.mutateAsync({
        ...form,
        expectedCloseAt: form.expectedCloseAt || undefined,
        notes: form.notes || undefined,
      });
      router.push(`/crm/deals?highlight=${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar');
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-5 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Título *" full>
          <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Contacto *">
          <select className="select" required value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
            <option value="">—</option>
            {contacts?.items.map((c: import('../_lib/types').CrmContact) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Pipeline *">
          <select className="select" required value={form.pipelineId} onChange={(e) => setForm({ ...form, pipelineId: e.target.value })}>
            <option value="">—</option>
            {pipelines?.map((p: import('../_lib/types').Pipeline) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Etapa">
          <select className="select" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as DealInput['stage'] })}>
            <option value="LEAD">Lead</option>
            <option value="QUALIFIED">Qualificado</option>
            <option value="PROPOSAL">Proposta</option>
            <option value="NEGOTIATION">Negociação</option>
          </select>
        </Field>
        <Field label="Valor (€)">
          <input type="number" step="0.01" min="0" className="input font-mono" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
        </Field>
        <Field label="Probabilidade (%)">
          <input type="number" min="0" max="100" className="input" value={form.probability} onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
        </Field>
        <Field label="Fecho esperado">
          <input type="date" className="input" value={form.expectedCloseAt ?? ''} onChange={(e) => setForm({ ...form, expectedCloseAt: e.target.value })} />
        </Field>
        <Field label="Notas" full>
          <textarea className="textarea w-full" rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>

      {error && (
        <div className="rounded-md p-3 text-xs" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.30)', color: 'var(--danger-fg)' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => router.back()}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={create.isPending}>
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Criar negócio
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