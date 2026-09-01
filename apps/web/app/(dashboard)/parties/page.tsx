'use client';

import { useState } from 'react';
import { Users, BookOpen, Ban } from 'lucide-react';
import { PageHeader } from '../_components/page-header';
import { PartiesList } from './_components/parties-list';
import { AccountsList } from './_components/accounts-list';
import { BlacklistPanel } from './_components/blacklist-panel';

type Tab = 'parties' | 'accounts' | 'blacklist';

export default function PartiesPage() {
  const [tab, setTab] = useState<Tab>('parties');
  return (
    <>
      <PageHeader title="Entidades & Plano" subtitle="Fornecedores, clientes, IBAN anti-fraude e plano de contas PGC PT." />
      <div className="flex items-center gap-1 mb-5 overflow-x-auto">
        <TabBtn id="parties" current={tab} setTab={setTab} icon={<Users size={14} />}>Entidades</TabBtn>
        <TabBtn id="accounts" current={tab} setTab={setTab} icon={<BookOpen size={14} />}>Plano de contas</TabBtn>
        <TabBtn id="blacklist" current={tab} setTab={setTab} icon={<Ban size={14} />}>IBAN blacklist</TabBtn>
      </div>
      {tab === 'parties' && <PartiesList />}
      {tab === 'accounts' && <AccountsList />}
      {tab === 'blacklist' && <BlacklistPanel />}
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