import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DocumentOrigin,
  DocumentStatus,
  DocumentType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DocumentQueryDto,
  UpdateDocumentDto,
} from './dto/document.dto';
import {
  FolderRulesEngine,
} from './folder-rules/folder-rules.engine';
import {
  buildPatternContext,
  decideFilingFolder,
  ExpenseCategory,
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  mapToExpenseCategory,
  PatternContext,
  RuleMatchable,
  VAT_DEDUCTIBILITY_HINTS,
} from './folder-rules/folder-rules.types';
import { StorageService } from './storage/storage-service.interface';
import { ExtractionService } from '../extraction/extraction.service';
import { ImageToPdfService } from './image-to-pdf/image-to-pdf.service';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Hard limits and allowed MIME types for the inbox upload endpoint. */
export const ALLOWED_MIMES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * DocumentsService — the inbox of DocFlow.
 *
 * Responsibilities:
 *   - Accept uploads, hash the bytes (SHA-256), refuse duplicates per tenant.
 *   - Persist file blobs via the injected StorageService (local now, S3 later).
 *   - Suggest a folder using the FolderRulesEngine — now category-aware
 *     (Fornecedores/Despesas/Estrangeiras split; see FOREIGN_INVOICE_FLOW.md).
 *   - Paginated inbox/all listing with filters (status/type/date/party/search).
 *   - Stream bytes back through an authenticated download route.
 *   - Soft-delete: the file stays on disk but the row is marked deleted.
 *
 * All queries are tenant-scoped via the Prisma extension — we still pass
 * `tenantId` explicitly in `where` for clarity and to keep the index hit
 * (`@@index([tenantId, ...])`) deterministic.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(StorageService) private readonly storage: StorageService,
    private readonly rulesEngine: FolderRulesEngine,
    // Required (not @Optional) — ExtractionModule is imported in
    // DocumentsModule so the injection is guaranteed. The previous
    // @Optional masked the wiring bug where the dependency silently
    // resolved to null.
    private readonly extraction: ExtractionService,
    private readonly imageToPdf: ImageToPdfService,
  ) {
    if (!extraction) {
      this.logger.error(
        'ExtractionService is null at construction — check ExtractionModule wiring',
      );
    }
  }

  // ─────────────────────────────────────────── upload + dedup ───────────

  async upload(
    tenantId: string,
    userId: string,
    file: UploadedFile,
    origin: DocumentOrigin = DocumentOrigin.UPLOAD,
    preType?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required and must not be empty');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File too large (${file.size} bytes; max ${MAX_UPLOAD_BYTES})`,
      );
    }

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // H-06 dedup strategy:
    //   1. Fast path: read-by-(tenantId, fileHash). If hit, return 409.
    //   2. Slow path: a TOCTOU race — two uploads of the same bytes slip
    //      past the read before either inserts. We catch the
    //      unique-violation from Prisma and re-read the existing row to
    //      return a clean 409. The schema has @@unique([tenantId, fileHash])
    //      as the authoritative dedup gate.
    const existing = await this.prisma.document.findFirst({
      where: { tenantId, fileHash },
      select: { id: true, fileName: true, createdAt: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Duplicate document detected (same SHA-256 hash)',
        existingId: existing.id,
        existingFileName: existing.fileName,
      });
    }

    // Key shape: <tenantId>/<yyyy>/<mm>/<random>.<ext>
    // Year/month groups keep directory listings manageable even at scale.
    const now = new Date();
    const fileKey = this.buildStorageKey(tenantId, file.originalname, now);

    // Persist the ORIGINAL file FIRST. The Document row references this
    // key, so a write failure here aborts the upload — never let a
    // Document exist without its original file on disk.
    await this.storage.put(fileKey, file.buffer, { contentType: file.mimetype });

    // Image uploads also get a single-page PDF derivative so the UI /
    // download route can serve a PDF the user can preview without
    // needing the original photo viewer. pdfKey is null for PDFs (no
    // point double-storing the same bytes). Best-effort: if the PDF
    // builder fails (rare — pdf-lib is pure JS), we log and continue
    // with just the original.
    let pdfKey: string | null = null;
    if (this.imageToPdf.supports(file.mimetype)) {
      try {
        pdfKey = this.buildPdfKeyFromImageKey(fileKey);
        const pdfBuffer = await this.imageToPdf.convert(file.buffer, file.mimetype);
        await this.storage.put(pdfKey, pdfBuffer, { contentType: 'application/pdf' });
      } catch (err) {
        // DO NOT block the upload — the original image is already on
        // disk and we can re-derive the PDF later (e.g. on-demand
        // download) without losing the user's invoice.
        this.logger.warn(
          `[upload] PDF derivative failed for tenant=${tenantId} ` +
            `key=${fileKey}: ${(err as Error).message}`,
        );
        pdfKey = null;
      }
    }

    // First-pass folder suggestion: the upload only knows the (optional)
    // preType and the supplier/party isn't linked yet, so we fall through
    // to the Inbox catch-all. The real category-aware filing happens
    // AFTER extraction runs (which is when partyId/country/category
    // become known). See `recomputeFolder()` for the second pass.
    const suggestedFolder = await this.rulesEngine.suggest(
      tenantId,
      { type: this.coerceType(preType) },
      now,
    );

    let doc;
    try {
      doc = await this.prisma.document.create({
        data: {
          tenantId,
          uploadedById: userId,
          origin,
          fileName: file.originalname,
          fileKey,
          fileHash,
          mimeType: file.mimetype,
          fileSize: file.size,
          pdfKey,
          status: DocumentStatus.NOVO,
          type: this.coerceType(preType),
          suggestedFolder,
          finalFolder: suggestedFolder,
          // Keep the human-facing filename the user uploaded as
          // `fileName` for now — extraction hasn't run, so we don't yet
          // know supplier/docNumber. After extraction populates those
          // fields, `renameAfterExtraction()` swaps this for the
          // `<SUPPLIER>_<DATE>_<NUMBER>` slug. The original stays here
          // for audit/traceability.
          metadata: {
            originalFilename: file.originalname,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Prisma P2002 = unique constraint violation. We catch it, look up
      // the surviving row, and re-throw a clean 409.
      if (this.isUniqueViolation(err)) {
        const raceWinner = await this.prisma.document.findFirst({
          where: { tenantId, fileHash },
          select: { id: true, fileName: true },
        });
        if (raceWinner) {
          throw new ConflictException({
            message: 'Duplicate document detected (same SHA-256 hash)',
            existingId: raceWinner.id,
            existingFileName: raceWinner.fileName,
          });
        }
      }
      throw err;
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPLOAD,
      entityType: 'document',
      entityId: doc.id,
      metadata: { fileName: file.originalname, size: file.size, mimeType: file.mimetype },
    });

    // Auto-trigger extraction — fires-and-forgets so the upload
    // response isn't blocked by OCR/QR decode. The worker (or the
    // service's sync fallback) owns the resulting writes.
    //
    // HARDENED 2026-09-01: the previous fire-and-forget had two silent
    // failure modes that left Documents stuck in NOVO:
    //   1) If `this.extraction` was somehow null/undefined the call
    //      threw synchronously, the .catch swallowed it, and the
    //      document was never updated.
    //   2) If the enqueue Promise was lost (e.g. last fire-and-forget
    //      promise after the response already went out) the .catch never
    //      attached and the rejection became an unhandled rejection.
    // We now:
    //   - Log "auto-extract trigger" BEFORE invoking enqueue so we can
    //     see in the API log that the trigger fired.
    //   - Wrap the synchronous part in try/catch so a TypeError on a
    //     null extraction (defensive) becomes a logged error.
    //   - Attach .then() AND .catch() to the Promise to log outcome
    //     regardless of which path it takes.
    //   - Write a `metadata.extraction.trigger` audit entry even if the
    //     enqueue fails — so the row never ends up silent.
    const triggerAt = new Date().toISOString();
    this.logger.log(
      `[upload] auto-extract trigger for document=${doc.id} ` +
        `tenant=${tenantId} at=${triggerAt}`,
    );
    try {
      const enqueuePromise = this.extraction.enqueue({
        tenantId,
        userId,
        documentId: doc.id,
      });
      // Log the eventual outcome (success or rejection). This runs
      // AFTER the upload response goes out — that's fine, fire-and-forget
      // is the contract — but the operator can now ALWAYS see whether
      // extraction started and what its final disposition was.
      enqueuePromise
        .then((result) => {
          const elapsed = Date.now() - new Date(triggerAt).getTime();
          this.logger.log(
            `[upload] auto-extract finished for document=${doc.id} ` +
              `tenant=${tenantId} in ${elapsed}ms (ok=${result.ok}, ` +
              `source=${result.source ?? "?"}, confidence=${result.confidence ?? "?"}, ` +
              `reason=${(result as { reason?: string }).reason ?? "n/a"})`,
          );
        })
        .catch((err) => {
          this.logger.error(
            `[upload] auto-extract FAILED for document=${doc.id} ` +
              `tenant=${tenantId}. Reason: ${(err as Error).message}`,
          );
          this.logger.error(
            `[upload] auto-extract stack: ${(err as Error).stack ?? "(no stack)"}`,
          );
        });
    } catch (err) {
      // Synchronous throw — e.g. this.extraction is null in a mis-wired
      // module setup. Log loud so the operator sees it.
      this.logger.error(
        `[upload] auto-extract SYNC THROW for document=${doc.id} ` +
          `tenant=${tenantId}. Reason: ${(err as Error).message}`,
      );
      this.logger.error(
        `[upload] auto-extract sync stack: ${(err as Error).stack ?? "(no stack)"}`,
      );
    }

    return this.sanitize(doc);
  }

  // ─────────────────────────────────────────── listings ────────────────

  async findAll(tenantId: string, query: DocumentQueryDto) {
    const where = this.buildWhere(tenantId, query);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
          folder: { select: { id: true, name: true, pattern: true } },
          // Include the party's recurring flag in the list view so the UI
          // can show the "Fornecedor recorrente / ocasional" badge without
          // a second round-trip per row. Keeps the detail endpoint
          // contract unchanged — `findOne` already exposes this.
          party: { select: { id: true, name: true, country: true, isRecurring: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      items: items.map((d) => this.sanitize(d)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Inbox is the NOVO bucket — surfaced separately to mirror the UI tab. */
  async findInbox(tenantId: string, query: DocumentQueryDto) {
    return this.findAll(tenantId, { ...query, status: DocumentStatus.NOVO });
  }

  /**
   * Folders scoped to the current tenant — powers the inbox sidebar /
   * bulk-move target. Sorted by name asc, empty list when no folders
   * exist (the UI degrades to showing only the inbox tab).
   */
  async listFolders(tenantId: string) {
    const folders = await this.prisma.folder.findMany({
      where: { tenantId },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    });
    return folders;
  }

  async findOne(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        folder: { select: { id: true, name: true, pattern: true } },
        party: { select: { id: true, name: true, country: true, isRecurring: true } },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.sanitize(doc);
  }

  // ─────────────────────────────────────────── update ───────────────────

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateDocumentDto,
  ) {
    const existing = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        type: true,
        supplier: true,
        supplierNif: true,
        customer: true,
        partyId: true,
        docDate: true,
        metadata: true,
      },
    });
    if (!existing) throw new NotFoundException('Document not found');

    // Validate manual expense-category override (empty string clears it).
    let manualCategory: ExpenseCategory | null | undefined;
    if (dto.expenseCategory !== undefined) {
      if (dto.expenseCategory === '') {
        manualCategory = null; // explicit clear
      } else if (!isExpenseCategory(dto.expenseCategory)) {
        throw new BadRequestException(
          `Invalid expenseCategory. Must be one of: ${EXPENSE_CATEGORIES.join(', ')}`,
        );
      } else {
        manualCategory = dto.expenseCategory;
      }
    }

    // Persist manual override into metadata.filing BEFORE the rules
    // engine so the engine sees the resolved category.
    let metadata: Prisma.InputJsonValue | null | undefined;
    if (manualCategory !== undefined) {
      metadata = this.writeFilingMetadata(
        existing.metadata as Prisma.JsonValue | null | undefined,
        {
          expenseCategory: manualCategory,
          // source tells the audit trail whether the value came from AI or
          // from the user's manual override.
          source: manualCategory ? 'user' : 'cleared',
        },
      );
    }

    // Re-run the rules engine whenever classification-affecting inputs
    // changed: type, supplier, partyId, OR the user overrode expenseCategory.
    const classificationChanged =
      dto.type !== undefined ||
      dto.supplier !== undefined ||
      dto.partyId !== undefined ||
      dto.expenseCategory !== undefined;

    let suggestedFolder: string | undefined;
    let finalFolder: string | undefined;
    if (classificationChanged) {
      // Pull the linked party (if any) so the engine knows whether the
      // supplier is recurring and what country they are from.
      // Use the freshly-set partyId when present so a manual link
      // takes effect on this same PATCH (the existing row's partyId
      // hasn't been updated yet at this point in the flow).
      const partyLookupId = dto.partyId ?? existing.partyId;
      const party = partyLookupId
        ? await this.prisma.party.findFirst({
            where: { id: partyLookupId, tenantId },
            select: { name: true, country: true, isRecurring: true },
          })
        : null;

      // Resolve the effective expense category in priority order:
      //   1. Manual override (just set above).
      //   2. Previously persisted expenseCategory (from earlier override
      //      OR from extraction's aiCategory).
      //   3. Map suggestedCategory → EXPENSE_CATEGORIES (live, no DB hit).
      const previousFiling = this.readFilingMetadata(
        existing.metadata as Prisma.JsonValue | null | undefined,
      );
      const resolvedExpenseCategory =
        manualCategory !== undefined
          ? manualCategory
          : previousFiling.expenseCategory ?? null;

      const ruleInputs: RuleMatchable & { customer?: string | null } = {
        type: (dto.type ?? existing.type) as DocumentType,
        supplier: dto.supplier ?? existing.supplier,
        supplierNif: dto.supplierNif ?? existing.supplierNif,
        customer: dto.customer ?? existing.customer,
        supplierCountry: party?.country ?? null,
        supplierIsRecurring: party?.isRecurring ?? null,
        expenseCategory: resolvedExpenseCategory ?? null,
      };
      const refDate = existing.docDate ?? new Date();
      const rendered = await this.rulesEngine.suggest(tenantId, ruleInputs, refDate);
      suggestedFolder = rendered;
      finalFolder = rendered;
    }

    let folderIdToSet: string | null | undefined;
    if (dto.folderId !== undefined) {
      if (dto.folderId) {
        const folder = await this.prisma.folder.findFirst({
          where: { id: dto.folderId, tenantId },
          select: { id: true },
        });
        if (!folder) throw new NotFoundException('Folder not found');
        folderIdToSet = folder.id;
      } else {
        folderIdToSet = null;
      }
    }

    // Materialise a Folder row for the resolved path so the UI tree and
    // counts pick it up. Only do this when the engine produced a real
    // path AND the user did not pass an explicit folderId (an explicit
    // id always wins).
    //
    // The Folder table has @@unique([tenantId, name]) — name must be
    // unique across the whole tenant tree. Year/month segments ("2026",
    // "08") would conflict with each other across categories, so
    // materialiseFolderPath strips them and only creates the static
    // category/supplier parents. The Document's `finalFolder` string
    // still carries the full path for navigation; only the Folder tree
    // gets coarser. If a real folder row is needed for the year/month
    // bucket, a future migration can change the schema.
    if (
      finalFolder !== undefined &&
      dto.folderId === undefined
    ) {
      const materialised = await this.materialiseFolderPath(
        tenantId,
        finalFolder,
      );
      if (materialised) folderIdToSet = materialised.id;
    }

    const data: Record<string, unknown> = { ...dto };
    if (dto.docDate !== undefined) data.docDate = new Date(dto.docDate);
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (suggestedFolder !== undefined) data.suggestedFolder = suggestedFolder;
    if (finalFolder !== undefined) data.finalFolder = finalFolder;
    if (metadata !== undefined) data.metadata = metadata;
    if (folderIdToSet !== undefined) {
      data.folderId = folderIdToSet;
    } else {
      // dto was spread in — drop folderId so the DB keeps whatever was there.
      delete data.folderId;
    }
    // The DTO carries expenseCategory as a top-level field but it lives
    // INSIDE metadata.filing — strip it from the update payload so we
    // don't create a stray column write.
    delete data.expenseCategory;

    const updated = await this.prisma.document.update({
      where: { id },
      data,
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'document',
      entityId: id,
      metadata: this.stripUndefined(dto) as Prisma.InputJsonValue,
    });

    return this.sanitize(updated);
  }

  // ─────────────────────────────────────────── folder assignment ───────

  async assignFolder(
    tenantId: string,
    userId: string,
    id: string,
    folderId: string | null,
  ) {
    const existing = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Document not found');

    if (folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, tenantId },
        select: { id: true },
      });
      if (!folder) throw new NotFoundException('Folder not found');
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: { folderId: folderId ?? null },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'document',
      entityId: id,
      metadata: { folderId: folderId ?? null },
    });

    return this.sanitize(updated);
  }

  // ─────────────────────────────────────────── download ─────────────────

  async getFileBuffer(
    tenantId: string,
    id: string,
    preferredFormat: 'pdf' | 'original' = 'pdf',
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        fileKey: true,
        pdfKey: true,
        mimeType: true,
        fileName: true,
      },
    });
    if (!doc) throw new NotFoundException('Document not found');

    // Decide which blob to serve. Image uploads carry a PDF derivative
    // (pdfKey); PDFs / docs have pdfKey=null and always fall back to
    // fileKey regardless of preferredFormat.
    let key = doc.fileKey;
    let servedMime = doc.mimeType;
    let servedName = doc.fileName;
    if (preferredFormat === 'pdf' && doc.pdfKey) {
      key = doc.pdfKey;
      servedMime = 'application/pdf';
      const base = doc.fileName.replace(/\.[^.]+$/, '');
      servedName = `${base}.pdf`;
    }

    const obj = await this.storage.getBuffer(key);
    return {
      buffer: obj.buffer,
      mimeType: servedMime,
      fileName: servedName,
    };
  }

  /** Signed URL helper (currently returns the local route — S3 driver returns presigned). */
  async getFileUrl(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, fileName: true, mimeType: true, fileKey: true, pdfKey: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const url = await this.storage.getSignedUrl(doc.fileKey, 300);
    return { url, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  // ─────────────────────────────────────────── soft delete ──────────────

  async softDelete(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Document not found');

    // The Prisma schema doesn't have a `deletedAt` column on Document
    // (we keep it intentionally minimal). We model soft-delete via status
    // = ARQUIVADO so the row stays queryable for audit but disappears
    // from default lists (status != ARQUIVADO).
    await this.prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.ARQUIVADO },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'document',
      entityId: id,
      metadata: { reason: 'soft-delete (arquivado)' },
    });

    return { id, status: DocumentStatus.ARQUIVADO };
  }

  // ─────────────────────────────────────────── approve ──────────────────

  /**
   * Approve a document. State machine:
   *   NOVO        → APROVADO   (accepted — the upload never went through review)
   *   EM_REVISAO  → APROVADO   (the normal happy path)
   *   APROVADO    → 409 (no re-approve — caller must unapprove explicitly,
   *                          which is not a route we expose today)
   *   PROCESSADO  → 409 (already finalised by extraction; reviewer path
   *                          must move it through EM_REVISAO first)
   *   REJEITADO   → 409 (rejected docs must be re-classified and re-enter
   *                          via NOVO/EM_REVISAO before they can be approved)
   *   ARQUIVADO   → 409 (soft-deleted — restore via a separate path first)
   *
   * We refuse silently-on-success: the caller (controller) gates the role
   * with @Roles(ADMIN, APPROVER), so a non-approver never reaches this
   * function. The function itself does NOT re-check the role — that's the
   * guard's job — but it does enforce the state transition regardless of
   * who is calling, because the state machine is a domain invariant.
   */
  async approve(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Document not found');

    if (existing.status === DocumentStatus.APROVADO) {
      throw new ConflictException(
        'Document is already approved (re-approval is not allowed)',
      );
    }
    if (
      existing.status !== DocumentStatus.NOVO &&
      existing.status !== DocumentStatus.EM_REVISAO
    ) {
      // PROCESSADO / REJEITADO / ARQUIVADO — caller must move the row
      // back to EM_REVISAO (or NOVO) before approval is meaningful.
      throw new ConflictException(
        `Cannot approve document in status ${existing.status}; move it to EM_REVISAO first`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.APROVADO,
        approvedAt: now,
        approvedById: userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.APPROVE,
      entityType: 'document',
      entityId: id,
      metadata: {
        previousStatus: existing.status,
        approvedAt: now.toISOString(),
      } as Prisma.InputJsonValue,
    });

    return this.sanitize(updated);
  }

  // ─────────────────────────────────────────── items ─────────────────────

  /**
   * List a document's line items. Real rows from `document_items` are
   * authoritative when present — the extraction worker (or a future
   * manual editor) persists into that table after the user confirms the
   * AI's draft.
   *
   * Today the in-process extraction worker only writes lineItems into
   * `metadata.extraction.lineItems` (a JSON bag). For UI rendering on the
   * detail page we surface THAT payload too — derived into the same shape
   * so the UI never has to know whether the rows were materialised yet.
   *
   * The `source` field on the response tells the caller which side they
   * got. `items` is always present (may be empty). The fallback is
   * deterministic — same input always yields the same output — and never
   * pretends the rows exist in the database.
   */
  async listItems(
    tenantId: string,
    id: string,
  ): Promise<
    Array<{
      id?: string;
      code: string | null;
      description: string;
      quantity: number | string | null;
      unitPrice: number | string | null;
      discount: number | string | null;
      taxRate: number | string | null;
      total: number | string | null;
      source?: 'metadata';
    }>
  > {
    // 404 if the document is not in this tenant (or doesn't exist).
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, metadata: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    // Authoritative path: real DocumentItem rows ordered by createdAt so
    // the UI sees the same order the worker persisted them in.
    const rows = await this.prisma.documentItem.findMany({
      where: { documentId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        description: true,
        quantity: true,
        unitPrice: true,
        discount: true,
        taxRate: true,
        total: true,
      },
    });

    if (rows.length > 0) {
      return rows.map((r) => ({
          id: r.id,
          code: r.code,
          description: r.description,
          quantity: r.quantity != null ? Number(r.quantity) : null,
          unitPrice: r.unitPrice != null ? Number(r.unitPrice) : null,
          discount: r.discount != null ? Number(r.discount) : null,
          taxRate: r.taxRate != null ? Number(r.taxRate) : null,
          total: r.total != null ? Number(r.total) : null,
      }));
    }

    // Fallback path: derive line items from `metadata.extraction.lineItems`
    // — the JSON payload the in-process extraction worker writes when it
    // finishes OCR. Shape on the wire is:
    //   { description, code, quantity, unitPrice, vatRate, discount, lineTotal }
    const meta = doc.metadata as Prisma.JsonValue | null | undefined;
    const extraction = this.getNestedObject(meta, 'extraction');
    const rawItems = extraction?.lineItems;
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      const items = rawItems
        .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
        .map((it) => ({
          // No DB id — these rows haven't been materialised yet.
          code: typeof it.code === 'string' ? it.code : null,
          description:
            typeof it.description === 'string' && it.description.length > 0
              ? it.description
              : '(no description)',
          quantity: this.toFiniteNumber(it.quantity),
          unitPrice: this.toFiniteNumber(it.unitPrice),
          discount: this.toFiniteNumber(it.discount),
          taxRate: this.toFiniteNumber((it as { vatRate?: unknown }).vatRate),
          total: this.toFiniteNumber(
            (it as { lineTotal?: unknown; total?: unknown }).lineTotal ??
              (it as { total?: unknown }).total,
          ),
          source: 'metadata' as const,
        }));
      return items;
    }

    return [];
  }

  /** Coerce a JSON value into a finite number, or null. Used by the
   *  listItems fallback so the wire shape stays numeric without throwing
   *  on missing/garbage values from the extraction payload. */
  private toFiniteNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // ─────────────────────────────────────────── helpers ──────────────────

  /**
   * Centralised WHERE-clause builder so findAll / findInbox / future
   * exports share the same filter semantics.
   */
  private buildWhere(tenantId: string, query: DocumentQueryDto): Record<string, unknown> {
    const where: Record<string, unknown> = {
      tenantId,
      // Hide soft-deleted rows from the inbox/list by default.
      status: { not: DocumentStatus.ARQUIVADO },
    };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.partyId) {
      where.OR = [
        { partyId: query.partyId },
        { crmContactId: query.partyId },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setUTCHours(23, 59, 59, 999);
        range.lte = end;
      }
      where.createdAt = range;
    }
    if (query.search) {
      const search = query.search;
      where.OR = [
        { fileName: { contains: search, mode: 'insensitive' } },
        { supplier: { contains: search, mode: 'insensitive' } },
        { customer: { contains: search, mode: 'insensitive' } },
        { docNumber: { contains: search, mode: 'insensitive' } },
        { supplierNif: { contains: search } },
        { customerNif: { contains: search } },
      ];
    }
    return where;
  }

  /**
   * Strip internal storage columns from the response. fileKey/fileHash
   * should never leak — fileKey is the storage backend's internal pointer
   * (potentially a signed S3 URL path) and fileHash is the duplicate check.
   *
   * pdfKey IS exposed: the UI uses it to decide whether a one-click PDF
   * preview is available (image uploads only). The PDF endpoint
   * (`GET /documents/:id/download`) resolves pdfKey into bytes inside
   * the controller, so the client never needs to know the storage key
   * shape.
   *
   * Convert Decimal totals into JS numbers so JSON serialisation stays sane.
   */
  private sanitize(doc: any) {
    if (!doc) return doc;
    const { fileKey: _fileKey, fileHash: _fileHash, ...rest } = doc;
    return {
      ...rest,
      total: rest.total != null ? Number(rest.total) : null,
      taxAmount: rest.taxAmount != null ? Number(rest.taxAmount) : null,
      netAmount: rest.netAmount != null ? Number(rest.netAmount) : null,
    };
  }

  private stripUndefined<T extends object>(obj: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
  }

  /**
   * H-06 helper: detect Prisma unique-constraint violations so we can
   * convert them into a clean 409 instead of leaking a 500 to the client.
   * P2002 is the unique violation error code across all Prisma versions.
   */
  private isUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const anyErr = err as { code?: string; meta?: { code?: string } };
    return anyErr.code === 'P2002' || anyErr.meta?.code === 'P2002';
  }

  private extractExtension(name: string): string {
    // L1 hardening: reject path-traversal or NUL bytes before extracting.
    if (!name || name.includes('\0') || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return '';
    }
    const idx = name.lastIndexOf('.');
    if (idx < 0 || idx === name.length - 1) return '';
    const ext = name.slice(idx).toLowerCase();
    // Sanitize — only allow letters/digits, max 5 chars.
    if (!/^\.[a-z0-9]{1,5}$/.test(ext)) return '';
    return ext;
  }

  /**
   * Build a human-friendly file name for a Document row once we have
   * extracted the supplier / date / number. Pure function — no DB or
   * filesystem access. Exported only via the class (not as a static)
   * so it shares the sanitiser with the rest of the service.
   *
   * Rules:
   *   - When supplier AND docNumber are both present (we use docDate if
   *     available, else the upload's `now` as a fallback), produce
   *     `<SUPPLIER_NORMALIZED>_<YYYY-MM-DD>_<DOCNUMBER>.<ext>`.
   *   - When supplier or docNumber is missing, fall back to
   *     `doc_<docId><ext>` so the row still has a meaningful slug.
   *   - The extension is derived from `mimeType` when present (more
   *     reliable than the uploaded filename), otherwise from
   *     `currentFileName`. Always lower-case.
   *
   * Sanitisation:
   *   - Non-alphanumeric characters in the supplier/docNumber are
   *     collapsed into a single `-`. Leading/trailing dashes trimmed.
   *   - Whitespace collapsed to single spaces, then to `-`.
   *   - The result is capped at 200 chars for the stem + 6 for the ext
   *     to stay well under common filesystem limits.
   *   - Path-traversal (`..`, `/`, `\`, NUL) is stripped, never embedded.
   */
  buildDocumentFileName(args: {
    docId: string;
    supplier?: string | null;
    docNumber?: string | null;
    docDate?: Date | null | undefined;
    fallbackDate?: Date;
    mimeType?: string | null;
    currentFileName?: string | null;
  }): string {
    const ext = this.deriveExtensionFromMime(args.mimeType)
      || this.extractExtension(args.currentFileName ?? '')
      || '.bin';

    const supplierSlug = this.slugifySegment(args.supplier);
    const docNumberSlug = this.slugifySegment(args.docNumber);
    const dateSlug = this.formatDateSlug(
      args.docDate ?? args.fallbackDate ?? new Date(),
    );

    let stem: string;
    if (supplierSlug && docNumberSlug) {
      // Brief example is fully UPPERCASE: `AMERICO-ALVES_2026-07-31_FT-2026-1751`.
      // Date stays numeric (it isn't text). The extension keeps its
      // original case (`.pdf`, `.jpg`) to mirror how the user already
      // sees file extensions in the OS.
      stem = `${supplierSlug.toUpperCase()}_${dateSlug}_${docNumberSlug.toUpperCase()}`;
    } else {
      // Fallback: missing supplier or docNumber. Keep the docId so
      // every row still has a stable, meaningful filename.
      stem = `doc_${args.docId}`;
    }

    // Trim stem to a safe length so the total filename stays under
    // 250 chars even on weirdly long input.
    if (stem.length > 200) stem = stem.slice(0, 200);
    return `${stem}${ext}`;
  }

  /**
   * Update the document's stored fileName to a human-friendly slug
   * derived from the extracted fields. Idempotent: no-op when the
   * slug already matches the current `fileName`. Also no-op when the
   * supplier/docNumber/docDate combo yields no usable fields (we keep
   * the original upload-time name so the row is never blank).
   *
   * Returns the slug that was applied, or null when the rename was
   * skipped (no-op or no fields available).
   */
  async renameAfterExtraction(
    tenantId: string,
    documentId: string,
    fields: {
      supplier?: string | null;
      docNumber?: string | null;
      docDate?: Date | null;
    },
  ): Promise<string | null> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        supplier: true,
        docNumber: true,
        docDate: true,
      },
    });
    if (!doc) {
      // Caller will have already surfaced this elsewhere; just log here.
      this.logger.warn(
        `[rename] document=${documentId} tenant=${tenantId} not found`,
      );
      return null;
    }

    // Prefer freshly-extracted fields; fall back to the row values so
    // a re-run still produces a deterministic slug.
    const supplier = fields.supplier ?? doc.supplier ?? null;
    const docNumber = fields.docNumber ?? doc.docNumber ?? null;
    const docDate = fields.docDate ?? doc.docDate ?? null;

    if (!supplier || !docNumber) {
      // No usable fields yet — keep the original upload-time name.
      // Don't fall back to `doc_<id>` here; the user might still
      // re-extract later. Leaving the original preserves audit until
      // the rename can produce a real slug.
      return null;
    }

    const slug = this.buildDocumentFileName({
      docId: doc.id,
      supplier,
      docNumber,
      docDate,
      fallbackDate: doc.docDate ?? new Date(),
      mimeType: doc.mimeType,
      currentFileName: doc.fileName,
    });

    if (slug === doc.fileName) {
      // Already renamed — idempotent no-op.
      return null;
    }

    try {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { fileName: slug },
      });
      this.logger.log(
        `[rename] document=${doc.id} tenant=${tenantId} ` +
          `'${doc.fileName}' → '${slug}'`,
      );
      return slug;
    } catch (err) {
      // Don't let a rename failure abort the extraction pipeline —
      // log loud and let the row stay on the upload-time name.
      this.logger.warn(
        `[rename] FAILED for document=${doc.id} tenant=${tenantId}: ` +
          `${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Collapse a free-text segment (supplier name or doc number) into a
   * slug-safe form: A-Z, 0-9, dash; nothing else.
   *
   * Diacritics are folded to ASCII BEFORE the dash collapse, so
   * "Américo Alves" → "AMERICO-ALVES" (matching the brief's example)
   * rather than "AM-RICO-ALVES". We use Unicode NFD decomposition
   * + combining-mark strip so we cover accented Latin characters
   * without pulling in a locale-data dependency.
   */
  private slugifySegment(input?: string | null): string {
    if (!input) return '';
    // Strip NUL bytes and trim; collapse whitespace to single spaces.
    const cleaned = input
      .replace(/\0/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    // Fold diacritics: NFD splits "é" into "e" + combining acute,
    // then we drop combining marks. Result: "e" alone.
    const folded = cleaned.normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Replace anything that's not [A-Za-z0-9] with a single dash.
    const slugged = folded
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slugged;
  }

  /** Format a Date as `YYYY-MM-DD` (UTC, deterministic across TZ). */
  private formatDateSlug(d: Date): string {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      return this.formatDateSlug(new Date());
    }
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** Map a MIME type to a normalised extension; '' when we can't tell. */
  private deriveExtensionFromMime(mime?: string | null): string {
    if (!mime) return '';
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
    };
    return map[mime.toLowerCase()] ?? '';
  }

  /**
   * Build the on-disk storage key. Extracted so upload + tests share the
   * shape and the random suffix doesn't drift across paths.
   */
  private buildStorageKey(tenantId: string, fileName: string, now: Date): string {
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = this.extractExtension(fileName);
    return `${tenantId}/${yyyy}/${mm}/${Date.now()}-${crypto
      .randomBytes(8)
      .toString('hex')}${ext}`;
  }

  /**
   * Derive the PDF sibling key from an image key by stripping the
   * extension (`.jpg` / `.png` / `.jpeg`) and appending `.pdf`.
   * Examples:
   *   <tenant>/2026/08/1234-abcd.jpg → <tenant>/2026/08/1234-abcd.pdf
   *   <tenant>/2026/08/1234-abcd.png → <tenant>/2026/08/1234-abcd.pdf
   * Keeps the random suffix identical so the two files are obviously
   * the same document on disk.
   */
  private buildPdfKeyFromImageKey(imageKey: string): string {
    const lastSlash = imageKey.lastIndexOf('/');
    const dir = lastSlash >= 0 ? imageKey.slice(0, lastSlash + 1) : '';
    const base = lastSlash >= 0 ? imageKey.slice(lastSlash + 1) : imageKey;
    const lastDot = base.lastIndexOf('.');
    const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
    return `${dir}${stem}.pdf`;
  }

  private coerceType(input?: string): DocumentType {
    if (!input) return DocumentType.OUTRO;
    const allowed = Object.values(DocumentType) as string[];
    return (allowed.includes(input) ? input : DocumentType.OUTRO) as DocumentType;
  }

  // ─────────────────────────────────────────── filing metadata ────────
  //
  // The Document schema doesn't carry `expenseCategory` / `vatRateHint` as
  // top-level columns — they live inside `metadata.filing`. The IVA apuramento
  // (future) will read them from there. We add a thin wrapper so the rest of
  // the service can treat `metadata.filing` as a typed bag.

  private readFilingMetadata(metadata: Prisma.JsonValue | null | undefined): {
    expenseCategory?: ExpenseCategory | null;
    source?: 'ai' | 'user' | 'cleared';
    vatDeductibilityHint?: string;
  } {
    const filing = this.getNestedObject(metadata, 'filing');
    if (!filing) return {};
    return {
      expenseCategory: typeof filing.expenseCategory === 'string'
        ? (isExpenseCategory(filing.expenseCategory) ? filing.expenseCategory : null)
        : null,
      source: typeof filing.source === 'string'
        ? (filing.source as 'ai' | 'user' | 'cleared')
        : undefined,
      vatDeductibilityHint:
        typeof filing.vatDeductibilityHint === 'string' ? filing.vatDeductibilityHint : undefined,
    };
  }

  /**
   * Merge `patch` into metadata.filing and return the full new metadata
   * object. Preserves every other top-level key (extraction, supplierReview,
   * …) so this is non-destructive.
   */
  private writeFilingMetadata(
    metadata: Prisma.JsonValue | null | undefined,
    patch: {
      expenseCategory: ExpenseCategory | null;
      source: 'ai' | 'user' | 'cleared';
    },
  ): Prisma.InputJsonValue {
    const base = (metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const existingFiling = (base.filing && typeof base.filing === 'object' && !Array.isArray(base.filing)
      ? (base.filing as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    const nextFiling: Record<string, unknown> = { ...existingFiling };
    if (patch.expenseCategory === null) {
      delete nextFiling.expenseCategory;
      delete nextFiling.vatDeductibilityHint;
    } else {
      nextFiling.expenseCategory = patch.expenseCategory;
      nextFiling.vatDeductibilityHint = VAT_DEDUCTIBILITY_HINTS[patch.expenseCategory].reason;
    }
    nextFiling.source = patch.source;

    return {
      ...base,
      filing: nextFiling,
    } as Prisma.InputJsonValue;
  }

  /**
   * Safely walk into a JSON metadata bag. Returns the sub-object or
   * `undefined` when the chain doesn't exist.
   */
  private getNestedObject(
    metadata: Prisma.JsonValue | null | undefined,
    key: string,
  ): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const sub = (metadata as Record<string, unknown>)[key];
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return undefined;
    return sub as Record<string, unknown>;
  }

  /**
   * Find (or create) a Folder row matching the rendered path. Only used
   * for category-aware folders — explicit folderId assignments skip this
   * step. We split the path on `/` and walk the parentId chain so the
   * tree stays hierarchical (e.g. `/Despesas/Refeicoes/2026/08/`).
   */
  private async materialiseFolderPath(
    tenantId: string,
    folderPath: string,
  ): Promise<{ id: string } | null> {
    const segments = folderPath
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '_');
    if (segments.length === 0) return null;

    // Skip the trailing year/month segments when materialising — the
    // schema's @@unique([tenantId, name]) constraint means the same name
    // (`2026`, `08`) can only exist once per tenant. The year/month are
    // implicit in the Folder's child-of relationship anyway and the UI
    // tree groups by parent, so we don't need a per-year Folder row.
    //
    // Heuristic: drop the last 2 segments when they look like 4-digit
    // year + 2-digit month (the year/month pattern our engine always
    // appends). Everything before that is materialised.
    const materialiseSegments = segments.slice(
      0,
      this.stripYearMonthSuffix(segments) ? -2 : segments.length,
    );
    if (materialiseSegments.length === 0) return null;

    let parentId: string | null = null;
    let folder: { id: string } | null = null;
    for (const segment of materialiseSegments) {
      // findFirst tolerates both `parentId: null` and `parentId: undefined`
      // so we conditionally add the filter. Without `?? undefined`, the
      // wrapper extension would otherwise add an `IS NOT NULL` predicate
      // that excludes the root-level folder rows.
      const where: { tenantId: string; name: string; parentId?: string | null } =
        parentId == null
          ? { tenantId, name: segment }
          : { tenantId, name: segment, parentId };
      let found: { id: string } | null = await this.prisma.folder.findFirst({
        where,
        select: { id: true },
      });
      if (found) {
        folder = found;
      } else {
        try {
          const created: { id: string } = await this.prisma.folder.create({
            data: {
              tenantId,
              name: segment,
              parentId,
              pattern: folderPath,
            },
            select: { id: true },
          });
          folder = created;
        } catch (err) {
          // Race: another request created the same folder between our
          // findFirst and create. Re-read and use the winner. The
          // tenant-scope extension surfaces the underlying Prisma error
          // as a generic PrismaClientKnownRequestError; we detect on
          // the message as well as the code in case the wrapper
          // rewrapped it.
          const anyErr = err as { code?: string; message?: string };
          const isUniqueness =
            this.isUniqueViolation(err) ||
            (typeof anyErr.message === 'string' &&
              anyErr.message.includes('Unique constraint failed on the fields'));
          if (isUniqueness) {
            const winner = await this.prisma.folder.findFirst({
              where,
              select: { id: true },
            });
            if (!winner) throw err; // genuinely a non-uniqueness failure
            folder = winner;
          } else {
            throw err;
          }
        }
      }
      if (!folder) return null; // belt-and-braces — TS can't track the assignment
      parentId = folder.id;
    }
    return folder;
  }

  /**
   * True when the trailing two segments of a folder path look like
   * `YYYY` and `MM` (the engine always appends these for the date).
   * Used by `materialiseFolderPath` to decide whether to skip the
   * year/month segments — see comment there.
   */
  private stripYearMonthSuffix(segments: string[]): boolean {
    if (segments.length < 3) return false;
    const last = segments[segments.length - 1];
    const secondLast = segments[segments.length - 2];
    return /^\d{2}$/.test(last) && /^\d{4}$/.test(secondLast);
  }
}
