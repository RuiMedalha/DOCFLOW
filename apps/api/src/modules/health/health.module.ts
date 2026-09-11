import { Module } from '@nestjs/common';
import { StorageModule } from '../documents/storage/storage.module';
import { HealthController } from './health.controller';
import { RedisPingService } from './redis-ping.service';

/**
 * HealthModule — public liveness + readiness probes used by load balancers,
 * uptime monitors (healthchecks.io) and Kubernetes.
 *
 * Both routes are @Public, PrismaModule is global so the DB ping resolves
 * automatically, and RedisPingService lazy-connects on every call so we
 * don't keep a second persistent connection in the API process.
 */
@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [RedisPingService],
})
export class HealthModule {}