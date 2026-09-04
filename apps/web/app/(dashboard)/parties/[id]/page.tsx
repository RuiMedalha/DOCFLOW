'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Repeat } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { PartyForm } from '../_components/party-form';
import { useParty, usePartyContacts, usePartyPayments } from '../_components/use-parties';
import { useUser } from '@/_lib/use-dashboard-queries';
import type { PartyInput } from '../_lib/types';

import { PartyTabs, usePartyTabFromUrl } from './_components/party-tabs';
import { ContactsTab } from './_components/contacts-tab';
import { AddressesTab } from './_components/addresses-tab';
import { DocumentsTab } from './_components/documents-tab';
import { PaymentsTab } from './_components/payments-tab';
import { IbanTab } from './_components/iban-tab';
import { TimelineTab } from './_components/timeline-tab';

/**
 * PartyDetailPage — Sprint G 360° file. 6 tabs:
 *   - Identity   (default) — the existing PartyForm (kept as-is)
 *   - Contacts   — named contacts + add/edit/delete dialogs (ADMIN)
 *   - Documents  — recent documents (FORNECEDOR-only, reuses existing component)
 *   - Payments   — list of PaymentEvent with status badges + EUR totals
 *   - IBAN       — risk-score donut + history + verify/flag actions
 *   - Timeline   — aggregated vertical list across 4 sources
 *
 * Deep-linkable: `?tab=payments` opens the party on that tab. Default
 * is `identity` (the operator's most common entry point after creating
 * or editing a party).
 */
export default function PartyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: party, isLoading } = useParty(params.id);
  const user = useUser();
  const isAdmin = user?.role === 'ADMIN';
  const activeTab = usePartyTabFromUrl();

  // Per-tab counts for the badge in the tab nav. Each query is cheap
  // (the backend caps at 50) so we fire all of them up front to avoid a
  // waterfall of re-renders as the user clicks through tabs.
  const contacts = usePartyContacts(params.id);
  const payments = usePartyPayments(params.id);

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
    isRecurring: party.isRecurring === true,
    isRecurringManualOverride: party.isRecurringManualOverride === true,
  };

  const hasOverride = party.isRecurringManualOverride === true;
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
            className={
              hasOverride
                ? 'badge-amber'
                : isRecurring
                ? 'badge-emerald'
                : 'badge-neutral'
            }
            title={
              hasOverride
                ? 'Override ADMIN — isRecurring travado, auto-flip pausado'
                : isRecurring
                ? 'Fornecedor recorrente — ≥3 faturas associadas'
                : 'Fornecedor ocasional'
            }
          >
            <Repeat size={10} className="mr-0.5" aria-hidden="true" />
            {hasOverride ? 'Override ADMIN' : isRecurring ? 'Recorrente' : 'Ocasional'}
          </span>
        }
      />

      <div className="mb-4">
        <PartyTabs
          partyId={params.id}
          active={activeTab}
          counts={{
            contacts: contacts.data?.items.length ?? 0,
            payments: payments.data?.length ?? 0,
          }}
        />
      </div>

      {activeTab === 'identity' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <PartyForm initial={initial} partyId={params.id} isAdmin={isAdmin} />
          </div>
          {/* The PartyIbanPanel previously lived here on the Identity tab.
              Sprint G moves it into the IBAN tab to avoid duplication. */}
        </div>
      )}

      {activeTab === 'contacts' && (
        <ContactsTab partyId={params.id} isAdmin={isAdmin} />
      )}

      {activeTab === 'documents' && showRecentDocs && (
        <DocumentsTab partyId={params.id} />
      )}

      {activeTab === 'documents' && !showRecentDocs && (
        <div className="card p-6 text-sm text-muted">
          Documentos recentes só são listados para fornecedores
          (clientes e fornecedores-clientes têm faturas em volumes diferentes).
        </div>
      )}

      {activeTab === 'payments' && (
        <PaymentsTab partyId={params.id} />
      )}

      {activeTab === 'iban' && (
        <IbanTab partyId={params.id} isAdmin={isAdmin} />
      )}

      {activeTab === 'timeline' && (
        <TimelineTab partyId={params.id} />
      )}
    </>
  );
}
