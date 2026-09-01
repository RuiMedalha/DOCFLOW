'use client';

/**
 * QrBadge — Portuguese AT QR-Code badge for DocFlow documents.
 *
 * Renders a compact summary chip when the document carries a parsed QR-AT
 * payload, and expands into a detail panel with each decoded field and
 * the raw payload for inspection. Designed to mirror the AT-spec field
 * naming (A: emitente NIF, B: adquirente, D: tipo, F: data, H: ATCUD, …).
 *
 * The parser is provided by @docflow/shared (the same module the backend
 * uses), so the UI shows EXACTLY what the server decoded — no drift.
 */

import { useState } from 'react';
import { QrCode, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { parseAndValidateAtQr } from '@docflow/shared';

export interface QrBadgeProps {
  /** Raw QR-AT payload string (the asterisk-separated "CODIGO:valor" pairs). */
  qrPayload?: string | null;
  /** Optional list of decoded field labels to highlight in the source document. */
  highlightedFields?: string[];
}

const FIELD_LABELS: Record<string, string> = {
  A: 'NIF emitente',
  B: 'NIF adquirente',
  C: 'País adquirente',
  D: 'Tipo doc.',
  E: 'Estado',
  F: 'Data doc.',
  G: 'ID único',
  H: 'ATCUD',
  I1: 'Região PT',
  I2: 'Base isenta',
  I3: 'Base reduzida',
  I4: 'IVA reduzido',
  I5: 'Base intermédia',
  I6: 'IVA intermédio',
  I7: 'Base normal',
  I8: 'IVA normal',
  L: 'Outros',
  M: 'Imposto selo',
  N: 'Total IVA',
  O: 'Total doc.',
  P: 'Retenção',
  Q: 'Hash (4)',
  R: 'Cert. software',
};

export function QrBadge({ qrPayload, highlightedFields = [] }: QrBadgeProps) {
  const [open, setOpen] = useState(false);

  if (!qrPayload || qrPayload.trim().length === 0) {
    return (
      <span className="badge-neutral" title="Documento sem QR-AT">
        <QrCode size={12} className="mr-1" aria-hidden="true" />
        Sem QR-AT
      </span>
    );
  }

  const { parsed, validation } = parseAndValidateAtQr(qrPayload);
  const isOk = validation.ok;

  return (
    <div className="rounded-xl border border-border" style={{ background: 'var(--bg-elevated)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--hover)] rounded-xl"
        aria-expanded={open}
        aria-controls="qr-at-detail"
      >
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
          style={{
            background: isOk ? 'rgba(52, 211, 153, 0.18)' : 'rgba(251, 191, 36, 0.18)',
            color: isOk ? 'var(--success)' : 'var(--warning)',
          }}
          aria-hidden="true"
        >
          <QrCode size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              QR-AT detectável
            </span>
            {isOk ? (
              <span className="badge-emerald">
                <CheckCircle2 size={10} className="mr-0.5" aria-hidden="true" />
                válido
              </span>
            ) : (
              <span className="badge-amber">
                <AlertTriangle size={10} className="mr-0.5" aria-hidden="true" />
                {validation.errors.length} erro{validation.errors.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
            {parsed?.issuerNif ? `NIF ${parsed.issuerNif}` : 'Emitente desconhecido'}
            {parsed?.uniqueDocId ? ` · ${parsed.uniqueDocId}` : ''}
            {parsed?.total != null ? ` · ${parsed.total.toFixed(2)} EUR` : ''}
          </p>
        </div>
        {open ? (
          <ChevronDown size={16} aria-hidden="true" style={{ color: 'var(--text-subtle)' }} />
        ) : (
          <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-subtle)' }} />
        )}
      </button>

      {open && parsed && (
        <div
          id="qr-at-detail"
          className="px-3.5 pb-3.5 pt-1 border-t border-border"
        >
          {/* Validation summary */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="mt-2 mb-3 space-y-1">
              {validation.errors.map((err, i) => (
                <p key={`e${i}`} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--danger)' }}>
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{err}</span>
                </p>
              ))}
              {validation.warnings.map((warn, i) => (
                <p key={`w${i}`} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--warning)' }}>
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{warn}</span>
                </p>
              ))}
            </div>
          )}

          {/* Decoded fields */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {Object.entries(parsed.fields)
              .filter(([code]) => FIELD_LABELS[code])
              .map(([code, value]) => {
                const highlighted = highlightedFields.includes(code) || highlightedFields.includes(value);
                return (
                  <div
                    key={code}
                    className={`flex items-baseline gap-2 ${highlighted ? 'rounded px-1.5 py-0.5' : ''}`}
                    style={highlighted ? { background: 'rgba(56, 189, 248, 0.12)' } : undefined}
                  >
                    <dt className="font-mono font-semibold w-10" style={{ color: 'var(--accent)' }}>
                      {code}
                    </dt>
                    <dd className="flex-1 truncate font-mono" style={{ color: 'var(--text)' }} title={value}>
                      {value}
                    </dd>
                  </div>
                );
              })}
          </dl>

          {/* Raw payload */}
          <details className="mt-3">
            <summary className="text-xs cursor-pointer select-none" style={{ color: 'var(--text-subtle)' }}>
              payload bruto
            </summary>
            <pre
              className="mt-2 p-2 rounded-lg text-xs font-mono break-all whitespace-pre-wrap"
              style={{ background: 'var(--input-bg)', color: 'var(--text-muted)' }}
            >
              {qrPayload}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
