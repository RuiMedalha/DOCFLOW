import { Injectable } from '@nestjs/common';
import IORedis from 'ioredis';

/**
 * Lazy Redis client used ONLY by the deep health probe.
 *
 * We deliberately do NOT add a second persistent connection to the API
 * process — the deep probe connects on demand and disconnects after the
 * PING. The hot path (jobs, cache) already uses the BullMQ-provided
 * Redis instance, so a healthy deep probe implies the production path
 * is healthy too.
 */
@Injectable()
export class RedisPingService {
  private readonly host = process.env.REDIS_HOST ?? 'localhost';
  private readonly port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
  private readonly password = process.env.REDIS_PASSWORD || undefined;

  async ping(): Promise<boolean> {
    const client = new IORedis({
      host: this.host,
      port: this.port,
      password: this.password,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });
    try {
      await client.connect();
      const res = await client.ping();
      return res === 'PONG';
    } catch {
      return false;
    } finally {
      client.disconnect();
    }
  }
}
