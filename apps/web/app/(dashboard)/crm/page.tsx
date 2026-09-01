'use client';

/**
 * DocFlow — CRM (F.6) page.
 *
 * Tabs: Contactos | Negócios | Atividades | Importar. Data from `use-crm.ts`
 * (TanStack Query against /crm/*).
 */

import { useState } from 'react';
import { Contact, Briefcase, Download, Activity } from 'lucide-react';
import { PageHeader } from '../_components/page-header';
import { ContactsList } from './_components/contacts-list';
import { DealsBoard } from './_components/deals-board';
import { ActivitiesList } from './_components/activities-list';
import { ImportPanel } from './_components/import-panel';

type Tab = 'contacts' | 'deals' | 'activities' | 'import';

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>('contacts');
  return (
    <>
      <PageHeader title="CRM" subtitle="Contactos, oportunidades, pipeline de vendas e importações." />
      <div className="flex items-center gap-1 mb-5 overflow-x-auto">
        <TabBtn id="contacts" current={tab} setTab={setTab} icon={<Contact size={14} />}>Contactos</TabBtn>
        <TabBtn id="deals" current={tab} setTab={setTab} icon={<Briefcase size={14} />}>Negócios</TabBtn>
        <TabBtn id="activities" current={tab} setTab={setTab} icon={<Activity size={14} />}>Atividades</TabBtn>
        <TabBtn id="import" current={tab} setTab={setTab} icon={<Download size={14} />}>Importar</TabBtn>
      </div>
      {tab === 'contacts' && <ContactsList />}
      {tab === 'deals' && <DealsBoard />}
      {tab === 'activities' && <ActivitiesList />}
      {tab === 'import' && <ImportPanel />}
    </>
  );
}

function TabBtn({ id, current, setTab, icon, children }: { id: Tab; current: Tab; setTab: (t: Tab) => void; icon: React.ReactNode; children: React.ReactNode }) {
  const active = id === current;
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-md transition-colors ${active ? 'bg-sky-500/10 text-sky-500 font-semibold' : ''}`}
      style={active ? undefined : { color: 'var(--text-muted)' }}
    >
      {icon}
      {children}
    </button>
  );
}