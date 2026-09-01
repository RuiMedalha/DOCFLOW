import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { getTenantContext } from '../context/tenant-context';

/**
 * Per-request structured log line. Emits ONE summary line per request,
 * including latency, status code (when available) and tenant/user ids.
 *
 * Errors are logged at `error` level and re-thrown so the exception filter
 * sees them. Successes are at `log` level. Both flows include requestId
 * so the line can be grepped alongside the audit log / exception entry.
 *
 * The TenantInterceptor covers the same data; this one is here so feature
 * modules that don't want the response-header side-effect still get logs.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const ctx = getTenantContext();

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - start;
        this.logger.log(
          `[${ctx?.requestId ?? '-'}] ${req.method} ${req.url} ` +
            `tenant=${ctx?.tenantId ?? 'public'} user=${ctx?.userId ?? 'anonymous'} ` +
            `→ ${http.getResponse().statusCode} ${elapsed}ms`,
        );
      }),
      catchError((err) => {
        const elapsed = Date.now() - start;
        this.logger.error(
          `[${ctx?.requestId ?? '-'}] ${req.method} ${req.url} ` +
            `tenant=${ctx?.tenantId ?? 'public'} user=${ctx?.userId ?? 'anonymous'} ` +
            `→ ERROR ${elapsed}ms: ${err?.message ?? String(err)}`,
        );
        return throwError(() => err);
      }),
    );
  }
}