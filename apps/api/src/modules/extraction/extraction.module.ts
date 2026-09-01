import {
  Module,
  Logger,
  Global,
  forwardRef,
} from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../documents/storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExtractionController } from './extraction.controller';
import { ExtractionProcessor } from './extraction.processor';
import { ExtractionService } from './extraction.service';
import { SupplierResolver } from './supplier-resolver';
import { EXTRACTION_QUEUE, EXTRACTION_QUEUE_OPTIONS } from './extraction.constants';

/**
 * ExtractionModule — owns the AT-QR decode + OCR + IBAN anti-fraud flow.
 *
 * Design choices:
 *   - BullMQ is OPTIONAL. We register the queue+worker only when Redis
 *     is reachable; otherwise ExtractionService falls back to in-process
 *     execution so the API still works for one-off uploads. The
 *     producer-side `Queue` is `@Optional()` and tolerates `null`.
 *   - StorageModule is imported so the service can pull document bytes
 *     for OCR. We bind the storage port under a string token to keep
 *     the dependency loose (the storage module exports its own symbol).
 *   - PrismaModule is global — no need to re-import for tenant scoping.
 *   - DocumentsModule is imported via forwardRef so ExtractionService
 *     can call FolderRulesEngine to auto-file a well-read invoice into
 *     the right accounting folder when the AI supplied an SNC category.
 *     DocumentsModule also imports ExtractionModule (it triggers
 *     extraction on upload); forwardRef resolves the cycle.
 *
 * The auto-trigger hook is exported as `ExtractionService` and consumed
 * by the inbound/documents modules on successful Document creation.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AiModule,
    forwardRef(() => DocumentsModule),
    BullModule.registerQueueAsync({
      name: EXTRACTION_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST') ?? 'localhost';
        const port = parseInt(config.get<string>('REDIS_PORT') ?? '6379', 10);
        // lazyConnect + maxRetriesPerRequest:null keeps the worker
        // alive when Redis is down at boot. Failures come back as
        // `Error: ECONNREFUSED` from `queue.add()` — the service
        // catches them and runs sync.
        return {
          connection: { host, port, lazyConnect: true, maxRetriesPerRequest: null },
          defaultJobOptions: {
            attempts: EXTRACTION_QUEUE_OPTIONS.attempts,
            backoff: { type: 'exponential', delay: EXTRACTION_QUEUE_OPTIONS.backoffMs },
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        };
      },
    }),
  ],
  controllers: [ExtractionController],
  providers: [ExtractionService, ExtractionProcessor, SupplierResolver],
  exports: [ExtractionService, SupplierResolver, BullModule],
})
export class ExtractionModule {
  private readonly logger = new Logger(ExtractionModule.name);

  constructor() {
    this.logger.log(
      'ExtractionModule loaded — AT-QR + OCR + IBAN anti-fraud active ' +
        '(BullMQ background worker active when Redis is reachable)',
    );
  }
}
