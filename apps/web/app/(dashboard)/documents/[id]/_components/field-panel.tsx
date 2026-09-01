'use client';

/**
 * FieldPanel — editable extracted-fields panel for DocFlow documents.
 *
 * - Renders each OCR field with a confidence badge (green / amber / red).
 * - Editing any field triggers `onChange`; the parent owns persistence.
 * - Confidence is shown with a coloured dot + percent label so the
 *   reviewer can spot low-confidence values at a glance.
 * - The accounting section (debit/credit account) and the IBAN
 *   anti-fraud banner slot in via props so the parent can wire data
 *   sources.
 *
 * Numbers are formatted with tabular-nums; dates use the user's locale
 * (defaults to pt-PT).
 */

import { useEffect, useMemo, useState } from 'react';
import { Save, RefreshCw, Send, CheckCircle2, ShieldAlert, Trash2 } from 'lucide-react';

export interface ExtractedFields {
  supplier?: string | null;
  supplierNif?: string | null;
  docNumber?: string | null;
  atcud?: string | null;
  docDate?: string | null;
  dueDate?: string | null;
  netAmount?: number | null;
  taxAmount?: number | null;
  total?: number | null;
  iban?: string | null;
  currency?: string | null;
}

export interface FieldConfidence {
  supplier?: number;
  supplierNif?: number;
  docNumber?: number;
  atcud?: number;
  docDate?: number;
  dueDate?: number;
  netAmount?: number;
  taxAmount?: number;
  total?: number;
  iban?: number;
}

export interface AccountingAccount {
  code: string;
  label: string;
}

export interface LineItem {
  id: string;
  description: string;
  /** Product/service code when the document carries one (e.g. EAN, internal SKU). */
  code?: string | null;
  quantity: number;
  unitPrice: number;
  /** Per-line discount amount in currency. Optional — many documents don't apply one. */
  discount?: number | null;
  taxRate?: number;
  total: number;
}

/** Single IBAN ever seen for a supplier — used by the fraud-warning banner. */
export interface IbanHistoryEntry {
  iban: string;
  firstSeenAt: string;
  lastSeenAt?: string;
  documentCount: number;
}

export interface FieldPanelProps {
  fields: ExtractedFields;
  confidence: FieldConfidence;
  lineItems?: LineItem[];
  /** Currency display code — used in the totals row only. */
  currency?: string;
  /** Available accounting accounts, surfaced as native <select>s. */
  accounts?: AccountingAccount[];
  selectedDebitAccount?: string;
  selectedCreditAccount?: string;
  /** True while a PATCH is in flight. */
  saving?: boolean;
  /** True when the document has been approved (locks inputs). */
  approved?: boolean;
  /** True while a re-run extraction mutation is queued. */
  reExtracting?: boolean;
  /** True while sending to TOConline (stub). */
  sendingToToc?: boolean;
  /** True while the approve mutation is in flight. */
  approving?: boolean;

  onFieldChange: (patch: Partial<ExtractedFields>) => void;
  onAssignDebit?: (code: string) => void;
  onAssignCredit?: (code: string) => void;
  onReExtract?: () => void;
  onApprove?: () => void;
  onSave?: () => void;
  onSendToToc?: () => void;
}

function confColor(c?: number): 'green' | 'amber' | 'red' | 'neutral' {
  if (c == null) return 'neutral';
  if (c >= 0.85) return 'green';
  if (c >= 0.6) return 'amber';
  return 'red';
}

function confBadge(c?: number) {
  const tone = confColor(c);
  const pct = c != null ? `${Math.round(c * 100)}%` : '—';
  const map = {
    green: { bg: 'rgba(52, 211, 153, 0.18)', fg: 'var(--success)' },
    amber: { bg: 'rgba(251, 191, 36, 0.18)', fg: 'var(--warning)' },
    red: { bg: 'rgba(248, 113, 113, 0.18)', fg: 'var(--danger)' },
    neutral: { bg: 'var(--hover)', fg: 'var(--text-subtle)' },
  } as const;
  const { bg, fg } = map[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ background: bg, color: fg }}
      title={`Confiança OCR ${pct}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: fg }} aria-hidden="true" />
      {pct}
    </span>
  );
}

const fmtMoney = (v?: number | null, ccy = 'EUR') =>
  v == null ? '—' : `${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

const fmtDate = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-PT');
};

export function FieldPanel(props: FieldPanelProps) {
  const { fields, confidence, lineItems = [], currency = 'EUR', accounts = [] } = props;

  // Render-time date would mismatch between server and client; capture after mount.
  const [todayLabel, setTodayLabel] = useState<string>('');
  useEffect(() => {
    setTodayLabel(fmtDate(new Date().toISOString()));
  }, []);

  const lineSum = useMemo(
    () => lineItems.reduce((acc, li) => acc + (Number.isFinite(li.total) ? li.total : 0), 0),
    [lineItems],
  );

  // Sum of per-line discounts (currency). Optional column — only counts when set.
  const lineDiscountTotal = useMemo(
    () =>
      lineItems.reduce(
        (acc, li) => acc + (Number.isFinite(li.discount as number) ? (li.discount as number) : 0),
        0,
      ),
    [lineItems],
  );

  const hasDiscount = lineItems.some((li) => Number.isFinite(li.discount as number) && (li.discount as number) > 0);
  const hasCode = lineItems.some((li) => li.code != null && String(li.code).trim() !== '');

  const netVatTotal = (fields.netAmount ?? 0) + (fields.taxAmount ?? 0);
  const totalDelta = (fields.total ?? 0) - lineSum;

  return (
    <div className="space-y-4">
      {/* === Header / actions ============================================== */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Campos extraídos
          </h2>
          {props.approved && (
            <span className="badge-emerald">
              <CheckCircle2 size={10} className="mr-0.5" aria-hidden="true" />
              Aprovado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={props.onReExtract}
            className="btn-secondary text-xs"
            disabled={props.reExtracting}
            aria-busy={props.reExtracting}
          >
            <RefreshCw size={12} className={props.reExtracting ? 'animate-spin' : ''} aria-hidden="true" />
            Re-extrair
          </button>
          {!props.approved && (
            <button
              type="button"
              onClick={props.onApprove}
              className="btn-secondary text-xs"
              disabled={props.approving}
              aria-busy={props.approving}
              title="Marcar este documento como aprovado (locks edits)"
            >
              <CheckCircle2 size={12} className={props.approving ? 'animate-spin' : ''} aria-hidden="true" />
              {props.approving ? 'A aprovar…' : 'Aprovar'}
            </button>
          )}
          <button type="button" onClick={props.onSave} className="btn-primary text-xs" disabled={props.saving}>
            <Save size={12} aria-hidden="true" />
            Guardar
          </button>
        </div>
      </div>

      {/* === Identity block ================================================ */}
      <fieldset className="card p-4 space-y-3" disabled={props.approved}>
        <legend className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--text-subtle)' }}>
          Identidade do documento
        </legend>

        <Field label="Fornecedor" confidence={confidence.supplier}>
          <input
            type="text"
            className="input"
            value={fields.supplier ?? ''}
            onChange={(e) => props.onFieldChange({ supplier: e.target.value })}
            placeholder="Nome do emitente"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="NIF" confidence={confidence.supplierNif}>
            <input
              type="text"
              className="input font-mono"
              maxLength={20}
              value={fields.supplierNif ?? ''}
              onChange={(e) => props.onFieldChange({ supplierNif: e.target.value })}
              placeholder="500000001"
            />
          </Field>
          <Field label="Nº documento" confidence={confidence.docNumber}>
            <input
              type="text"
              className="input font-mono"
              value={fields.docNumber ?? ''}
              onChange={(e) => props.onFieldChange({ docNumber: e.target.value })}
              placeholder="FT 2026/1234"
            />
          </Field>
        </div>

        <Field label="ATCUD" confidence={confidence.atcud}>
          <input
            type="text"
            className="input font-mono"
            value={fields.atcud ?? ''}
            onChange={(e) => props.onFieldChange({ atcud: e.target.value })}
            placeholder="ABC1234-56789"
          />
        </Field>
      </fieldset>

      {/* === Dates & IBAN ================================================== */}
      <fieldset className="card p-4 space-y-3" disabled={props.approved}>
        <legend className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--text-subtle)' }}>
          Datas e IBAN
        </legend>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data do doc." confidence={confidence.docDate}>
            <input
              type="date"
              className="input"
              value={fields.docDate ?? ''}
              onChange={(e) => props.onFieldChange({ docDate: e.target.value })}
            />
          </Field>
          <Field label="Vencimento" confidence={confidence.dueDate}>
            <input
              type="date"
              className="input"
              value={fields.dueDate ?? ''}
              onChange={(e) => props.onFieldChange({ dueDate: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label="IBAN"
          confidence={confidence.iban}
          right={todayLabel}
        >
          <input
            type="text"
            className="input font-mono"
            value={fields.iban ?? ''}
            onChange={(e) => props.onFieldChange({ iban: e.target.value.toUpperCase() })}
            placeholder="PT50 0035 0651 0000 0000 0712"
          />
        </Field>
      </fieldset>

      {/* === Amounts ======================================================= */}
      <fieldset className="card p-4 space-y-3" disabled={props.approved}>
        <legend className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--text-subtle)' }}>
          Montantes
        </legend>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Base" confidence={confidence.netAmount}>
            <MoneyInput
              value={fields.netAmount ?? null}
              onChange={(v) => props.onFieldChange({ netAmount: v })}
              ccy={currency}
            />
          </Field>
          <Field label="IVA" confidence={confidence.taxAmount}>
            <MoneyInput
              value={fields.taxAmount ?? null}
              onChange={(v) => props.onFieldChange({ taxAmount: v })}
              ccy={currency}
            />
          </Field>
          <Field label="Total" confidence={confidence.total}>
            <MoneyInput
              value={fields.total ?? null}
              onChange={(v) => props.onFieldChange({ total: v })}
              ccy={currency}
            />
          </Field>
        </div>

        {/* Reconciliation footer */}
        <div
          className="flex items-center justify-between text-xs rounded-lg px-3 py-2"
          style={{ background: 'var(--hover)' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>
            Soma linhas: <span className="font-semibold tabular-nums">{fmtMoney(lineSum, currency)}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Base+IVA: <span className="font-semibold tabular-nums">{fmtMoney(netVatTotal, currency)}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Δ Total−Linhas:{' '}
            <span
              className="font-semibold tabular-nums"
              style={{ color: Math.abs(totalDelta) > 0.05 ? 'var(--warning)' : 'var(--success)' }}
            >
              {fmtMoney(totalDelta, currency)}
            </span>
          </span>
        </div>
      </fieldset>

      {/* === Line items ==================================================== */}
      {lineItems.length > 0 && (
        <section className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
            Linhas do documento ({lineItems.length})
          </h3>
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-subtle)' }}>
                  <th className="text-left font-medium pb-2">Descrição</th>
                  {hasCode && (
                    <th className="text-left font-medium pb-2">Cód.</th>
                  )}
                  <th className="text-right font-medium pb-2 tabular-nums">Qtd.</th>
                  <th className="text-right font-medium pb-2 tabular-nums">Preço un.</th>
                  {hasDiscount && (
                    <th className="text-right font-medium pb-2 tabular-nums">Desc.</th>
                  )}
                  <th className="text-right font-medium pb-2 tabular-nums">IVA</th>
                  <th className="text-right font-medium pb-2 tabular-nums">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id} className="border-t border-border">
                    <td className="py-2 pr-3" style={{ color: 'var(--text)' }}>
                      {li.description}
                    </td>
                    {hasCode && (
                      <td className="py-2 pr-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                        {li.code ? (
                          <span className="inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--hover)' }}>
                            {li.code}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {li.quantity.toLocaleString('pt-PT')}
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {fmtMoney(li.unitPrice, currency)}
                    </td>
                    {hasDiscount && (
                      <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {Number.isFinite(li.discount as number) ? fmtMoney(li.discount as number, currency) : '—'}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {li.taxRate != null ? `${li.taxRate}%` : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text)' }}>
                      {fmtMoney(li.total, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  className="border-t-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td
                    colSpan={hasCode ? 2 : 1}
                    className="pt-2.5 pr-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    Totais
                  </td>
                  <td
                    className="pt-2.5 text-right tabular-nums text-xs"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Quantidade total"
                  >
                    —
                  </td>
                  <td className="pt-2.5" aria-hidden="true" />
                  {hasDiscount && (
                    <td
                      className="pt-2.5 text-right tabular-nums text-xs"
                      style={{ color: 'var(--text-muted)' }}
                      aria-label="Desconto total"
                    >
                      {lineDiscountTotal > 0 ? `− ${fmtMoney(lineDiscountTotal, currency)}` : '—'}
                    </td>
                  )}
                  <td className="pt-2.5" aria-hidden="true" />
                  <td
                    className="pt-2.5 text-right tabular-nums font-semibold"
                    style={{ color: 'var(--text)' }}
                    aria-label="Total documento"
                  >
                    {fmtMoney(lineSum, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* === Accounting ==================================================== */}
      <fieldset className="card p-4 space-y-3" disabled={props.approved}>
        <legend className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--text-subtle)' }}>
          Contabilização
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Conta débito">
            <select
              className="input"
              value={props.selectedDebitAccount ?? ''}
              onChange={(e) => props.onAssignDebit?.(e.target.value)}
            >
              <option value="">— Selecionar —</option>
              {accounts.map((a) => (
                <option key={`d-${a.code}`} value={a.code}>
                  {a.code} · {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Conta crédito">
            <select
              className="input"
              value={props.selectedCreditAccount ?? ''}
              onChange={(e) => props.onAssignCredit?.(e.target.value)}
            >
              <option value="">— Selecionar —</option>
              {accounts.map((a) => (
                <option key={`c-${a.code}`} value={a.code}>
                  {a.code} · {a.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      {/* === TOConline ===================================================== */}
      <div className="flex items-center justify-between gap-2 card p-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            Enviar para TOConline
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            Stub — gera payload SAF-T e coloca na fila de exportação.
          </p>
        </div>
        <button
          type="button"
          onClick={props.onSendToToc}
          className="btn-secondary text-xs"
          disabled={props.sendingToToc || !props.approved}
          title={!props.approved ? 'Aprovar primeiro' : 'Enviar para TOConline'}
        >
          {props.sendingToToc ? (
            <>
              <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
              A enviar…
            </>
          ) : (
            <>
              <Send size={12} aria-hidden="true" />
              Enviar
            </>
          )}
        </button>
      </div>

      {!props.approved && (
        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--warning-fg)' }}>
          <ShieldAlert size={12} aria-hidden="true" />
          Documento por aprovar. Verifique campos com baixa confiança antes de contabilizar.
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- primitives

function Field({
  label,
  confidence,
  children,
  right,
}: {
  label: string;
  confidence?: number;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="field-group">
      <div className="flex items-center justify-between mb-1.5">
        <label className="label mb-0">{label}</label>
        <div className="flex items-center gap-1.5">
          {right && (
            <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>
              {right}
            </span>
          )}
          {confidence !== undefined && confBadge(confidence)}
        </div>
      </div>
      {children}
    </div>
  );
}

function MoneyInput({
  value,
  onChange,
  ccy,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  ccy: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        className="input tabular-nums pr-12"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
        placeholder="0,00"
      />
      <span
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
        style={{ color: 'var(--text-subtle)' }}
      >
        {ccy}
      </span>
    </div>
  );
}

// Re-export the trash icon import path so it doesn't get tree-shaken unused elsewhere.
export const __unused_Trash2 = Trash2;
