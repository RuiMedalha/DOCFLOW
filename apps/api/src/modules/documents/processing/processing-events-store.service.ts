import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Single in-memory event payload broadcast by the processing
 * pipeline. Stages (EXTRACTING, ENRICHING, ROUTING) emit
 * `processing.stage.completed`; the terminal stages emit either
 * `processing.completed` (success) or `processing.failed`.
 *
 * `payload` carries whatever the stage wants to expose — its content
 * is intentionally untyped here. The SSE controller decides what to
 * ship; this service just stores + forwards.
 */
export interface ProcessingStageEvent {
  documentId: string;
  tenantId: string;
  stage: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Maximum number of in-flight documents we hold subjects for. Once
 * the cap is reached, the OLDEST entry is dropped (its subscribers
 * see a `complete()` notification so they tear down cleanly).
 *
 * Defensive cap against memory leaks from SSE clients that forget
 * to close. The hard ceiling sits well above any realistic workload.
 */
const MAX_CONCURRENT_DOCS = 1000;

/**
 * ProcessingEventsStore — the in-memory broadcaster that the SSE
 * controller wraps.
 *
 * One Subject per active document. Subscribers receive every event
 * the pipeline emits for that doc until they unsubscribe (or the
 * pipeline completes and `drop()` is called, which `complete()`s the
 * Subject). Multiple subscribers on the same doc all see every event.
 *
 * Terminal events (`processing.completed` / `processing.failed`)
 * also `complete()` the Subject — the SSE controller uses this to
 * know when to close the connection.
 */
@Injectable()
export class ProcessingEventsStore implements OnModuleDestroy {
  private readonly subjectsByDoc = new Map<string, Subject<ProcessingStageEvent>>();

  /**
   * Open (or reuse) the Subject for `documentId` and return an
   * Observable view. The Observable is hot — events emitted before
   * a given subscriber subscribes are NOT replayed.
   */
  stream(documentId: string): Observable<ProcessingStageEvent> {
    let subject = this.subjectsByDoc.get(documentId);
    if (!subject) {
      subject = new Subject<ProcessingStageEvent>();
      this.subjectsByDoc.set(documentId, subject);
      this.evictIfOverCap();
    }
    return subject.asObservable();
  }

  /**
   * Broadcast an event to every active subscriber on `event.documentId`.
   * Emitting for a docId with no subscribers is a cheap no-op (the
   * Map lookup misses, nothing happens).
   */
  emit(event: ProcessingStageEvent): void {
    const subject = this.subjectsByDoc.get(event.documentId);
    if (!subject) return;
    subject.next(event);
    if (event.event === 'processing.completed' || event.event === 'processing.failed') {
      this.drop(event.documentId);
    }
  }

  /**
   * Force-complete the Subject for `documentId` and remove it from
   * the map. Idempotent — calling twice for the same id is a no-op.
   */
  drop(documentId: string): void {
    const subject = this.subjectsByDoc.get(documentId);
    if (!subject) return;
    subject.complete();
    this.subjectsByDoc.delete(documentId);
  }

  /**
   * Module teardown — complete every Subject so SSE controllers can
   * clean up. Subscribers' `complete()` callbacks fire synchronously.
   */
  onModuleDestroy(): void {
    for (const subject of this.subjectsByDoc.values()) {
      subject.complete();
    }
    this.subjectsByDoc.clear();
  }

  private evictIfOverCap(): void {
    if (this.subjectsByDoc.size <= MAX_CONCURRENT_DOCS) return;
    // Map iteration order is insertion order — drop the oldest
    // entry. Better to lose a finished-event subscriber than a
    // fresh one.
    const oldestKey = this.subjectsByDoc.keys().next().value;
    if (oldestKey !== undefined) this.drop(oldestKey);
  }
}
