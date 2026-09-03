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
import { Save, RefreshCw, Send, CheckCircle2, ShieldAlert, Trash2, Plus, X, Loader2 } from 'lucide-react';
import { useCategories } from '../../../categories/use-categories';

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
  /**
   * Resolved expense category (one of EXPENSE_CATEGORIES — PT bucket slug
   * like 'Refeições', 'Combustível', …). Persisted server-side in
   * `metadata.filing.expenseCategory` via PATCH /documents/:id. Surfaced
   * by useDocumentBundle from `document.metadata.filing.expenseCategory`.
   */
  expenseCategory?: string | null;
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

  // ── Line-items editing (ADMIN/OPERADOR only) ─────────────────────────
  /** Document id — used to scope the add/update/delete calls. */
  documentId?: string;
  /** True when the current user is allowed to edit line items. */
  canEditLines?: boolean;
  /** True while a POST /items is in flight (adds the spinner). */
  addingLine?: boolean;
  /** Id of the line item currently being PATCH-ed (disables that row's inputs). */
  busyItemId?: string | null;
  /** Id of the line item currently being DELETE-d (disables that row's delete button). */
  deletingItemId?: string | null;

  onFieldChange: (patch: Partial<ExtractedFields>) => void;
  onAssignDebit?: (code: string) => void;
  onAssignCredit?: (code: string) => void;
  onReExtract?: () => void;
  onApprove?: () => void;
  onSave?: () => void;
  onSendToToc?: () => void;
  /** Fired with a partial patch (e.g. { quantity: 3 }) on cell blur. */
  onUpdateLineItem?: (itemId: string, patch: Record<string, number | string | null>) => void;
  /** Fired by the "+ Adicionar linha" button. */
  onAddLineItem?: () => void;
  /** Fired by the per-row X button. */
  onDeleteLineItem?: (itemId: string) => void;
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
  const { categories } = useCategories();
  // Resolve the selected category record so the header badge can show the
  // descriptive name + IVA deductibility percent (rather than the raw slug).
  const selectedCategory = useMemo(
    () => categories.find((c) => c.name === fields.expenseCategory) ?? null,
    [categories, fields.expenseCategory],
  );

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
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Campos extraídos
          </h2>
          {fields.expenseCategory && selectedCategory && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: selectedCategory.color ?? 'var(--hover)',
                color: 'var(--text)',
                opacity: 0.85,
              }}
              title={
                selectedCategory.defaultIvaDeductibilityPct != null
                  ? `Dedução IVA ${selectedCategory.defaultIvaDeductibilityPct}%`
                  : `Categoria: ${selectedCategory.name}`
              }
            >
              {selectedCategory.name}
              {selectedCategory.defaultIvaDeductibilityPct != null && (
                <span className="tabular-nums" style={{ color: 'var(--text-subtle)' }}>
                  {' '}— dedução {selectedCategory.defaultIvaDeductibilityPct}%
                </span>
              )}
            </span>
          )}
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

      {/* === Categoria ==================================================== */}
      <fieldset className="card p-4 space-y-3" disabled={props.approved}>
        <legend className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--text-subtle)' }}>
          Categoria
        </legend>
        <Field label="Categoria da despesa">
          <select
            className="input"
            value={fields.expenseCategory ?? ''}
            onChange={(e) =>
              props.onFieldChange({ expenseCategory: e.target.value || null })
            }
          >
            <option value="">— Selecionar —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
                {c.defaultIvaDeductibilityPct != null
                  ? ` — dedução ${c.defaultIvaDeductibilityPct}%`
                  : ''}
              </option>
            ))}
          </select>
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
      {(lineItems.length > 0 || props.canEditLines) && (
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
              Linhas do documento ({lineItems.length})
            </h3>
            {props.canEditLines && !props.approved && props.onAddLineItem && (
              <button
                type="button"
                onClick={props.onAddLineItem}
                disabled={props.addingLine}
                aria-busy={props.addingLine}
                className="btn-secondary text-[11px] py-1 px-2"
                title="Adicionar nova linha (POST /items)"
              >
                {props.addingLine ? (
                  <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plus size={11} aria-hidden="true" />
                )}
                Adicionar linha
              </button>
            )}
          </div>
          {lineItems.length > 0 && (
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
                    {props.canEditLines && !props.approved && (
                      <th className="w-6" aria-label="Ações" />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li) => {
                    const editable = Boolean(
                      props.canEditLines &&
                      !props.approved &&
                      props.onUpdateLineItem,
                    );
                    const rowBusy = props.busyItemId === li.id;
                    return (
                      <tr key={li.id} className="border-t border-border">
                        <td className="py-1.5 pr-3" style={{ color: 'var(--text)' }}>
                          {editable && props.onUpdateLineItem ? (
                            <input
                              type="text"
                              className="input input-xs w-full"
                              value={li.description}
                              disabled={rowBusy}
                              onChange={() => {/* keep controlled via onBlur only */}}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== li.description) {
                                  props.onUpdateLineItem!(li.id, { description: v });
                                }
                              }}
                            />
                          ) : (
                            <span>{li.description}</span>
                          )}
                        </td>
                        {hasCode && (
                          <td className="py-1.5 pr-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                            {li.code ? (
                              <span className="inline-block rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--hover)' }}>
                                {li.code}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {editable ? (
                            <NumberCell
                              value={li.quantity}
                              step="any"
                              disabled={rowBusy}
                              onCommit={(v) => props.onUpdateLineItem!(li.id, { quantity: v })}
                            />
                          ) : (
                            li.quantity.toLocaleString('pt-PT')
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {editable ? (
                            <NumberCell
                              value={li.unitPrice}
                              step="0.01"
                              disabled={rowBusy}
                              onCommit={(v) => props.onUpdateLineItem!(li.id, { unitPrice: v })}
                            />
                          ) : (
                            fmtMoney(li.unitPrice, currency)
                          )}
                        </td>
                        {hasDiscount && (
                          <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            {editable ? (
                              <NumberCell
                                value={li.discount as number}
                                step="0.01"
                                disabled={rowBusy}
                                onCommit={(v) => props.onUpdateLineItem!(li.id, { discount: v })}
                              />
                            ) : (
                              Number.isFinite(li.discount as number)
                                ? fmtMoney(li.discount as number, currency)
                                : '—'
                            )}
                          </td>
                        )}
                        <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {editable ? (
                            <NumberCell
                              value={li.taxRate as number}
                              step="0.1"
                              disabled={rowBusy}
                              onCommit={(v) => props.onUpdateLineItem!(li.id, { taxRate: v })}
                            />
                          ) : (
                            li.taxRate != null ? `${li.taxRate}%` : '—'
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold" style={{ color: 'var(--text)' }}>
                          {editable ? (
                            <NumberCell
                              value={li.total}
                              step="0.01"
                              disabled={rowBusy}
                              onCommit={(v) => props.onUpdateLineItem!(li.id, { total: v })}
                            />
                          ) : (
                            fmtMoney(li.total, currency)
                          )}
                        </td>
                        {props.canEditLines && !props.approved && (
                          <td className="py-1.5 pl-2">
                            {props.onDeleteLineItem && (
                              <button
                                type="button"
                                onClick={() => props.onDeleteLineItem!(li.id)}
                                disabled={rowBusy || props.deletingItemId === li.id}
                                aria-label={`Eliminar linha ${li.description}`}
                                title="Eliminar linha (DELETE /items/:itemId)"
                                className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-subtle)] hover:text-[var(--danger)] hover:bg-[var(--hover)] transition-colors"
                              >
                                {props.deletingItemId === li.id ? (
                                  <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                                ) : (
                                  <X size={11} aria-hidden="true" />
                                )}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
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
                    {props.canEditLines && !props.approved && (
                      <td aria-hidden="true" />
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
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

/**
 * NumberCell — compact numeric input for the line-items table.
 * Local state holds the in-flight text so the user can type freely;
 * on blur we coerce to number and fire `onCommit` ONLY if it changed
 * (avoids spurious PATCH round-trips on focus shifts).
 */
function NumberCell({
  value,
  step,
  disabled,
  onCommit,
}: {
  value: number | null | undefined;
  step?: string;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState<string>(
    value == null || !Number.isFinite(value) ? '' : String(value),
  );
  useEffect(() => {
    setText(value == null || !Number.isFinite(value) ? '' : String(value));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step ?? '0.01'}
      className="input input-xs tabular-nums text-right w-full max-w-[7rem] ml-auto"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === '') return;
        const n = Number(text);
        if (!Number.isFinite(n)) {
          // Revert to the last good value.
          setText(value == null || !Number.isFinite(value) ? '' : String(value));
          return;
        }
        const current = value == null || !Number.isFinite(value) ? null : value;
        if (current === n) return;
        onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value == null || !Number.isFinite(value) ? '' : String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// Re-export the trash icon import path so it doesn't get tree-shaken unused elsewhere.
export const __unused_Trash2 = Trash2;
