import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottleBucketGuard } from './common/throttle/throttle-bucket.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import IORedis from 'ioredis';
import { RedisConnection, createIORedisClient } from 'bullmq';

// Prisma
import { PrismaModule } from './prisma/prisma.module';

// Common (guards, interceptors, filters, decorators, middleware)
import { CommonModule } from './common/common.module';
import { TenantMiddlewareModule } from './common/middleware/tenant.middleware.module';
import { JwtGuard } from './common/guards/jwt.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import {
  LoggingInterceptor,
  TenantInterceptor,
  TransformInterceptor,
} from './common/interceptors';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { CategoriesModule } from './modules/documents/categories.module';
import { AiModule } from './modules/ai/ai.module';
import { InboundModule } from './modules/inbound/inbound.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { EmailInboundModule } from './modules/email-inbound/email-inbound.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExtractionModule } from './modules/extraction/extraction.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PartyCategoriesModule } from './modules/party-categories/party-categories.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { BankingModule } from './modules/banking/banking.module';
import { CrmModule } from './modules/crm/crm.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { TaxSimulatorModule } from './modules/tax-simulator/tax-simulator.module';
import { HealthModule } from './modules/health/health.module';
// Sprint H — async processing pipeline.
import { ProcessingModule } from './modules/documents/processing/processing.module';
import { TenantsModule } from './modules/tenants/tenants.module';
// Sprint I — external-API enrichment (Sabi PT / VIES / manual).
import { EnrichmentModule } from './modules/enrichment/enrichment.module';
// QueueModule is global-with-factory; we MUST call .forRoot() here so
// ProcessingService can resolve the QueueAdapter at construction time.
import { QueueModule } from './common/queue/queue.module';

@Module({
  imports: [
    // Config & infra
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([
      // Global fallback â€” applies to every route that doesn't override.
      {
        name: 'global',
        ttl: parseInt(process.env.THROTTLE_TTL || '60') * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT || '100'),
      },
      // /auth/login  â†’ keyed by IP (ThrottleBucketGuard).
      // Production: 5 attempts / 15 min (brute-force defence).
      // Non-prod: relaxed to 50 so local UAT / demos are not locked out.
      {
        name: 'login',
        ttl: 15 * 60 * 1000,
        limit: process.env.NODE_ENV === 'production' ? 5 : 50,
      },
      // /extraction  â†’ 10 per min, keyed by tenant (ThrottleBucketGuard).
      {
        name: 'extract',
        ttl: 60 * 1000,
        limit: 10,
      },
      // /exports     â†’ 1 per min, keyed by user (ThrottleBucketGuard).
      {
        name: 'export',
        ttl: 60 * 1000,
        limit: 1,
      },
      // /parties/:id/contacts + /parties/:id/addresses POST/PATCH/DELETE
      // (Sprint G review §4-A fix-up). 30/min/tenant — tighter than the
      // global 100/60s default, still leaves headroom for power users
      // doing bulk edits, but makes a runaway script hit 429 before
      // it can spam master-data CRUD.
      {
        name: 'master-write',
        ttl: 60 * 1000,
        limit: 30,
      },
    ]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        // BullMQ >=6 lazy-loads ioredis from CJS contexts; on this Windows box
        // that fails because the dynamic import lands in an ESM-only resolution
        // path. Pre-install a clientFactory that hands BullMQ our already
        // resolved ioredis instance, wrapped with createIORedisClient so the
        // client exposes runCommand (Lua dispatch) per the IRedisClient contract.
        RedisConnection.clientFactory = ((opts: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return createIORedisClient(
            new IORedis({
              ...opts,
              lazyConnect: true,
              maxRetriesPerRequest: null,
            }),
          ) as any;
        }) as any;
        return {
          connection: {
            host,
            port,
            lazyConnect: true,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),

    // Core
    PrismaModule,
    CommonModule,
    TenantMiddlewareModule,

    // Features
    AuthModule,
    DocumentsModule,
    CategoriesModule,
    AiModule,
    InboundModule,
    ScannerModule,
    EmailInboundModule,
    ExtractionModule,
    ReconciliationModule,
    AuditModule,
    BankingModule,
    PartiesModule,
    PartyCategoriesModule,
    IntegrationsModule,
    CrmModule,
    PaymentsModule,
    PayrollModule,
    FleetModule,
    TaxSimulatorModule,
    HealthModule,
    // Sprint H — wire the queue + the processing pipeline. QueueModule
    // is `global: true` after .forRoot() so any module that injects
    // QueueAdapter can find it. ProcessingModule owns the SSE controller.
    QueueModule.forRoot(),
    ProcessingModule,
    TenantsModule,
    EnrichmentModule,
  ],
  providers: [
    // Global rate-limit guard (custom: tracks by IP/tenant/user via ThrottleBucketGuard)
    { provide: APP_GUARD, useClass: ThrottleBucketGuard },
    // Auth stack: JWT â†’ Tenant â†’ RBAC. Order matters.
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    // Global response/error pipeline.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
