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
 *
 * Concurrency: Gmail and Outlook are polled in parallel
 * (`Promise.allSettled`) so a slow/hung provider does not starve the
 * other. Each provider has its own in-progress flag so a re-entrant
 * tick can't double-schedule the same workload.
 */
@Injectable()
export class PollerService {
  private readonly logger = new Logger(PollerService.name);
  private gmailRunning = false;
  private outlookRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly outlook: OutlookService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollAll() {
    if (this.gmailRunning || this.outlookRunning) {
      this.logger.warn('email poller still running — skipping this tick');
      return;
    }
    this.gmailRunning = true;
    this.outlookRunning = true;
    try {
      await Promise.allSettled([
        this.pollProvider('gmail'),
        this.pollProvider('outlook'),
      ]);
    } finally {
      this.gmailRunning = false;
      this.outlookRunning = false;
    }
  }

  private async pollProvider(provider: 'gmail' | 'outlook'): Promise<void> {
    const integrations = await this.prisma.integration.findMany({
      where: { provider, isActive: true },
      select: { tenantId: true },
    });
    for (const integration of integrations) {
      try {
        if (provider === 'gmail') {
          await this.gmail.pollTenant(integration.tenantId);
        } else {
          await this.outlook.pollTenant(integration.tenantId);
        }
      } catch (err) {
        this.logger.error(
          `poller failed for ${provider}/${integration.tenantId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
