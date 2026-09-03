'use client';

/**
 * /documents/[id] — document detail page.
 *
 * Two-pane layout:
 *   ┌─ LEFT (sticky) ─────┬─ RIGHT (scroll) ──────────┐
 *   │ document preview     │ status / QR-AT / fraud /  │
 *   │ (PDF / image)        │ editable field panel      │
 *   │                      │ accounting + TOConline   │
 *   └──────────────────────┴───────────────────────────┘
 *
 * Data flows through TanStack Query (see ./use-document-detail.ts). All
 * mutations surface to the cache; the page itself owns the optimistic
 * field edits so the user can type freely.
 */

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { DocumentViewer } from './_components/document-viewer';
import { FieldPanel } from './_components/field-panel';
import { FraudWarning } from './_components/fraud-warning';
import { QrBadge } from './_components/qr-badge';
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

  // Local optimistic field state — flushed to the server via Save.
  const doc = bundle.data?.document;
  const [draft, setDraft] = useState<ExtractedFields | null>(null);

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
      const result: any = await reExtract.mutateAsync(id);
      setDraft(null);
      // The backend runs the extraction synchronously (no queue) and returns
      // the updated doc. Force a refetch so any cache-only fields refresh.
      qc.invalidateQueries({ queryKey: ['document-detail', id] });
      const fieldsPopulated = Array.isArray(result?.fieldsPopulated) ? result.fieldsPopulated : [];
      toastBus.success(
        fieldsPopulated.length
          ? `Re-extração concluída — ${fieldsPopulated.length} campo(s) atualizado(s).`
          : 'Re-extração concluída.',
      );
    } catch (err: any) {
      toastBus.error(err?.message ?? 'Falha na re-extração.');
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

  const onDeleteLineItem = useCallback(
    async (itemId: string) => {
      if (!id) return;
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
    },
    [id, deleteLine, qc],
  );

  if (bundle.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={22} className="animate-spin" aria-hidden="true" style={{ color: 'var(--accent)' }} />
        <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          A carregar documento…
        </span>
      </div>
    );
  }

  if (bundle.isError || !bundle.data || !doc) {
    return (
      <>
        <PageHeader
          title="Documento não encontrado"
          subtitle="O documento pedido não existe ou foi removido."
          actions={
            <button className="btn-secondary text-sm" onClick={() => router.push('/documents')}>
              <ArrowLeft size={14} aria-hidden="true" />
              Voltar à lista
            </button>
          }
        />
        <div className="card p-8 text-center">
          <AlertCircle size={32} className="mx-auto mb-2" aria-hidden="true" style={{ color: 'var(--danger)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Não foi possível carregar este documento.
          </p>
        </div>
      </>
    );
  }

  const statusTone: Record<DocumentDetail['status'], string> = {
    NOVO: 'badge-sky',
    EM_REVISAO: 'badge-amber',
    APROVADO: 'badge-emerald',
    REJEITADO: 'badge-rose',
    CONCILIADO: 'badge-violet',
    PAGO: 'badge-neutral',
  };

  const isApproved = doc.status === 'APROVADO' || doc.status === 'CONCILIADO' || doc.status === 'PAGO';

  return (
    <>
      <PageHeader
        title={doc.docNumber ?? doc.fileName ?? `Documento ${id.slice(0, 8)}`}
        subtitle={doc.supplier ? `${doc.supplier} · ${doc.supplierNif ?? '—'}` : 'Documento fiscal'}
        actions={
          <>
            <button className="btn-secondary text-sm" onClick={() => router.push('/documents')}>
              <ArrowLeft size={14} aria-hidden="true" />
              Voltar
            </button>
            <span className={statusTone[doc.status]} title={`Estado: ${doc.status}`}>
              {doc.status.replace('_', ' ')}
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 animate-in">
        {/* === Left pane: preview + status / QR / fraud ==================== */}
        <aside className="xl:col-span-5 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <DocumentViewer
            src={downloadUrl}
            fileName={doc.fileName ?? `${id}.pdf`}
            mimeType={doc.mimeType}
            highlightFields={bundle.data.qrDecodedFields}
          />

          <section className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
              Autenticação AT
            </h3>
            <QrBadge qrPayload={doc.qrPayload} highlightedFields={bundle.data.qrDecodedFields} />
          </section>

          <section className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
              Verificação IBAN
            </h3>
            <FraudWarning
              currentIban={doc.iban}
              history={bundle.data.ibanHistory}
              hasParty={doc.hasParty}
            />
          </section>
        </aside>

        {/* === Right pane: editable field panel ============================ */}
        <section className="xl:col-span-7">
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
            onDeleteLineItem={onDeleteLineItem}
          />
        </section>
      </div>
    </>
  );
}