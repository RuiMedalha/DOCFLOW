import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtGuard } from './guards/jwt.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RbacGuard } from './guards/rbac.guard';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TenantInterceptor } from './interceptors/tenant.interceptor';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { buildJwtConfig } from './jwt.config';

/**
 * The shared infra bag:
 *   - guards: JwtGuard, TenantGuard, RbacGuard
 *   - filters: AllExceptionsFilter
 *   - interceptors: LoggingInterceptor, TenantInterceptor, TransformInterceptor
 *
 * JwtModule is registered here so the JwtGuard (used as APP_GUARD globally)
 * has access to JwtService. AuthModule reuses the same config from
 * common/jwt.config.ts to ensure tokens issued there validate here.
 *
 * Decorators (@CurrentUser, @CurrentTenant, @Roles, @Public) and middleware
 * are exported as plain functions — no DI required.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildJwtConfig,
    }),
  ],
  providers: [
    JwtGuard,
    TenantGuard,
    RbacGuard,
    AllExceptionsFilter,
    LoggingInterceptor,
    TenantInterceptor,
    TransformInterceptor,
  ],
  exports: [
    JwtModule,
    JwtGuard,
    TenantGuard,
    RbacGuard,
    AllExceptionsFilter,
    LoggingInterceptor,
    TenantInterceptor,
    TransformInterceptor,
  ],
})
export class CommonModule {}