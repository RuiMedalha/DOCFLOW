'use client';

/**
 * FraudWarning — IBAN anti-fraud banner for DocFlow documents.
 *
 * Surfaces the difference between the IBAN extracted from the current
 * document and the IBAN on file for the supplier in past documents.
 * Three states:
 *   - match: silent (no banner)
 *   - first-time IBAN: amber "novo IBAN" advisory
 *   - mismatch: red banner with both IBANs + the dates they were seen
 *
 * Reads IBAN history through TanStack Query (party IBANs are cheap and
 * stable, so the cache stays warm across navigations).
 */

import { ShieldAlert, ShieldCheck, Info } from 'lucide-react';

export interface IbanHistoryEntry {
  iban: string;
  firstSeenAt: string;
  lastSeenAt?: string;
  documentCount: number;
}

export interface FraudWarningProps {
  /** IBAN extracted from the document being viewed. */
  currentIban?: string | null;
  /** All IBANs ever seen for the supplier (party history). */
  history?: IbanHistoryEntry[];
  /** Whether the supplier is linked to a party record at all. */
  hasParty?: boolean;
}

function normalise(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

export function FraudWarning({ currentIban, history = [], hasParty }: FraudWarningProps) {
  // No IBAN extracted → nothing to verify.
  if (!currentIban) return null;

  // No history yet (new supplier or first invoice) → advisory banner only.
  if (history.length === 0) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl px-4 py-3 border"
        style={{
          background: 'rgba(251, 191, 36, 0.10)',
          borderColor: 'rgba(251, 191, 36, 0.35)',
          color: 'var(--warning-fg)',
        }}
      >
        <Info size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold" style={{ color: 'var(--warning)' }}>
            IBAN sem histórico
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            É a primeira vez que vemos o IBAN{' '}
            <span className="font-mono">{currentIban}</span>{' '}
            {hasParty ? 'para este fornecedor.' : '(sem fornecedor associado).'} Verifique antes de pagar.
          </p>
        </div>
      </div>
    );
  }

  const current = normalise(currentIban);
  const knownIbans = new Set(history.map((h) => normalise(h.iban)));
  const matches = knownIbans.has(current);

  if (matches) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl px-4 py-3 border"
        style={{
          background: 'rgba(52, 211, 153, 0.10)',
          borderColor: 'rgba(52, 211, 153, 0.30)',
        }}
      >
        <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" style={{ color: 'var(--success)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          IBAN <span className="font-mono">{currentIban}</span> confere com o histórico do fornecedor.
        </p>
      </div>
    );
  }

  // Mismatch — red warning, full evidence.
  const knownList = history
    .map((h) => `${h.iban} (${h.documentCount}× desde ${h.firstSeenAt.slice(0, 10)})`)
    .join(' · ');

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl px-4 py-3 border"
      style={{
        background: 'rgba(248, 113, 113, 0.12)',
        borderColor: 'rgba(248, 113, 113, 0.45)',
      }}
    >
      <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" style={{ color: 'var(--danger)' }} />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-semibold" style={{ color: 'var(--danger)' }}>
          IBAN não confere com o histórico do fornecedor
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>
            Neste documento:
          </span>{' '}
          <span className="font-mono">{currentIban}</span>
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }} title={knownList}>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>
            Histórico conhecido:
          </span>{' '}
          {knownList}
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--warning-fg)' }}>
          ⚠ Possível fraude ou troca de IBAN — confirme com o fornecedor antes de pagar.
        </p>
      </div>
    </div>
  );
}