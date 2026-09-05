import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  DocumentProcessingStatus,
  type PrismaClient,
} from '@prisma/client';
import type { AuditService } from '../../audit/audit.service';
import type { DocumentsService } from '../documents.service';
import type { ExtractionService } from '../../extraction/extraction.service';
import type { QueueAdapter } from '../../../common/queue/queue-adapter.interface';
import { ProcessingEventsStore } from './processing-events-store.service';

/**
 * Sprint H — the doc-processing pipeline.
 *
 * Four stages, each driven by an event:
 *
 *   document.uploaded  → handleReceived  (RECEIVED → EXTRACTING)
 *   document.extracted → handleExtracted (EXTRACTING → ENRICHING)
 *   document.enriched  → handleEnriched  (ENRICHING → ROUTING)
 *   document.routed    → handleRouted    (ROUTING → COMPLETED)
 *
 * Every stage is idempotent: a second invocation after the doc has
 * already advanced past the stage is a no-op. We check the persisted
 * status at the start of the handler and bail if it's not the one we
 * expect. A `pg_advisory_xact_lock` per documentId (set up by the
 * caller — DocumentsService already serialises uploads) keeps the
 * read-modify-write cycle honest.
 *
 * Failure path: any handler that throws is caught and the doc is
 * marked FAILED with the error message truncated to 500 chars. An
 * audit row with `subAction: 'processing.failed'` is written so
 * forensics can replay.
 */

// ─── payloads ────────────────────────────────────────────────────────

export interface DocumentUploadedEvent {
  documentId: string;
  tenantId: string;
  userId: string;
  fileKey: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string;
  uploadedAt: string;
}

export interface DocumentExtractedEvent {
  documentId: string;
  tenantId: string;
  userId: string;
  extractedFields: Record<string, unknown>;
  confidence: number;
  source: 'at_qr' | 'at_qr+ai' | 'ocr' | 'regex' | 'ai' | 'none';
}

export interface DocumentEnrichedEvent {
  documentId: string;
  tenantId: string;
  userId: string;
  partyId: string | null;
  partyMatched: boolean;
  ibanUpdated: boolean;
  ibanRiskScore: number;
}

export interface DocumentRoutedEvent {
  documentId: string;
  tenantId: string;
  userId: string;
  approved: boolean;
  newFileKey: string | null;
  partyId: string | null;
  completedAt: string;
}

// ─── tenant settings shape ───────────────────────────────────────────

interface TenantSettingsShape {
  autoApprove?: boolean;
}

// ─── prisma shape (narrow — we only touch these models) ──────────────

interface ProcessingPrisma {
  document: {
    findFirst: (args: { where: { id: string } }) => Promise<
      | {
          id: string;
          tenantId: string;
          partyId: string | null;
          processingStatus: DocumentProcessingStatus | null;
          processingStartedAt: Date | null;
          tenant: { settings: TenantSettingsShape | null } | null;
        }
      | null
    >;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  $transaction: <T>(work: (tx: ProcessingPrisma) => Promise<T>) => Promise<T>;
  $executeRaw: (...args: unknown[]) => Promise<unknown>;
}

const TOPICS = [
  'document.uploaded',
  'document.extracted',
  'document.enriched',
  'document.routed',
] as const;

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private readonly prisma: ProcessingPrisma,
    private readonly audit: AuditService,
    private readonly events: ProcessingEventsStore,
    private readonly extraction: ExtractionService,
    private readonly documents: DocumentsService,
    private readonly queue?: QueueAdapter,
  ) {
    // Bind once when a queue is wired. Tests construct the service
    // with no queue and call handlers directly — production wiring
    // always provides a QueueAdapter.
    if (this.queue) {
      this.queue.subscribeBatch(TOPICS, async (payload: unknown) => {
        await this.dispatch(payload);
      });
    }
  }

  // ============================================================ handlers

  /**
   * RECEIVED → EXTRACTING. The handler also kicks off extraction —
   * we don't wait for `document.extracted` to begin work.
   */
  async handleReceived(evt: DocumentUploadedEvent): Promise<void> {
    await this.tryHandler(async () => {
      const updated = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({ where: { id: evt.documentId } });
        if (!doc) {
          this.logger.warn(`[handleReceived] doc not found: ${evt.documentId}`);
          return false;
        }
        // Idempotency: skip when the doc is already past RECEIVED.
        if (doc.processingStatus && doc.processingStatus !== DocumentProcessingStatus.RECEIVED) {
          return false;
        }
        await tx.document.update({
          where: { id: evt.documentId },
          data: {
            processingStatus: DocumentProcessingStatus.EXTRACTING,
            processingError: null,
            processingStartedAt: new Date(),
          },
        });
        await this.audit.logInTx(tx as unknown as PrismaClient, {
          tenantId: evt.tenantId,
          userId: evt.userId,
          action: AuditAction.EDIT,
          entityType: 'document',
          entityId: evt.documentId,
          metadata: { subAction: 'processing.started', stage: 'EXTRACTING' },
        });
        return true;
      });
      if (!updated) return;
      this.events.emit({
        documentId: evt.documentId,
        tenantId: evt.tenantId,
        stage: 'EXTRACTING',
        event: 'processing.stage.completed',
        payload: {
          stage: 'EXTRACTING',
          status: 'started',
          completedAt: new Date().toISOString(),
        },
      });
      // Trigger the next stage — failures inside enqueue are caught
      // by tryHandler and mark the doc FAILED.
      await this.extraction.enqueue({
        tenantId: evt.tenantId,
        userId: evt.userId,
        documentId: evt.documentId,
      });
    }, evt, 'EXTRACTING');
  }

  /**
   * EXTRACTING → ENRICHING.
   */
  async handleExtracted(evt: DocumentExtractedEvent): Promise<void> {
    await this.tryHandler(async () => {
      const updated = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({ where: { id: evt.documentId } });
        if (!doc) return false;
        if (
          doc.processingStatus &&
          doc.processingStatus !== DocumentProcessingStatus.EXTRACTING
        ) {
          return false;
        }
        await tx.document.update({
          where: { id: evt.documentId },
          data: {
            processingStatus: DocumentProcessingStatus.ENRICHING,
          },
        });
        await this.audit.logInTx(tx as unknown as PrismaClient, {
          tenantId: evt.tenantId,
          userId: evt.userId,
          action: AuditAction.EDIT,
          entityType: 'document',
          entityId: evt.documentId,
          metadata: { subAction: 'processing.stage.advanced', stage: 'ENRICHING' },
        });
        return true;
      });
      if (!updated) return;
      this.events.emit({
        documentId: evt.documentId,
        tenantId: evt.tenantId,
        stage: 'ENRICHING',
        event: 'processing.stage.completed',
        payload: {
          stage: 'ENRICHING',
          status: 'started',
          completedAt: new Date().toISOString(),
        },
      });
    }, evt, 'ENRICHING');
  }

  /**
   * ENRICHING → ROUTING.
   *
   * When `tenant.settings.autoApprove === true` AND `partyId` is
   * present we call `documents.approve()`. Failure of the approve
   * call is captured and surfaced via SSE (we still advance the
   * pipeline) — it must not poison the pipeline.
   */
  async handleEnriched(evt: DocumentEnrichedEvent): Promise<void> {
    await this.tryHandler(async () => {
      const updated = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({ where: { id: evt.documentId } });
        if (!doc) return false;
        if (
          doc.processingStatus &&
          doc.processingStatus !== DocumentProcessingStatus.ENRICHING
        ) {
          return false;
        }
        await tx.document.update({
          where: { id: evt.documentId },
          data: {
            processingStatus: DocumentProcessingStatus.ROUTING,
          },
        });
        await this.audit.logInTx(tx as unknown as PrismaClient, {
          tenantId: evt.tenantId,
          userId: evt.userId,
          action: AuditAction.EDIT,
          entityType: 'document',
          entityId: evt.documentId,
          metadata: { subAction: 'processing.stage.advanced', stage: 'ROUTING' },
        });
        return true;
      });
      if (!updated) return;

      // Auto-approve gate — only fires when BOTH conditions hold:
      //   1. tenant.settings.autoApprove === true
      //   2. the doc has a partyId linked (we refuse to auto-approve
      //      a document we can't attribute to a counterparty)
      // The doc is the source of truth — the event's partyId field
      // is informational only.
      // A failure here is captured and logged but never re-thrown;
      // we still emit the SSE event so the UI keeps moving.
      const settings = await this.readTenantSettings(evt.documentId);
      const docPartyId = await this.readDocPartyId(evt.documentId);
      const autoApprove = settings?.autoApprove === true;
      let approveError: string | null = null;
      if (autoApprove && docPartyId) {
        try {
          await this.documents.approve(evt.tenantId, evt.userId, evt.documentId);
        } catch (err) {
          approveError = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[handleEnriched] approve failed for doc=${evt.documentId}: ${approveError}`,
          );
        }
      }

      this.events.emit({
        documentId: evt.documentId,
        tenantId: evt.tenantId,
        stage: 'ROUTING',
        event: 'processing.stage.completed',
        payload: {
          stage: 'ROUTING',
          status: 'started',
          completedAt: new Date().toISOString(),
          approved: !approveError && autoApprove && Boolean(evt.partyId),
          error: approveError,
        },
      });
    }, evt, 'ROUTING');
  }

  /**
   * ROUTING → COMPLETED. Terminal — the SSE Subject is closed by
   * ProcessingEventsStore on receipt of `processing.completed`.
   */
  async handleRouted(evt: DocumentRoutedEvent): Promise<void> {
    await this.tryHandler(async () => {
      const updated = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({ where: { id: evt.documentId } });
        if (!doc) return false;
        if (
          doc.processingStatus &&
          doc.processingStatus !== DocumentProcessingStatus.ROUTING
        ) {
          return false;
        }
        await tx.document.update({
          where: { id: evt.documentId },
          data: {
            processingStatus: DocumentProcessingStatus.COMPLETED,
            processingCompletedAt: new Date(),
            processingError: null,
          },
        });
        await this.audit.logInTx(tx as unknown as PrismaClient, {
          tenantId: evt.tenantId,
          userId: evt.userId,
          action: AuditAction.EDIT,
          entityType: 'document',
          entityId: evt.documentId,
          metadata: { subAction: 'processing.completed', stage: 'COMPLETED' },
        });
        return true;
      });
      if (!updated) return;
      this.events.emit({
        documentId: evt.documentId,
        tenantId: evt.tenantId,
        stage: 'COMPLETED',
        event: 'processing.completed',
        payload: {
          stage: 'COMPLETED',
          status: 'completed',
          completedAt: evt.completedAt,
        },
      });
    }, evt, 'COMPLETED');
  }

  // ============================================================ internals

  /**
   * Topic → handler dispatch. The subscribeBatch binding on
   * constructor funnels every published event here.
   */
  private async dispatch(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') return;
    const evt = payload as { topic?: string } & Record<string, unknown>;
    switch (evt.topic) {
      case 'document.uploaded':
        await this.handleReceived(evt as unknown as DocumentUploadedEvent);
        break;
      case 'document.extracted':
        await this.handleExtracted(evt as unknown as DocumentExtractedEvent);
        break;
      case 'document.enriched':
        await this.handleEnriched(evt as unknown as DocumentEnrichedEvent);
        break;
      case 'document.routed':
        await this.handleRouted(evt as unknown as DocumentRoutedEvent);
        break;
      default:
        // Other topics may be published later — silently ignore.
        break;
    }
  }

  /**
   * Wraps a handler in try/catch. On failure: marks the doc FAILED
   * with the error message, writes an audit row, and emits
   * `processing.failed` so the SSE controller can close cleanly.
   *
   * The FAILED update + audit row are bundled in a single Prisma
   * transaction so an observer never sees a FAILED doc without its
   * audit row (or vice-versa). AuditService.logInTx is the in-tx
   * variant we use here.
   */
  private async tryHandler(
    work: () => Promise<void>,
    evt: { documentId: string; tenantId: string; userId: string },
    stage: string,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const truncated = message.slice(0, 500);
      this.logger.error(
        `[tryHandler] stage=${stage} doc=${evt.documentId} failed: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      // FAILED update + audit row, in one txn. If the txn itself
      // throws we fall back to a best-effort outside-the-txn write
      // so we never leave the pipeline wedged.
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.document.update({
            where: { id: evt.documentId },
            data: {
              processingStatus: DocumentProcessingStatus.FAILED,
              processingError: truncated,
            },
          });
          await this.audit.logInTx(tx as unknown as PrismaClient, {
            tenantId: evt.tenantId,
            userId: evt.userId,
            action: AuditAction.EDIT,
            entityType: 'document',
            entityId: evt.documentId,
            metadata: {
              subAction: 'processing.failed',
              error: truncated,
              stage,
            },
          });
        });
      } catch (txErr) {
        this.logger.error(
          `[tryHandler] FAILED txn also failed for doc=${evt.documentId}: ${txErr instanceof Error ? txErr.message : String(txErr)}`,
        );
      }
      this.events.emit({
        documentId: evt.documentId,
        tenantId: evt.tenantId,
        stage: 'FAILED',
        event: 'processing.failed',
        payload: {
          stage: 'FAILED',
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: truncated,
        },
      });
    }
  }

  /**
   * Re-read the doc to pick up `tenant.settings` after the txn
   * that advanced the pipeline. Kept simple — single SELECT, no
   * caching.
   */
  private async readTenantSettings(
    documentId: string,
  ): Promise<TenantSettingsShape | null> {
    try {
      const doc = await this.prisma.document.findFirst({ where: { id: documentId } });
      return doc?.tenant?.settings ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Re-read the doc to pick up `partyId` after the txn. The auto-
   * approve gate wants the persisted value, not the event payload,
   * because the doc is the source of truth.
   */
  private async readDocPartyId(documentId: string): Promise<string | null> {
    try {
      const doc = await this.prisma.document.findFirst({ where: { id: documentId } });
      return doc?.partyId ?? null;
    } catch {
      return null;
    }
  }
}
