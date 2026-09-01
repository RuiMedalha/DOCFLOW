'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from 'lucide-react';
import { useIbanRisk, useIbanHistory, useVerifyIban, useFlagIban, useParty } from './use-parties';

export function PartyIbanPanel({ partyId }: { partyId: string }) {
  const { data: party } = useParty(partyId);
  const { data: history, isLoading: histLoading } = useIbanHistory(partyId);
  const { data: risk, isLoading: riskLoading, refetch } = useIbanRisk(partyId);
  const verify = useVerifyIban();
  const flag = useFlagIban();
  const [reason, setReason] = useState('');

  if (!party?.iban) {
    return (
      <div className="card p-5 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Sem IBAN registado.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="card p-5"
        style={{
          background:
            risk?.recommendedAction === 'block' ? 'rgba(248,113,113,0.05)'
            : risk?.recommendedAction === 'review' ? 'rgba(245,158,11,0.05)'
            : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {risk?.recommendedAction === 'block' ? <ShieldAlert size={16} className="text-red-500" />
                : risk?.recommendedAction === 'review' ? <ShieldQuestion size={16} className="text-amber-500" />
                : <ShieldCheck size={16} className="text-emerald-500" />}
              Anti-fraude IBAN
            </h3>
            <p className="font-mono text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{party.iban}</p>
            {party.bic && <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>BIC: {party.bic}</p>}
          </div>
          <div className="text-right">
            {riskLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : risk ? (
              <>
                <div className="text-3xl font-bold" style={{ color: risk.riskScore > 70 ? '#ef4444' : risk.riskScore > 30 ? '#f59e0b' : '#10b981' }}>
                  {risk.riskScore}
                </div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Risco · {risk.recommendedAction}</div>
              </>
            ) : null}
          </div>
        </div>

        {risk?.breakdown && risk.breakdown.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {risk.breakdown.map((b) => (
              <li key={b.factor} className="text-xs flex items-start gap-2">
                <span className="font-mono text-[10px] w-8 text-right" style={{ color: b.score > 0 ? '#f59e0b' : '#10b981' }}>
                  {b.score > 0 ? `+${b.score}` : b.score}
                </span>
                <span><span className="font-medium">{b.factor}</span> · {b.reason}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <input
            className="input text-xs flex-1"
            placeholder="Motivo (auditado)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-xs px-3 py-1.5"
            disabled={verify.isPending || !reason.trim()}
            onClick={() => verify.mutate({ id: partyId, reason }, { onSuccess: () => { setReason(''); void refetch(); } })}
          >
            Marcar verificado
          </button>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10"
            style={{ border: '1px solid rgba(248,113,113,0.30)' }}
            disabled={flag.isPending || !reason.trim()}
            onClick={() => flag.mutate({ id: partyId, reason }, { onSuccess: () => { setReason(''); void refetch(); } })}
          >
            Sinalizar + blacklist
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-3">Histórico de IBAN</h3>
        {histLoading && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>A carregar…</p>}
        {(history ?? []).length === 0 && !histLoading && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem alterações.</p>
        )}
        <ul className="space-y-2">
          {(history ?? []).map((h) => (
            <li key={h.id} className="text-xs border-l-2 pl-3" style={{ borderColor: h.verified ? 'rgba(34,197,94,0.50)' : 'rgba(245,158,11,0.50)' }}>
              <div className="font-mono">
                {h.oldIban ? `${h.oldIban} → ` : ''}<span className="font-semibold">{h.newIban}</span>
              </div>
              <div style={{ color: 'var(--text-muted)' }}>
                {new Date(h.createdAt).toLocaleString('pt-PT')} · {h.changedByName ?? h.changedBy}
                {h.verified && ' · ✓ verificado'}
                {h.reason && ` · ${h.reason}`}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}