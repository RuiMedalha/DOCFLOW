import { forwardRef, Module } from '@nestjs/common';
import { DocumentsModule } from '../documents.module';
import { QueueModule } from '../../../common/queue/queue.module';
import { ProcessingService } from './processing.service';
import { ProcessingEventsStore } from './processing-events-store.service';

/**
 * ProcessingModule — wires the 4-stage pipeline.
 *
 *   - ProcessingService subscribes to `document.uploaded` / `.extracted`
 *     / `.enriched` / `.routed` on the QueueAdapter and drives each
 *     stage transition.
 *   - ProcessingEventsStore is the in-memory broadcaster consumed by
 *     the SSE controller.
 *
 * DocumentsModule is imported via forwardRef because both sides
 * reference each other (DocumentsService.approve ↔ ProcessingService).
 * In practice the cycle is mediated by the queue — the pipeline
 * publishes events back through the QueueAdapter, never by calling
 * DocumentsService methods on the same call stack — but the type
 * graph needs both sides.
 */
@Module({
  imports: [QueueModule, forwardRef(() => DocumentsModule)],
  providers: [ProcessingService, ProcessingEventsStore],
  exports: [ProcessingService, ProcessingEventsStore],
})
export class ProcessingModule {}
