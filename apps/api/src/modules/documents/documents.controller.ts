import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentOrigin } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DocumentsService, ALLOWED_MIMES, MAX_UPLOAD_BYTES } from './documents.service';
import {
  AssignFolderDto,
  DocumentQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/document.dto';

/**
 * DocumentsController — REST surface for the inbox.
 *
 * Routes:
 *   POST   /documents/upload       — multipart upload
 *   GET    /documents              — paginated list (all statuses)
 *   GET    /documents/inbox        — paginated list, status=NOVO shortcut
 *   GET    /documents/:id          — detail
 *   PATCH  /documents/:id          — partial metadata update
 *   PATCH  /documents/:id/folder   — explicit folder assignment
 *   GET    /documents/:id/download — bytes stream (authenticated)
 *   GET    /documents/:id/url      — signed URL (or local route)
 *   DELETE /documents/:id          — soft-delete (status=ARQUIVADO)
 *
 * Auth is enforced by the global JwtGuard + TenantGuard (APP_GUARD).
 * Tenant scoping is automatic via the Prisma extension — every Prisma
 * call here goes through `prisma.scoped`.
 */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // ─────────────────────────────────────────── upload ──────────────────

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload a document to the inbox',
    description:
      'Accepts PDF/JPG/PNG/DOCX up to 20MB. The SHA-256 of the bytes is computed and used for per-tenant duplicate detection. The folder-rules engine assigns `finalFolder` on creation.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        origin: {
          type: 'string',
          enum: Object.values(DocumentOrigin),
          default: 'UPLOAD',
        },
        type: { type: 'string', description: 'Pre-classify (optional)' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Document stored and indexed' })
  @ApiResponse({ status: 400, description: 'Invalid file (type or size)' })
  @ApiResponse({ status: 409, description: 'Duplicate document detected' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.documents.upload(
      user.tenantId,
      user.id,
      {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      dto.origin,
      dto.type,
    );
  }

  // ─────────────────────────────────────────── listings ────────────────

  @Get()
  @ApiOperation({
    summary: 'List documents',
    description:
      'Paginated listing with optional status/type/date/party/search filters. Soft-deleted rows (ARQUIVADO) are excluded by default.',
  })
  @ApiQuery({ name: 'status', required: false, enum: DocumentOrigin })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DocumentQueryDto,
  ) {
    return this.documents.findAll(user.tenantId, query);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'List inbox documents (status=NOVO)' })
  findInbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DocumentQueryDto,
  ) {
    return this.documents.findInbox(user.tenantId, query);
  }

  @Get('folders')
  @ApiOperation({
    summary: 'List folders for the inbox sidebar',
    description:
      'Returns tenant-scoped folders (id, name, color). Empty list if the tenant has not created any folders yet.',
  })
  @ApiResponse({ status: 200, description: 'Folder list (possibly empty)' })
  async listFolders(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listFolders(user.tenantId);
  }

  // ─────────────────────────────────────────── detail ───────────────────

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.APPROVER)
  @ApiOperation({ summary: 'Approve a document' })
  @ApiResponse({ status: 200, description: 'Document approved' })
  @ApiResponse({ status: 409, description: 'Document cannot be approved in its current status' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.approve(user.tenantId, user.id, id);
  }

  @Post(':id/re-extract')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.ADMIN, Role.OPERADOR)
  @ApiOperation({
    summary: 'Re-run the extraction + enrichment pipeline on an existing document',
    description:
      'Resets the document\'s processingStatus to RECEIVED and re-publishes `document.uploaded` so the 4-stage pipeline (RECEIVED → EXTRACTING → ENRICHING → COMPLETED) re-runs end-to-end. The actual extraction work happens asynchronously — clients observe progress via the SSE channel.',
  })
  @ApiResponse({ status: 202, description: 'Re-extraction queued' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async reExtract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ documentId: string; status: 're-extraction triggered' }> {
    const doc = await this.documents.reExtract(user.tenantId, user.id, id);
    return { documentId: doc.id, status: 're-extraction triggered' };
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'List document line items' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  listItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.listItems(user.tenantId, id);
  }

  @Post(':id/items')
  @Roles(Role.ADMIN, Role.OPERADOR)
  @ApiOperation({ summary: 'Add a new line item to a document' })
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { description: string; quantity?: number; unitPrice?: number; discount?: number; taxRate?: number; code?: string },
  ) {
    return this.documents.addItem(user.tenantId, id, body);
  }

  @Patch(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.OPERADOR)
  @ApiOperation({ summary: 'Update a line item (qty / price / discount / taxRate) and recompute totals' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { description?: string; quantity?: number; unitPrice?: number; discount?: number; taxRate?: number },
  ) {
    return this.documents.updateItem(user.tenantId, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.OPERADOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a line item' })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.documents.removeItem(user.tenantId, id, itemId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document detail (without file bytes)' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.findOne(user.tenantId, id);
  }

  // ─────────────────────────────────────────── update ───────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update document metadata',
    description:
      'Partial update. Changing `type` or `supplier` re-runs the folder-rules engine and updates `suggestedFolder` / `finalFolder`.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(user.tenantId, user.id, id, dto);
  }

  @Patch(':id/folder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign a document to a folder',
    description:
      'Explicit folder assignment (UI drag-and-drop). Pass `folderId: null` to clear and let the rules engine re-suggest.',
  })
  assignFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignFolderDto,
  ) {
    return this.documents.assignFolder(user.tenantId, user.id, id, dto.folderId ?? null);
  }

  // ─────────────────────────────────────────── download ─────────────────

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download the document file',
    description:
      'Streams the stored bytes back. For image uploads, `?format=pdf` (the default for images) returns the generated PDF derivative so the UI / browser can preview it natively; `?format=original` returns the original photo bytes. For PDFs and other non-image uploads, both formats return the same stored file.',
  })
  @ApiResponse({ status: 200, description: 'File bytes (binary)' })
  @ApiResponse({ status: 404, description: 'Document or file blob not found' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const wantPdf = format !== 'original';
    const { buffer, mimeType, fileName } = await this.documents.getFileBuffer(
      user.tenantId,
      id,
      wantPdf ? 'pdf' : 'original',
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${this.sanitizeFilename(fileName)}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Get(':id/url')
  @ApiOperation({
    summary: 'Get a URL the client can use to fetch the file',
    description:
      'Local driver returns the controller download route. S3/MinIO driver returns a presigned URL with TTL.',
  })
  getFileUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.getFileUrl(user.tenantId, id);
  }

  // ─────────────────────────────────────────── delete ───────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a document',
    description:
      'Marks the row as ARQUIVADO; the file stays on disk for audit. The default listing excludes ARQUIVADO rows.',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.documents.softDelete(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── helpers ──────────────────

  /**
   * Quote a filename so a Content-Disposition header stays safe against
   * header-splitting / encoding attacks. We keep ASCII letters, digits,
   * dot, dash, underscore — anything else is folded to `_`.
   *
   * L1 hardening: even though the storage layer already rejects
   * path-traversal attempts via `resolveSafe`, we strip `..` and any path
   * separator BEFORE reaching the storage backend as a defence-in-depth
   * measure against edge cases (e.g. NUL bytes, mixed slashes).
   */
  private sanitizeFilename(name: string): string {
    if (typeof name !== 'string' || name.length === 0) return 'file';
    if (name.includes('\0') || name.includes('..')) {
      return 'file';
    }
    return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
  }
}
