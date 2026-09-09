import { Module, forwardRef } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboundModule } from '../inbound/inbound.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { GmailService } from './gmail.service';
import { OutlookService } from './outlook.service';
import { PollerService } from './poller.service';
import { OAuthController } from './oauth.controller';

/**
 * EmailInboundModule — Gmail + Outlook OAuth and polling.
 *
 * Imports:
 *   - `IntegrationsModule` — reuses `OAuthStateStore` (Prisma-backed,
 *     restart-safe CSRF state) and the existing `INTEGRATION_ENC_KEY`
 *     pattern.
 *   - `InboundModule` (via `forwardRef`) — calls `ingestFiles()` to
 *     persist PDF/PNG/JPG/DOCX attachments through the standard
 *     pipeline with `origin: GMAIL|OUTLOOK`.
 *
 * Exports the provider services for testing.
 */
@Module({
  imports: [
    PrismaModule,
    IntegrationsModule,
    forwardRef(() => InboundModule),
  ],
  controllers: [OAuthController],
  providers: [GmailService, OutlookService, PollerService],
  exports: [GmailService, OutlookService],
})
export class EmailInboundModule {}
