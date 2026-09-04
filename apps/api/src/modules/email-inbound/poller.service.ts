import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { GmailService } from './gmail.service';
import { OutlookService } from './outlook.service';

/**
 * PollerService — every-5-minutes cron that iterates every active
 * `Integration(provider IN ['gmail','outlook'])` and calls the
 * relevant `pollTenant()`.
 *
 * Each per-tenant `lastSyncAt` is updated by the provider services, so
 * a retry of the same run won't double-process. `lastSyncStatus` in the
 * `Integration` row holds the previous successful sync marker.
 */
@Injectable()
export class PollerService {
  private readonly logger = new Logger(PollerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly outlook: OutlookService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollAll() {
    if (this.running) {
      this.logger.warn('email poller still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const integrations = await this.prisma.integration.findMany({
        where: {
          provider: { in: ['gmail', 'outlook'] },
          isActive: true,
        },
        select: { tenantId: true, provider: true },
      });
      for (const integration of integrations) {
        try {
          if (integration.provider === 'gmail') {
            await this.gmail.pollTenant(integration.tenantId);
          } else if (integration.provider === 'outlook') {
            await this.outlook.pollTenant(integration.tenantId);
          }
        } catch (err) {
          this.logger.error(
            `poller failed for ${integration.provider}/${integration.tenantId}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
