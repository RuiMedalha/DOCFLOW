import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisPingService } from './redis-ping.service';

/**
 * HealthController — two public probes, both @Public so monitors and
 * load balancers don't have to authenticate.
 *
 *   GET /api/v1/health        → cheap liveness (process up + DB SELECT 1)
 *   GET /api/v1/health/full   → deep readiness (DB + Redis + uptime + versions)
 *
 * Deep probe semantics:
 *  - Never includes error strings or connection strings in the response
 *    body — only "up"/"down" booleans.
 *  - Always returns HTTP 200 once the API process itself is alive. The
 *    readiness decision (mark the pod "NotReady" in K8s) should be made
 *    on the per-component flags, not on the HTTP status code.
 *  - A `degraded` status means one of the components is down. The process
 *    is still up, but it might fail higher-traffic requests.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisPing: RedisPingService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Liveness + DB ping',
    description:
      'Returns { status, db, ts }. `db` is "up" or "down" — never the error detail.',
  })
  async health(): Promise<{
    status: 'ok';
    db: 'up' | 'down';
    ts: string;
  }> {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw<unknown[]>`SELECT 1`;
    } catch (err) {
      db = 'down';
      this.logger.error(
        `Health DB ping failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { status: 'ok', db, ts: new Date().toISOString() };
  }

  @Get('full')
  @Public()
  @ApiOperation({
    summary: 'Deep readiness probe',
    description:
      'Returns DB + Redis state, uptime, build metadata. Always HTTP 200 — readiness lives in the per-component flags.',
  })
  async healthFull(): Promise<{
    status: 'ok' | 'degraded';
    components: {
      db: 'up' | 'down';
      redis: 'up' | 'down';
    };
    uptime_seconds: number;
    version: string;
    node_env: string;
    ts: string;
  }> {
    // DB ping
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw<unknown[]>`SELECT 1`;
    } catch (err) {
      db = 'down';
      this.logger.error(
        `Deep health DB ping failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Redis ping (lazy connect → disconnect)
    const redisOk = await this.redisPing.ping();
    const redis: 'up' | 'down' = redisOk ? 'up' : 'down';

    return {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      components: { db, redis },
      uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.APP_VERSION ?? '0.1.0',
      node_env: process.env.NODE_ENV ?? 'development',
      ts: new Date().toISOString(),
    };
  }
}
