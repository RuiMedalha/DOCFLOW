'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { http } from '../../../_lib/http';
import { Button, Dialog, Input } from '../../../_components/ui';

type Event = { id: string; documentId: string; supplier: string; dueDate: string; amount: number; status: 'PENDING'|'PAID'|'OVERDUE'; daysUntilDue: number };

export default function PaymentCalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState<Event | null>(null);
  const [amount, setAmount] = useState('');
  const queryClient = useQueryClient();
  const from = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const to = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  const eventsQ = useQuery({ queryKey: ['payments', 'event-calendar', from, to], queryFn: () => http.get<Event[]>('/payments/calendar', { from, to }) });
  const pay = useMutation({ mutationFn: ({ id, amount }: { id: string; amount?: number }) => http.post<Event>(`/payments/events/${id}/pay`, amount ? { amount } : {}), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['payments', 'event-calendar'] }); setSelected(null); } });
  const events = eventsQ.data ?? [];
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const cells = useMemo(() => Array.from({ length: firstDay + last }, (_, i) => i < firstDay ? null : i - firstDay + 1), [firstDay, last]);
  const byDay = useMemo(() => new Map(events.map((e) => [Number(e.dueDate.slice(8, 10)), e])), [events]);
  const open = (event: Event) => { setSelected(event); setAmount(String(event.amount)); };

  return <main className="p-6 max-w-5xl mx-auto space-y-5">
    <div className="flex items-center justify-between"><div><h1 className="text-xl font-semibold">Calendário de pagamentos</h1><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Eventos criados ao aprovar documentos</p></div><div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16}/></Button><span className="min-w-36 text-center font-medium">{month.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</span><Button variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16}/></Button></div></div>
    <div className="glass-card p-3"><div className="grid grid-cols-7 text-center text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d) => <div key={d} className="p-2">{d}</div>)}</div><div className="grid grid-cols-7 gap-1">{cells.map((day, i) => <div key={i} className="min-h-20 rounded-lg border p-1" style={{ borderColor: 'var(--border)' }}>{day && <><div className="text-xs">{day}</div>{byDay.get(day) && <button className="mt-1 w-full rounded bg-[var(--accent)]/15 px-1 py-1 text-left text-xs truncate" onClick={() => open(byDay.get(day)!)}>{byDay.get(day)!.supplier}<br/><span>€ {byDay.get(day)!.amount.toFixed(2)}</span></button>}</>}</div>)}</div></div>
    <section><h2 className="font-medium mb-2">Eventos do mês</h2>{events.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum pagamento neste período.</p> : <div className="space-y-2">{events.map((event) => <button key={event.id} className="glass-card w-full flex items-center justify-between p-3 text-left" onClick={() => open(event)}><span><span className="font-medium">{event.supplier}</span><span className="block text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(event.dueDate).toLocaleDateString('pt-PT')} · {event.status}</span></span><span>€ {event.amount.toFixed(2)}</span></button>)}</div>}</section>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title="Marcar como pago" size="sm">{selected && <div className="space-y-4"><p className="text-sm">{selected.supplier}</p><Input label="Montante pago (€)" type="number" step="0.01" value={amount} onChange={setAmount}/><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSelected(null)}>Cancelar</Button><Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate({ id: selected.id, amount: Number(amount) || undefined })}>Confirmar pagamento</Button></div></div>}</Dialog>
  </main>;
}
