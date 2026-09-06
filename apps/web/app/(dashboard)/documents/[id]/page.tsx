'use client';

/**
 * /documents/[id] — document detail page.
 *
 * Editorial / Contábil · Blueprint Edition (commit 2026-09-04).
 *   - Lógica de negócio permanece intacta (useDocumentBundle, onSave,
 *     onApprove, onSendToToc, draft state, role gating — todos preservados).
 *   - Layout: header em 3 camadas (breadcrumb fino → nº doc oversized mono
 *     48px JetBrains Mono com 2 primeiros chars em accent-gold → hero status
 *     banner Fraunces 20px), body em grid editorial 12 col (4 viewer + 8 form)
 *     separado por hairlines navy 1px.
 *   - Micro-fixes: beforeunload guard quando draft != null + ConfirmDialog
 *     em volta do DELETE de linha.
 *
 * Data flows through TanStack Query (see ./use-document-detail.ts). All
 * mutations surface to the cache; the page itself owns the optimistic
 * field edits so the user can type freely.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Check,
  X as XIcon,
  RefreshCw,
  Save,
  UserCheck,
} from 'lucide-react';
import { DocumentViewer } from './_components/document-viewer';
import { FieldPanel } from './_components/field-panel';
import { FraudWarning } from './_components/fraud-warning';
import { QrBadge } from './_components/qr-badge';
import { CorrectSupplierDialog } from './_components/correct-supplier-dialog';
import { Dialog } from '../../../_components/ui';
import { toastBus } from '../../../_components/ui';
import {
  useAddLineItem,
  useApproveDocument,
  useAssignAccounting,
  useDeleteLineItem,
  useDocumentBundle,
  useDownloadUrl,
  useReExtract,
  useSaveFields,
  useSendToToc,
  useUpdateLineItem,
  type DocumentDetail,
} from './_lib/use-document-detail';
import type { ExtractedFields } from './_components/field-panel';
import { useUser } from '@/_lib/use-dashboard-queries';

/** Split "FT 2026/1234" → { "FT" (gold), "2026/1234" (navy) } for the anchor. */
function splitDocNumber(raw: string | null | undefined): { prefix: string; rest: string } {
  if (!raw) return { prefix: '', rest: '' };
  // Match leading non-digit characters as the prefix (e.g. "FT ", "NC ", "Fatura-").
  const m = raw.match(/^(\D{0,4})?(\d.*)$/);
  if (!m) return { prefix: '', rest: raw };
  return { prefix: (m[1] ?? '').trim(), rest: m[2] ?? raw };
}

/** Format a timestamp into "HH:MM" (PT locale) for the hero status banner. */
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

/** Format a date as "DD MMM YYYY" (PT locale) for the hero status banner. */
function fmtDateLong(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const qc = useQueryClient();

  const bundle = useDocumentBundle(id);
  const reExtract = useReExtract();
  const saveFields = useSaveFields();
  const approve = useApproveDocument();
  const assignAcc = useAssignAccounting();
  const sendToToc = useSendToToc();
  const addLine = useAddLineItem();
  const updateLine = useUpdateLineItem();
  const deleteLine = useDeleteLineItem();

  // Role gating for line-item editing. Backend enforces the same gate
  // (Role.ADMIN / Role.OPERADOR) — we mirror it here so the UI doesn't
  // expose controls that would 403 on submit.
  const user = useUser();
  const canEditLines =
    user?.role === 'ADMIN' || user?.role === 'OPERADOR';

  // Track which row is mid-PATCH so the FieldPanel can disable that row's
  // inputs until the refetch lands.
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Pending DELETE confirmation (FieldPanel asks the parent to show the dialog
  // because the parent owns the mutation lifecycle and the toastBus feedback).
  const [pendingDelete, setPendingDelete] = useState<{ itemId: string; description: string } | null>(null);

  // Manual supplier correction dialog (Sprint H+). The button lives next
  // to Re-extrair in the primary actions row; the dialog itself is
  // mounted at the bottom of the page so its lifecycle is owned here.
  const [correctDialogOpen, setCorrectDialogOpen] = useState(false);

  // Local optimistic field state — flushed to the server via Save.
  const doc = bundle.data?.document;
  const [draft, setDraft] = useState<ExtractedFields | null>(null);

  // Dirty-state guard: warn the browser if the user navigates away with
  // unsaved field edits. Fires only while draft != null (cleared by Save /
  // Re-extrair after a successful refetch).
  useEffect(() => {
    if (!draft) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [draft]);

  // Sync draft when the bundle updates, but don't clobber unsaved edits.
  const effective: ExtractedFields | null = useMemo(() => {
    if (!doc) return draft;
    if (!draft) {
      const { id: _id, ...rest } = doc as any;
      void _id;
      return rest;
    }
    return draft;
  }, [doc, draft]);

  const downloadUrl = useDownloadUrl(id);

  const onFieldChange = useCallback((patch: Partial<ExtractedFields>) => {
    setDraft((prev) => {
      const base = prev ?? {
        supplier: doc?.supplier,
        supplierNif: doc?.supplierNif,
        docNumber: doc?.docNumber,
        atcud: doc?.atcud,
        docDate: doc?.docDate,
        dueDate: doc?.dueDate,
        netAmount: doc?.netAmount,
        taxAmount: doc?.taxAmount,
        total: doc?.total,
        iban: doc?.iban,
        currency: doc?.currency,
        expenseCategory: doc?.expenseCategory,
      };
      return { ...base, ...patch };
    });
  }, [doc]);

  const onSave = useCallback(async () => {
    if (!id) return;
    // Build the payload from the live draft (user edits) and fall back to the
    // currently rendered fields when the user hasn't touched anything — so a
    // bare click on "Guardar" actually persists the current values instead of
    // silently no-op'ing.
    const base = (draft ?? (effective ?? {})) as Record<string, unknown>;
    // The PATCH /documents/:id DTO is built with class-validator's
    // `whitelist: true` + `forbidNonWhitelisted: true`, so any property it
    // does not know about (tenantId, fileName, ocrConfidence, atcud, iban…)
    // causes a 400. Filter to the allowed fields only.
    const allowedKeys = [
      'type',
      'status',
      'supplier',
      'supplierNif',
      'customer',
      'customerNif',
      'docNumber',
      'docDate',
      'dueDate',
      'total',
      'taxAmount',
      'netAmount',
      'currency',
      'tags',
      'folderId',
      'expenseCategory',
      'partyId',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowedKeys) {
      if (k in base) patch[k] = base[k];
    }
    try {
      await saveFields.mutateAsync({ id, patch });
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['document-detail', id] });
      toastBus.success('Alterações guardadas.');
    } catch (err: any) {
      // class-validator surfaces a JSON-encoded list of offending keys; keep
      // the user-facing copy short and actionable.
      const raw = typeof err?.message === 'string' ? err.message : '';
      const friendly =
        raw.includes('should not exist') || raw.includes('whitelist')
          ? 'Há campos não editáveis no payload — recarregue a página.'
          : raw || 'Falha ao guardar alterações.';
      toastBus.error(friendly);
    }
  }, [id, draft, effective, saveFields, qc]);

  const onReExtract = useCallback(async () => {
    if (!id) return;
    try {
      await reExtract.mutateAsync(id);
      setDraft(null);
      // Backend returns 202 immediately; the actual extraction runs
      // async via the processing pipeline. The hook's onSuccess
      // already invalidated the detail cache; SSE will push the
      // processingStatus transitions (RECEIVED -> EXTRACTING ->
      // ENRICHING -> COMPLETED) as they happen, and the field
      // values land via the document-detail refetch the SSE consumer
      // triggers on terminal states.
      toastBus.success(
        'Re-extração iniciada — processamento vai completar em segundos.',
      );
    } catch (err: any) {
      const message =
        typeof err?.message === 'string' && err.message.length > 0
          ? err.message
          : 'Falha na re-extração.';
      toastBus.error(`Re-extract failed: ${message}`);
    }
  }, [id, reExtract, qc]);

  const onApprove = useCallback(async () => {
    if (!id) return;
    try {
      await approve.mutateAsync(id);
      // The mutation already patches the cache to status='APROVADO' and the
      // approval badge derives from `isApproved`, so the UI flips without a
      // second round-trip. Force a refetch in the background so any
      // server-side side effects (timestamps, approverId) materialise.
      qc.invalidateQueries({ queryKey: ['document-detail', id] });
      toastBus.success('Documento aprovado.');
    } catch (err: any) {
      // Surface the API message verbatim — it's usually specific (e.g.
      // "document must be reviewed first") and helps the user unblock.
      const raw = typeof err?.message === 'string' ? err.message : '';
      toastBus.error(raw || 'Falha ao aprovar o documento.');
    }
  }, [id, approve, qc]);

  const onAssignDebit = useCallback(
    (code: string) => assignAcc.mutate({ id, debit: code, credit: undefined }),
    [assignAcc, id],
  );
  const onAssignCredit = useCallback(
    (code: string) => assignAcc.mutate({ id, debit: undefined, credit: code }),
    [assignAcc, id],
  );

  const onSendToToc = useCallback(async () => {
    if (!id) return;
    await sendToToc.mutateAsync(id);
  }, [id, sendToToc]);

  const onAddLineItem = useCallback(async () => {
    if (!id) return;
    try {
      await addLine.mutateAsync({
        id,
        body: { description: 'Novo item', quantity: 1, unitPrice: 0, taxRate: 23 },
      });
      qc.invalidateQueries({ queryKey: ['document-detail', id] });
      toastBus.success('Linha adicionada.');
    } catch (err: any) {
      const raw = typeof err?.message === 'string' ? err.message : '';
      toastBus.error(raw || 'Falha ao adicionar linha.');
    }
  }, [id, addLine, qc]);

  const onUpdateLineItem = useCallback(
    async (itemId: string, patch: Record<string, number | string | null>) => {
      if (!id) return;
      setBusyItemId(itemId);
      try {
        await updateLine.mutateAsync({ id, itemId, patch });
        qc.invalidateQueries({ queryKey: ['document-detail', id] });
      } catch (err: any) {
        const raw = typeof err?.message === 'string' ? err.message : '';
        toastBus.error(raw || 'Falha ao atualizar linha.');
      } finally {
        setBusyItemId(null);
      }
    },
    [id, updateLine, qc],
  );

  // FieldPanel opens the confirmation dialog by calling this; we own the
  // actual mutation lifecycle (so the toastBus feedback stays here).
  const onDeleteLineItem = useCallback(
    async (itemId: string, description?: string) => {
      setPendingDelete({ itemId, description: description ?? '' });
    },
    [],
  );
  const confirmDeleteLineItem = useCallback(async () => {
    if (!id || !pendingDelete) return;
    const { itemId } = pendingDelete;
    setPendingDelete(null);
    setDeletingItemId(itemId);
    try {
      await deleteLine.mutateAsync({ id, itemId });
      qc.invalidateQueries({ queryKey: ['document-detail', id] });
      toastBus.success('Linha removida.');
    } catch (err: any) {
      const raw = typeof err?.message === 'string' ? err.message : '';
      toastBus.error(raw || 'Falha ao remover linha.');
    } finally {
      setDeletingItemId(null);
    }
  }, [id, pendingDelete, deleteLine, qc]);

  if (bundle.isLoading) {
    return (
      <div data-skin="editorial" className="flex items-center justify-center py-24">
        <Loader2
          size={22}
          className="animate-spin"
          aria-hidden="true"
          style={{ color: 'var(--ed-accent-gold)' }}
        />
        <span className="ml-2 text-sm" style={{ color: 'var(--ed-ink-soft)' }}>
          A carregar documento…
        </span>
      </div>
    );
  }

  if (bundle.isError || !bundle.data || !doc) {
    return (
      <div data-skin="editorial">
        <button
          type="button"
          onClick={() => router.push('/documents')}
          className="btn-secondary text-sm mb-4"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Voltar à lista
        </button>
        <div className="card p-8 text-center">
          <AlertCircle
            size={32}
            className="mx-auto mb-2"
            aria-hidden="true"
            style={{ color: 'var(--ed-status-alert)' }}
          />
          <p className="text-sm" style={{ color: 'var(--ed-ink-soft)' }}>
            Não foi possível carregar este documento.
          </p>
        </div>
      </div>
    );
  }

  const isApproved =
    doc.status === 'APROVADO' || doc.status === 'CONCILIADO' || doc.status === 'PAGO';

  // Anchor split — first 2-ish chars become the gold prefix, the digits stay navy.
  const docNumberRaw = doc.docNumber ?? doc.fileName ?? `Documento ${id.slice(0, 8)}`;
  const { prefix: docPrefix, rest: docRest } = splitDocNumber(docNumberRaw);

  // Hero status banner copy + tone. Hidden while the doc is still NOVO
  // (nothing to review / nothing to approve / nothing to reject yet).
  const heroStatusCopy: Record<string, { copy: string; tone: 'ok' | 'warn' | 'alert' | 'neutral'; icon: 'shield' | 'check' | 'x' | null }> = {
    EM_REVISAO: { copy: 'Pronto para revisar', tone: 'warn', icon: 'shield' },
    APROVADO: {
      copy: `Aprovado · ${fmtTime((doc as any).approvedAt) || '—'}`,
      tone: 'ok',
      icon: 'check',
    },
    REJEITADO: {
      copy: 'Rejeitado · ver motivo',
      tone: 'alert',
      icon: 'x',
    },
    CONCILIADO: { copy: 'Conciliado · ver extrato', tone: 'ok', icon: 'check' },
    PAGO: { copy: 'Pago · ver recibo', tone: 'ok', icon: 'check' },
  };
  const hero = heroStatusCopy[doc.status as keyof typeof heroStatusCopy];

  return (
    <div data-skin="editorial" className="min-h-screen">
      {/* ================================================================
          HEADER — 3 camadas verticais (breadcrumb / anchor / hero status)
          ================================================================ */}
      <header className="border-b" style={{ borderColor: 'var(--ed-rule)' }}>
        {/* Camada 1 — breadcrumb fino */}
        <nav
          className="flex items-center justify-between gap-2 px-2 py-3 text-[12px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--ed-ink-faint)' }}
          aria-label="Caminho"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/documents')}
              className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--ed-ink-faint)' }}
            >
              <ArrowLeft size={12} aria-hidden="true" />
              Documentos
            </button>
            <span aria-hidden="true" style={{ color: 'var(--ed-rule-strong)' }}>/</span>
            <span className="font-mono normal-case tracking-normal" style={{ color: 'var(--ed-ink-soft)' }}>
              {docNumberRaw}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3" style={{ color: 'var(--ed-ink-faint)' }}>
            <span><kbd className="kbd">⌘S</kbd> Guardar</span>
            <span><kbd className="kbd">⌘↵</kbd> Aprovar</span>
          </div>
        </nav>

        {/* Camada 2 — nº doc oversized mono (anchor memorável) */}
        <div className="px-2 pt-6 pb-5">
          <h1
            className="font-mono font-bold leading-[1] tracking-tight"
            style={{
              fontSize: 'clamp(40px, 5vw, 56px)',
              color: 'var(--ed-ink)',
              letterSpacing: '-0.02em',
            }}
            aria-label={`Número do documento ${docNumberRaw}`}
          >
            {docPrefix && (
              <span
                style={{
                  background: 'linear-gradient(180deg, #cba65a 0%, #a8893f 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  marginRight: '0.05em',
                }}
              >
                {docPrefix}
              </span>
            )}
            {docRest || docNumberRaw}
          </h1>
          {doc.supplier && (
            <p
              className="mt-3 text-lg"
              style={{
                fontFamily: 'var(--font-editorial), ui-serif, Georgia, serif',
                color: 'var(--ed-ink)',
                fontWeight: 600,
              }}
            >
              {doc.supplier}
              {doc.supplierNif && (
                <>
                  {' · '}
                  <span className="font-mono" style={{ color: 'var(--ed-ink-faint)' }}>
                    NIF {doc.supplierNif}
                  </span>
                </>
              )}
              {(doc as any).docDate && (
                <>
                  {' · '}
                  <span className="font-mono" style={{ color: 'var(--ed-ink-faint)' }}>
                    Emissão {fmtDateLong((doc as any).docDate)}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Camada 3 — Hero status banner (só renderiza se !== NOVO) */}
        {hero && (
          <div
            className="flex items-center justify-between gap-4 px-6 py-4 border-t"
            style={{
              minHeight: '56px',
              borderColor: 'var(--ed-rule)',
              background:
                hero.tone === 'ok'
                  ? 'rgba(79, 121, 66, 0.05)'
                  : hero.tone === 'alert'
                  ? 'rgba(139, 46, 42, 0.06)'
                  : hero.tone === 'warn'
                  ? 'var(--ed-accent-gold-dim)'
                  : 'transparent',
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  background:
                    hero.tone === 'ok'
                      ? 'var(--ed-status-ok)'
                      : hero.tone === 'alert'
                      ? 'var(--ed-status-alert)'
                      : 'var(--ed-accent-gold)',
                  animation: hero.tone === 'warn' ? 'edPulseGold 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) infinite' : undefined,
                }}
                aria-hidden="true"
              />
              <span
                className="truncate"
                style={{
                  fontFamily: 'var(--font-editorial), ui-serif, Georgia, serif',
                  fontSize: '20px',
                  fontWeight: 700,
                  color:
                    hero.tone === 'ok'
                      ? 'var(--ed-status-ok)'
                      : hero.tone === 'alert'
                      ? 'var(--ed-status-alert)'
                      : 'var(--ed-ink)',
                }}
              >
                {hero.icon === 'shield' && <ShieldCheck size={20} className="inline mr-2 -mt-0.5" aria-hidden="true" />}
                {hero.icon === 'check' && <Check size={20} className="inline mr-2 -mt-0.5" aria-hidden="true" />}
                {hero.icon === 'x' && <XIcon size={20} className="inline mr-2 -mt-0.5" aria-hidden="true" />}
                {hero.copy}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onReExtract}
                disabled={reExtract.isPending}
                aria-busy={reExtract.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:opacity-70 transition-opacity"
                style={{ color: 'var(--ed-ink-soft)' }}
                title="Re-extrair (Gemini Vision)"
              >
                <RefreshCw
                  size={14}
                  className={reExtract.isPending ? 'animate-spin' : ''}
                  aria-hidden="true"
                />
                Re-extrair
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ================================================================
          BODY — grid editorial 12 col (4 viewer + 8 form)
          Separado por hairlines navy, sem cards com sombra.
          ================================================================ */}
      <div
        className="grid grid-cols-1 xl:grid-cols-12 animate-ed-fade"
        style={{ padding: '40px 16px 64px', gap: '40px' }}
      >
        {/* LEFT (col-span-4) — viewer + autenticação + IBAN */}
        <aside className="xl:col-span-4 space-y-10">
          <DocumentViewer
            src={downloadUrl}
            fileName={doc.fileName ?? `${id}.pdf`}
            mimeType={doc.mimeType}
            highlightFields={bundle.data.qrDecodedFields}
          />

          <section>
            <h3
              className="uppercase tracking-wider mb-3 font-medium"
              style={{
                fontFamily: 'var(--font-editorial), ui-serif, Georgia, serif',
                fontSize: '14px',
                letterSpacing: '0.08em',
                color: 'var(--ed-ink-faint)',
              }}
            >
              Autenticação AT
            </h3>
            <QrBadge qrPayload={doc.qrPayload} highlightedFields={bundle.data.qrDecodedFields} />
          </section>

          <section>
            <h3
              className="uppercase tracking-wider mb-3 font-medium"
              style={{
                fontFamily: 'var(--font-editorial), ui-serif, Georgia, serif',
                fontSize: '14px',
                letterSpacing: '0.08em',
                color: 'var(--ed-ink-faint)',
              }}
            >
              Verificação IBAN
            </h3>
            <FraudWarning
              currentIban={doc.iban}
              history={bundle.data.ibanHistory}
              hasParty={doc.hasParty}
            />
          </section>
        </aside>

        {/* RIGHT (col-span-8) — FieldPanel */}
        <section className="xl:col-span-8" style={{ borderLeft: '1px solid var(--ed-rule)', paddingLeft: '40px' }}>
          {/* Primary actions — pinned at the top of the right column */}
          <div className="flex items-center justify-end gap-2 mb-8">
            {!isApproved && (
              <button
                type="button"
                onClick={onApprove}
                disabled={approve.isPending}
                aria-busy={approve.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all"
                style={{
                  background: 'var(--ed-accent-gold)',
                  color: 'var(--ed-ink)',
                  borderRadius: 'var(--ed-radius-chip)',
                }}
                title="Marcar este documento como aprovado"
              >
                <Check size={14} className={approve.isPending ? 'animate-spin' : ''} aria-hidden="true" />
                {approve.isPending ? 'A aprovar…' : 'Aprovar'}
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={saveFields.isPending || !draft}
              aria-busy={saveFields.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--ed-ink)',
                border: '1px solid var(--ed-rule-strong)',
                borderRadius: 'var(--ed-radius-chip)',
              }}
              title="Guardar alterações (⌘S)"
            >
              <Save size={14} aria-hidden="true" />
              {saveFields.isPending ? 'A guardar…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={onReExtract}
              disabled={reExtract.isPending}
              aria-busy={reExtract.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--ed-ink-soft)',
                borderRadius: 'var(--ed-radius-chip)',
              }}
              title="Re-extrair (Gemini Vision)"
            >
              <RefreshCw
                size={14}
                className={reExtract.isPending ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              Re-extrair
            </button>
            <button
              type="button"
              onClick={() => setCorrectDialogOpen(true)}
              disabled={isApproved}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--ed-ink-soft)',
                borderRadius: 'var(--ed-radius-chip)',
              }}
              title={
                isApproved
                  ? 'Documento aprovado — corrija antes de aprovar'
                  : 'Corrigir fornecedor / cliente extraído pela IA'
              }
            >
              <UserCheck size={14} aria-hidden="true" />
              Corrigir fornecedor
            </button>
          </div>

          <FieldPanel
            fields={effective ?? {}}
            confidence={doc.ocrConfidence ?? {}}
            lineItems={bundle.data.items}
            currency={doc.currency ?? 'EUR'}
            accounts={bundle.data.accounts}
            selectedDebitAccount={doc.debitAccount ?? ''}
            selectedCreditAccount={doc.creditAccount ?? ''}
            saving={saveFields.isPending}
            approved={isApproved}
            reExtracting={reExtract.isPending}
            sendingToToc={sendToToc.isPending}
            approving={approve.isPending}
            documentId={id}
            partyId={doc.partyId ?? null}
            canEditLines={canEditLines}
            addingLine={addLine.isPending}
            busyItemId={busyItemId}
            deletingItemId={deletingItemId}
            onFieldChange={onFieldChange}
            onAssignDebit={onAssignDebit}
            onAssignCredit={onAssignCredit}
            onReExtract={onReExtract}
            onApprove={onApprove}
            onSave={onSave}
            onSendToToc={onSendToToc}
            onAddLineItem={onAddLineItem}
            onUpdateLineItem={onUpdateLineItem}
            onDeleteLineItem={(itemId: string, description?: string) => onDeleteLineItem(itemId, description)}
            draftActive={draft !== null}
          />
        </section>
      </div>

      {/* DELETE line-item confirmation dialog. */}
      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Eliminar linha?"
        description="Esta ação remove a linha permanentemente do documento."
        size="sm"
      >
        <div className="space-y-4">
          {pendingDelete?.description && (
            <p
              className="text-sm"
              style={{ color: 'var(--ed-ink-soft)' }}
            >
              Linha: <span className="font-medium" style={{ color: 'var(--ed-ink)' }}>{pendingDelete.description}</span>
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="btn-secondary text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDeleteLineItem}
              disabled={deletingItemId === pendingDelete?.itemId}
              aria-busy={deletingItemId === pendingDelete?.itemId}
              className="btn-danger text-sm"
            >
              {deletingItemId === pendingDelete?.itemId ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  A eliminar…
                </>
              ) : (
                <>
                  <XIcon size={14} aria-hidden="true" />
                  Eliminar
                </>
              )}
            </button>
          </div>
        </div>
      </Dialog>

      {/*
        Manual supplier/customer correction dialog. The dialog lives at
        the page root so its lifecycle is decoupled from FieldPanel and
        the bundle can refetch in the background after the POST returns.
        On a successful save we clear the optimistic draft so the FieldPanel
        picks up the server-authoritative values on the next refetch.
      */}
      <CorrectSupplierDialog
        open={correctDialogOpen}
        documentId={id}
        initial={{
          supplier: doc.supplier,
          supplierNif: doc.supplierNif,
          iban: doc.iban,
          // customer / customerNif live on the backend Document row but
          // are not surfaced on the field panel; cast through `any` so we
          // don't widen the public type for the dialog alone.
          customer: (doc as any).customer ?? null,
          customerNif: (doc as any).customerNif ?? null,
          partyId: doc.partyId ?? null,
          partyName: null,
        }}
        onClose={() => setCorrectDialogOpen(false)}
        onSaved={() => {
          // Drop any unsaved field edits — the corrected values are the
          // canonical ones now, and the bundle refetch will repopulate.
          setDraft(null);
          qc.invalidateQueries({ queryKey: ['document-detail', id] });
        }}
      />
    </div>
  );
}
