'use client';

/**
 * InboxTabs — Sprint F tab strip that splits the documents inbox by
 * inbound channel. The list counts shown are fetched via the same
 * `useDocumentsList` hook with the corresponding origin filter so a
 * filter mismatch between tab and list cannot get out of sync.
 */

import { FileText, ScanLine, Mail } from 'lucide-react';
import type { DocumentFiltersState, DocumentOrigin } from './types';
import { useDocumentsList } from './use-documents';

export type InboxTabKey = 'pdf' | 'scanner' | 'email';

const TAB_DEFS: Array<{
  key: InboxTabKey;
  label: string;
  icon: typeof FileText;
  origins?: DocumentOrigin[];
}> = [
  { key: 'pdf', label: 'PDF', icon: FileText },
  { key: 'scanner', label: 'Scanner', icon: ScanLine, origins: ['SCANNER'] },
  {
    key: 'email',
    label: 'Email',
    icon: Mail,
    origins: ['EMAIL', 'GMAIL', 'OUTLOOK', 'INBOUND_WEBHOOK'],
  },
];

const EMPTY_FILTERS: DocumentFiltersState = {
  search: '',
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
};

export function InboxTabs({
  active,
  onChange,
}: {
  active: InboxTabKey;
  onChange: (next: InboxTabKey) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 p-1 rounded-xl"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      role="tablist"
    >
      {TAB_DEFS.map((tab) => (
        <TabButton
          key={tab.key}
          label={tab.label}
          Icon={tab.icon}
          active={active === tab.key}
          origins={tab.origins}
          onClick={() => onChange(tab.key)}
        />
      ))}
    </div>
  );
}

function TabButton({
  label,
  Icon,
  active,
  origins,
  onClick,
}: {
  label: string;
  Icon: typeof FileText;
  active: boolean;
  origins?: DocumentOrigin[];
  onClick: () => void;
}) {
  // Per-tab count query. We only ask for `limit: 1` so the network cost
  // is bounded; the response includes `meta.total` which is what we
  // render. When origins is empty the backend returns the UPLOAD default
  // (no origin filter applied).
  const filters: DocumentFiltersState = { ...EMPTY_FILTERS, origin: origins };
  const { data } = useDocumentsList(filters, 1, 1);
  const count = data?.meta?.total ?? 0;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
      style={{
        background: active ? 'var(--hover)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <Icon size={14} />
      {label}
      <span
        className="tabular-nums text-xs px-1.5 py-0.5 rounded-md"
        style={{
          background: 'var(--surface)',
          color: 'var(--text-subtle)',
          border: '1px solid var(--border)',
        }}
      >
        {count}
      </span>
    </button>
  );
}

export type { DocumentOrigin } from './types';
