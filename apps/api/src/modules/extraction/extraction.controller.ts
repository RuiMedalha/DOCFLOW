import { Body, Controller, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { TenantRequestContext } from '../../common/context/tenant-context';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { parseAtQr, validateAtQr, atQrToDocumentFields } from '@docflow/shared';
import { ExtractionService } from './extraction.service';
import { ExtractAtQrDto } from './dto/extract-qr.dto';
import { ParseAtQrDto } from './dto/parse-at-qr.dto';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_NAMES } from '../../common/throttle/throttle.constants';

/**
 * REST surface for the extraction module. All routes are mounted at the
 * global `/api/v1` prefix (see main.ts) — this controller adds the
 * `/extraction` segment.
 *
 * Auth: every route inherits the global JwtGuard + TenantGuard +
 * RbacGuard stack from app.module.ts. The async extraction trigger is
 * open to OPERADOR+; the OCR/QR ingest surface is admin/contabilidade.
 */
@ApiTags('extraction')
@ApiBearerAuth()
@Controller('extraction')
export class ExtractionController {
  constructor(private readonly extraction: ExtractionService) {}

  /**
   * Manual extraction trigger. With `?async=true` the job is enqueued
   * (returns 202-lite, queued:true); with no query the call is
   * synchronous (typical for small QR-only docs and CLI re-runs).
   *
   * Rate limit: 10 calls/min per tenant (bucket 'extract', tracker
   * keyed by tenantId via ThrottleBucketGuard). Protects the OCR
   * queue + tesseract worker pool from one tenant's burst.
   */
  @Throttle({ [THROTTLE_NAMES.EXTRACT]: { ttl: 60 * 1000, limit: 10 } })
  @Post('documents/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run extraction (QR + OCR) against an uploaded document.' })
  @ApiResponse({ status: 200, description: 'Extraction result (queued or inline).' })
  @ApiResponse({ status: 404, description: 'Document not found.' })
  trigger(
    @CurrentTenant() tenant: TenantRequestContext | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('async') asyncMode?: string,
  ) {
    if (!tenant) throw new Error('TenantContext required');
    return this.extraction.triggerForDocument(
      tenant.tenantId,
      user.id,
      id,
      { async: asyncMode === 'true' || asyncMode === '1' },
    );
  }

  /**
   * Apply a manually-captured AT QR payload. Used by the camera/scanner
   * UI on the PDF invoice detail page. Validates the QR before any write
   * — invalid payloads surface as a 400 with the validation reason.
   */
  @Post('documents/:id/at-qr')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply a captured AT-QR payload to a document.' })
  applyQr(
    @CurrentTenant() tenant: TenantRequestContext | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ExtractAtQrDto,
  ) {
    if (!tenant) throw new Error('TenantContext required');
    return this.extraction.applyAtQrPayload(tenant.tenantId, user.id, id, body.qrText);
  }

  /**
   * Parse + validate a QR payload without writing anything. Useful for
   * the camera preview UI: shows the user what will land before they
   * commit the capture to a Document.
   */
  @Post('at-qr/parse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parse + validate an AT-QR payload (no writes).' })
  parseQr(@Body() body: ParseAtQrDto) {
    const cleaned = (body.qrText ?? '').replace(/\s+/g, '');
    const parsed = parseAtQr(cleaned);
    if (!parsed) {
      return { valid: false, reason: 'payload_not_recognised' };
    }
    const validation = validateAtQr(parsed);
    return {
      valid: validation.ok,
      atQr: parsed,
      fields: atQrToDocumentFields(parsed),
      validation,
    };
  }
}
