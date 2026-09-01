import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';
import { runWithTenantContext, TenantRequestContext } from '../../common/context/tenant-context';
import { ExtractionService } from './extraction.service';
import {
  EXTRACTION_QUEUE,
  EXTRACTION_QUEUE_OPTIONS,
  ExtractionJob,
  ExtractionJobResult,
} from './extraction.constants';

/**
 * Background worker — drains the `extraction` queue, runs each job inside
 * a synthetic TenantContext (the Prisma tenant-scope requires one), and
 * surfaces failures back to BullMQ for retry.
 *
 * Redis at localhost:6379 may be unreachable in dev/CI. The processor
 * registers itself but never blocks module boot — BullMQ's Worker
 * swallows connection errors and keeps trying.
 */
@Processor(EXTRACTION_QUEUE, {
  concurrency: 2,
  lockDuration: 60_000,
})
export class ExtractionProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(private readonly extraction: ExtractionService) {
    super();
  }

  async process(job: Job<ExtractionJob, ExtractionJobResult>): Promise<ExtractionJobResult> {
    const { tenantId, userId } = job.data;

    // Prisma's tenant extension refuses queries without a context, so
    // wrap the work in a synthetic TenantContext. The JWT guard is not
    // on this path — the worker runs outside the HTTP layer.
    const ctx: TenantRequestContext = {
      tenantId,
      userId: userId ?? 'system',
      roles: ['SYSTEM'],
      requestId: `job:${job.id}`,
      sessionId: undefined,
    };

    return runWithTenantContext(ctx, () =>
      this.extraction.processDocumentAsync(job.data),
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ExtractionJob, ExtractionJobResult>): void {
    this.logger.log(
      `[${job.id}] document=${job.data.documentId} source=${job.returnvalue?.source ?? 'n/a'} ` +
        `confidence=${job.returnvalue?.confidence?.toFixed(2) ?? 'n/a'}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExtractionJob> | undefined, err: Error): void {
    this.logger.error(
      `[${job?.id ?? 'unknown'}] document=${job?.data?.documentId ?? 'unknown'} failed: ${err.message}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.worker?.close();
    } catch (err) {
      this.logger.warn(`Worker close: ${(err as Error).message}`);
    }
  }
}
