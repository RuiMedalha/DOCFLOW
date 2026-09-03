'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Repeat } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { PartyForm } from '../_components/party-form';
import { PartyIbanPanel } from '../_components/party-detail';
import { PartyRecentDocuments } from './_components/party-recent-documents';
import { useParty } from '../_components/use-parties';
import type { PartyInput } from '../_lib/types';

export default function PartyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: party, isLoading } = useParty(params.id);

  if (isLoading) {
    return (
      <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={14} className="inline animate-spin mr-2" /> A carregar…
      </div>
    );
  }
  if (!party) {
    return <div className="card p-6 text-sm text-red-500">Entidade não encontrada.</div>;
  }

  const initial: PartyInput = {
    type: party.type,
    name: party.name,
    nif: party.nif ?? '',
    email: party.email ?? '',
    phone: party.phone ?? '',
    mobile: party.mobile ?? '',
    iban: party.iban ?? '',
    bic: party.bic ?? '',
    address: party.address ?? '',
    city: party.city ?? '',
    postalCode: party.postalCode ?? '',
    country: party.country ?? 'Portugal',
    defaultDebitAccountId: party.defaultDebitAccount?.id,
    defaultCreditAccountId: party.defaultCreditAccount?.id,
  };

  // The "isRecurring" flag is read-only — derived server-side from
  // the document count. Surface as a coloured pill on the header so
  // reviewers can spot recurring suppliers at a glance.
  const isRecurring = party.isRecurring === true;
  const showRecentDocs = party.type === 'FORNECEDOR';

  return (
    <>
      <Link href="/parties" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader
        title={party.name}
        subtitle={`NIF ${party.nif ?? '—'} · ${party.type}`}
        actions={
          <span
            className={isRecurring ? 'badge-emerald' : 'badge-neutral'}
            title={
              isRecurring
                ? 'Fornecedor recorrente — ≥3 faturas associadas'
                : 'Fornecedor ocasional'
            }
          >
            <Repeat size={10} className="mr-0.5" aria-hidden="true" />
            {isRecurring ? 'Recorrente' : 'Ocasional'}
          </span>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <PartyForm initial={initial} partyId={params.id} />
        </div>
        <div>
          <PartyIbanPanel partyId={params.id} />
        </div>
      </div>

      {showRecentDocs && (
        <div className="mt-5">
          <PartyRecentDocuments partyId={params.id} />
        </div>
      )}
    </>
  );
}