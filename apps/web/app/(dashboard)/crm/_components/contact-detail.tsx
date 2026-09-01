'use client';

/**
 * DocFlow — CRM contact detail (overview + persons + deals + activities).
 */

import Link from 'next/link';
import { Building2, User2, Mail, Phone, MapPin, Globe, Plus } from 'lucide-react';
import {
  useCrmContact,
  useAddContactPerson,
  useCreateActivity,
  useCompleteActivity,
} from './use-crm';
import { useState } from 'react';

export function ContactDetail({ contactId }: { contactId: string }) {
  const { data: contact, isLoading, isError } = useCrmContact(contactId);
  const addPerson = useAddContactPerson();
  const createActivity = useCreateActivity();
  const completeActivity = useCompleteActivity();

  const [personForm, setPersonForm] = useState({ name: '', role: '', email: '', phone: '', isPrimary: false });
  const [activityForm, setActivityForm] = useState({ subject: '', type: 'NOTE' as 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK' | 'FOLLOW_UP', notes: '' });

  if (isLoading) return <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }}>A carregar…</div>;
  if (isError || !contact) return <div className="card p-6 text-sm text-red-500">Contacto não encontrado.</div>;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: 'var(--brand-gradient-soft)' }}>
            {contact.type === 'COMPANY' ? <Building2 size={20} /> : <User2 size={20} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">{contact.name}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {contact.nif && <span className="font-mono">NIF {contact.nif}</span>}
              {contact.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {contact.email}</span>}
              {contact.phone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {contact.phone}</span>}
              {contact.city && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {contact.city}</span>}
              {contact.website && <a href={contact.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><Globe size={12} /> Website</a>}
              {contact.party && (
                <Link href={`/parties/${contact.party.id}`} className="text-sky-500 hover:underline">
                  → Party master: {contact.party.name}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Contactos diretos</h3>
          {contact.contactPersons && contact.contactPersons.length > 0 ? (
            <ul className="space-y-2">
              {contact.contactPersons.map((p: import('../_lib/types').CrmContactPerson) => (
                <li key={p.id} className="text-xs flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{p.name}</span>
                    {p.role && <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{p.role}</span>}
                    {p.email && <div style={{ color: 'var(--text-muted)' }}>{p.email}</div>}
                  </div>
                  {p.isPrimary && <span className="badge text-[10px]">Principal</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem pessoas associadas.</p>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!personForm.name.trim()) return;
              await addPerson.mutateAsync({ contactId, ...personForm });
              setPersonForm({ name: '', role: '', email: '', phone: '', isPrimary: false });
            }}
            className="grid grid-cols-2 gap-2 pt-2 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <input className="input text-xs" placeholder="Nome" required value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} />
            <input className="input text-xs" placeholder="Cargo" value={personForm.role} onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })} />
            <input className="input text-xs" type="email" placeholder="Email" value={personForm.email} onChange={(e) => setPersonForm({ ...personForm, email: e.target.value })} />
            <input className="input text-xs" placeholder="Telefone" value={personForm.phone} onChange={(e) => setPersonForm({ ...personForm, phone: e.target.value })} />
            <label className="flex items-center gap-2 text-xs col-span-2">
              <input type="checkbox" checked={personForm.isPrimary} onChange={(e) => setPersonForm({ ...personForm, isPrimary: e.target.checked })} />
              Marcar como principal
            </label>
            <button type="submit" className="btn-primary text-xs col-span-2 inline-flex items-center justify-center gap-1">
              <Plus size={12} /> Adicionar pessoa
            </button>
          </form>
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Atividades recentes</h3>
          <ul className="space-y-2">
            {(contact.activities ?? []).map((a: import('../_lib/types').Activity) => (
              <li key={a.id} className="text-xs flex items-start gap-2">
                <span className="badge text-[10px]">{a.type}</span>
                <div className="flex-1">
                  <div className="font-medium">{a.subject}</div>
                  {a.notes && <div style={{ color: 'var(--text-muted)' }}>{a.notes}</div>}
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {new Date(a.createdAt).toLocaleString('pt-PT')}
                    {a.completedAt && ' · ✓ concluída'}
                  </div>
                </div>
                {!a.completedAt && (
                  <button
                    type="button"
                    className="text-[10px] text-sky-500 hover:underline"
                    onClick={() => completeActivity.mutate(a.id)}
                  >
                    Concluir
                  </button>
                )}
              </li>
            ))}
            {(contact.activities ?? []).length === 0 && <li className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem atividades.</li>}
          </ul>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!activityForm.subject.trim()) return;
              await createActivity.mutateAsync({
                type: activityForm.type,
                subject: activityForm.subject,
                notes: activityForm.notes || undefined,
                contactId,
              });
              setActivityForm({ subject: '', type: 'NOTE', notes: '' });
            }}
            className="grid grid-cols-3 gap-2 pt-2 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <select className="select text-xs" value={activityForm.type} onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value as typeof activityForm.type })}>
              <option value="NOTE">Nota</option>
              <option value="CALL">Chamada</option>
              <option value="EMAIL">Email</option>
              <option value="MEETING">Reunião</option>
              <option value="TASK">Tarefa</option>
              <option value="FOLLOW_UP">Follow-up</option>
            </select>
            <input className="input text-xs col-span-2" placeholder="Assunto" required value={activityForm.subject} onChange={(e) => setActivityForm({ ...activityForm, subject: e.target.value })} />
            <textarea className="textarea text-xs col-span-3" placeholder="Notas (opcional)" rows={2} value={activityForm.notes} onChange={(e) => setActivityForm({ ...activityForm, notes: e.target.value })} />
            <button type="submit" className="btn-primary text-xs col-span-3 inline-flex items-center justify-center gap-1">
              <Plus size={12} /> Registar atividade
            </button>
          </form>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold">Negócios ({contact.deals?.length ?? 0})</h3>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Etapa</th>
                <th className="text-right">Valor</th>
                <th>Fecho esperado</th>
              </tr>
            </thead>
            <tbody>
              {(contact.deals ?? []).map((d: import('../_lib/types').Deal) => (
                <tr key={d.id}>
                  <td className="text-sm">{d.title}</td>
                  <td><span className="badge text-[10px]">{d.stage}</span></td>
                  <td className="text-right font-mono text-xs">
                    {new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(d.value)}
                  </td>
                  <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString('pt-PT') : '—'}
                  </td>
                </tr>
              ))}
              {(contact.deals ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-xs" style={{ color: 'var(--text-muted)' }}>Sem negócios.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}