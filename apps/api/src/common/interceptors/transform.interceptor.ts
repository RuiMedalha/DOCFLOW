import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { getTenantContext } from '../context/tenant-context';

export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    tenantId?: string;
    timestamp: string;
  };
}

/**
 * Wraps every successful response in a uniform envelope:
 *
 *   { "data": <controller-return>, "meta": { requestId, tenantId, timestamp } }
 *
 * Controllers can keep returning plain domain objects; the client gets
 * pagination meta + request correlation for free. Controllers that need to
 * return raw bytes (file streams) can opt out by setting
 * `@Res({ passthrough: false })` instead of going through this pipe.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T>> {
    const ctx = getTenantContext();
    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {
          requestId: ctx?.requestId ?? 'unknown',
          tenantId: ctx?.tenantId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}