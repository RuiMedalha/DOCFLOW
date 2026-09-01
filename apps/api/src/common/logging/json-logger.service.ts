import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { getTenantContext } from '../context/tenant-context';

/**
 * Structured JSON logger.
 *
 * Replaces Nest's default Logger for the *runtime path* in production. Each
 * call emits a single JSON object on stdout with these fields:
 *   ts, level, context, msg, requestId, tenantId, userId, ...extras
 *
 * Activate by setting `LOG_FORMAT=json` (already wired in main.ts).
 * In development we keep the human-readable pretty logs so developers
 * don't have to JSON-parse during local runs.
 *
 * Implementation notes:
 *  - Per-request context (requestId/tenant/user) is read from AsyncLocalStorage
 *    so we don't have to thread it through every service call.
 *  - Scope.DEFAULT — there is exactly ONE logger per process; per-request
 *    context comes from ALS, not from DI scope.
 *  - The Logger.error/warn overloads accept an optional Error object as a
 *    second arg — we serialise its stack into the structured record so that
 *    log aggregators (Loki, ELK) can index by file/line.
 */
@Injectable({ scope: Scope.DEFAULT })
export class JsonLogger implements LoggerService {
  private readonly pretty: boolean;

  constructor() {
    this.pretty = process.env.LOG_FORMAT !== 'json';
  }

  log(message: any, context?: string): void {
    this.write('info', message, context);
  }
  error(message: any, trace?: string | Error, context?: string): void {
    const errTrace = trace instanceof Error ? trace.stack : trace;
    this.write('error', message, context, { trace: errTrace });
  }
  warn(message: any, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: any, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: any, context?: string): void {
    this.write('verbose', message, context);
  }
  fatal(message: any, context?: string): void {
    this.write('fatal', message, context);
  }
  setLogLevels?(): void {
    /* noop — Nest default levels are fine */
  }

  // ─────────────── internal ───────────────
  private write(
    level: string,
    message: unknown,
    context?: string,
    extras: Record<string, unknown> = {},
  ): void {
    const ctx = getTenantContext();
    const safeMessage =
      typeof message === 'string'
        ? message
        : (() => {
            try {
              return JSON.stringify(message);
            } catch {
              return String(message);
            }
          })();

    const record = {
      ts: new Date().toISOString(),
      level,
      context: context ?? 'App',
      msg: safeMessage,
      requestId: ctx?.requestId,
      tenantId: ctx?.tenantId,
      userId: ctx?.userId,
      ...extras,
    };

    if (this.pretty) {
      // Human-readable — same shape as Nest's default logger, so devs
      // see the same lines locally and in production-tail.
      const ctx2 = record.context;
      const reqId = record.requestId ? `[${record.requestId}] ` : '';
      const tenant = record.tenantId ? `tenant=${record.tenantId} ` : '';
      const user = record.userId ? `user=${record.userId} ` : '';
      const stack = extras.trace ? `\n${extras.trace}` : '';
      // eslint-disable-next-line no-console
      console.log(`${level.toUpperCase().padEnd(5)} [${ctx2}] ${reqId}${tenant}${user}${safeMessage}${stack}`);
      return;
    }

    // JSON one-liner for prod aggregators (Loki, ELK, Datadog).
    // eslint-disable-next-line no-console
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}