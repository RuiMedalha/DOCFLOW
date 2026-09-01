'use client';

/**
 * DocFlow — Executive Dashboard (real data from the API).
 *
 * Aggregates KPIs + recent activity from the live backend endpoints.
 * All counts come from list endpoints with limit=1 (we only need the total).
 */

import Link from 'next/link';
import {
  FileText,
  Users,
  TrendingUp,
  Receipt,
  Building2,
  Briefcase,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/_lib/http';
import { Card } from '@/_components/ui';
import { PageHeader } from '../_components/page-header';
import { formatDate } from '../../_lib/format';

interface Paginated<T> {
  data: T[];
  meta?: { total?: number };
}

interface BankTransaction {
  id: string;
  amount: number;
  description?: string;
  transactionDate?: string;
}

interface Document {
  id: string;
  fileName?: string;
  status?: string;
  total?: number;
  createdAt?: string;
}

interface Party {
  id: string;
  name: string;
  type?: string;
}

interface Contact {
  id: string;
  name: string;
}

interface Payable {
  id: string;
  amount: number;
  status?: string;
  dueDate?: string;
}

interface Suggestion {
  id: string;
  score?: number;
  tier?: 'STRONG' | 'MEDIUM' | 'WEAK';
}

const QUERY_OPTS = { staleTime: 30_000, refetchOnWindowFocus: false } as const;

export default function DashboardPage() {
  const documentsQ = useQuery<Paginated<Document>>({
    queryKey: ['dashboard', 'documents'],
    queryFn: () => http.get<Paginated<Document>>('/documents?limit=5'),
    ...QUERY_OPTS,
  });
  const txQ = useQuery<Paginated<BankTransaction>>({
    queryKey: ['dashboard', 'bank'],
    queryFn: () => http.get<Paginated<BankTransaction>>('/banking/transactions?limit=5'),
    ...QUERY_OPTS,
  });
  const partiesQ = useQuery<Paginated<Party>>({
    queryKey: ['dashboard', 'parties'],
    queryFn: () => http.get<Paginated<Party>>('/parties?limit=5'),
    ...QUERY_OPTS,
  });
  const contactsQ = useQuery<Paginated<Contact>>({
    queryKey: ['dashboard', 'contacts'],
    queryFn: () => http.get<Paginated<Contact>>('/crm/contacts?limit=5'),
    ...QUERY_OPTS,
  });
  const payablesQ = useQuery<Paginated<Payable>>({
    queryKey: ['dashboard', 'payables'],
    queryFn: () => http.get<Paginated<Payable>>('/payments/payables?limit=5'),
    ...QUERY_OPTS,
  });
  const suggQ = useQuery<Paginated<Suggestion>>({
    queryKey: ['dashboard', 'reconciliation'],
    queryFn: () => http.get<Paginated<Suggestion>>('/reconciliation/suggestions?limit=5'),
    ...QUERY_OPTS,
  });

  const totalDocs = documentsQ.data?.meta?.total ?? documentsQ.data?.data?.length ?? 0;
  const totalTx = txQ.data?.meta?.total ?? txQ.data?.data?.length ?? 0;
  const totalParties = partiesQ.data?.meta?.total ?? partiesQ.data?.data?.length ?? 0;
  const totalContacts = contactsQ.data?.meta?.total ?? contactsQ.data?.data?.length ?? 0;
  const totalPayables = payablesQ.data?.meta?.total ?? payablesQ.data?.data?.length ?? 0;
  const totalSuggestions = suggQ.data?.meta?.total ?? suggQ.data?.data?.length ?? 0;

  const isLoading =
    documentsQ.isLoading ||
    txQ.isLoading ||
    partiesQ.isLoading ||
    contactsQ.isLoading ||
    payablesQ.isLoading ||
    suggQ.isLoading;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da atividade, KPIs e conciliação."
      />

      {isLoading && (
        <div className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> A carregar dados em tempo real…
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Documentos"
          value={totalDocs}
          href="/documents"
          icon={<FileText className="h-5 w-5" />}
          accent="accent"
        />
        <KpiCard
          label="Movimentos"
          value={totalTx}
          href="/banking"
          icon={<Receipt className="h-5 w-5" />}
          accent="success"
        />
        <KpiCard
          label="Entidades"
          value={totalParties}
          href="/parties"
          icon={<Building2 className="h-5 w-5" />}
          accent="info"
        />
        <KpiCard
          label="Contactos CRM"
          value={totalContacts}
          href="/crm/contacts"
          icon={<Users className="h-5 w-5" />}
          accent="warning"
        />
        <KpiCard
          label="A pagar"
          value={totalPayables}
          href="/payments"
          icon={<Briefcase className="h-5 w-5" />}
          accent="warning"
        />
        <KpiCard
          label="Conciliação"
          value={totalSuggestions}
          href="/reconciliation"
          icon={<TrendingUp className="h-5 w-5" />}
          accent="accent"
        />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Documentos recentes</h2>
            <Link
              href="/documents"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Ver tudo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {(documentsQ.data?.data ?? []).slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate">{d.fileName ?? d.id}</span>
                <span className="text-text-muted text-xs">
                  {d.createdAt ? formatDate(d.createdAt) : ''}
                </span>
              </li>
            ))}
            {!documentsQ.isLoading && (documentsQ.data?.data ?? []).length === 0 && (
              <li className="py-4 text-center text-text-muted text-sm">Sem documentos ainda.</li>
            )}
          </ul>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Sugestões de conciliação</h2>
            <Link
              href="/reconciliation"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Rever <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {(suggQ.data?.data ?? []).slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate">Sugestão {s.tier ?? ''} #{s.id.slice(-6)}</span>
                <span className="text-xs font-mono text-text-muted">
                  {typeof s.score === 'number' ? `${(s.score * 100).toFixed(0)}%` : ''}
                </span>
              </li>
            ))}
            {!suggQ.isLoading && (suggQ.data?.data ?? []).length === 0 && (
              <li className="py-4 text-center text-text-muted text-sm">
                Sem sugestões pendentes.
              </li>
            )}
          </ul>
        </Card>
      </section>
    </>
  );
}

interface KpiProps {
  label: string;
  value: number | string;
  href: string;
  icon: React.ReactNode;
  accent?: 'accent' | 'success' | 'warning' | 'info';
}

function KpiCard({ label, value, href, icon, accent = 'accent' }: KpiProps) {
  const accentMap: Record<NonNullable<KpiProps['accent']>, string> = {
    accent: 'text-accent bg-accent/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    info: 'text-info bg-info/10',
  };
  return (
    <Link href={href}>
      <Card className="hover:border-accent/50 transition-colors">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
          </div>
          <div className={`rounded-lg p-2 ${accentMap[accent]}`}>{icon}</div>
        </div>
      </Card>
    </Link>
  );
}