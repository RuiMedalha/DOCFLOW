import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { TenantRequestContext } from '../../common/context/tenant-context';
import { assertCronSecret } from '../../common/auth/cron-secret';
import { ImapConfigDto } from './dto/imap-config.dto';
import { InboundService } from './inbound.service';

const uploadOptions = { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 20 } };

@ApiTags('Inbound')
@Controller('inbound')
export class InboundController {
  constructor(private readonly inboundService: InboundService) {}

  @Post('mail/config')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Store the current tenant IMAP mailbox configuration' })
  saveImapConfig(@CurrentTenant() tenant: TenantRequestContext, @Body() dto: ImapConfigDto) {
    return this.inboundService.saveImapConfig(tenant.tenantId, dto);
  }

  @Public()
  @SkipThrottle() // cron-controlled, signature already enforced
  @Post('mail/sync-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cron-only sync of every configured IMAP mailbox' })
  syncAll(@Headers('x-cron-secret') secret: string | undefined) {
    // Constant-time compare to avoid leaking the secret byte-by-byte via
    // timing. The previous `!==` short-circuited on the first differing
    // byte. Audit finding §5.2 of AUDIT-REPORT.md (MEDIUM).
    if (!assertCronSecret(secret, process.env.CRON_SECRET)) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return this.inboundService.syncAll();
  }

  @Public()
  @SkipThrottle() // signature-verified; per-IP throttling delegated to WAF
  @Post('email')
  @HttpCode(200)
  @UseInterceptors(AnyFilesInterceptor(uploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'SendGrid/Mailgun inbound parse webhook' })
  email(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    // C-10: forward the raw request bytes so the inbound service can
    // recompute the SendGrid HMAC over the ORIGINAL multipart payload
    // — body parsing alone is not enough because Nest/multer has already
    // mutated the field order and binary boundaries by the time @Body()
    // fires.
    const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
    const headers = req.headers as Record<string, unknown> & {
      rawBody?: Buffer | string;
    };
    if (rawBody !== undefined) headers.rawBody = rawBody;
    return this.inboundService.ingestWebhookEmail(
      body,
      files ?? [],
      headers,
    );
  }

  // M4 fix: hard rate limit the scanner endpoint. scanToken is a single-factor
  // shared secret; without throttling it is trivially brute-forceable.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('scan')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Token-authenticated scanner drop endpoint' })
  scan(
    @Headers('x-scan-token') scanToken: string | undefined,
    @Req() request: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const bearer = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice('Bearer '.length)
      : undefined;
    return this.inboundService.ingestScanner(scanToken ?? bearer, file);
  }
}
