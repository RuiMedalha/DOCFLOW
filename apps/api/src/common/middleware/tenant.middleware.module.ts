import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';

/**
 * Standalone module so consumers (AppModule + tests) can apply the tenant
 * middleware with a single `.forRoutes('*')` call. Kept separate from
 * CommonModule to avoid pulling the whole common bag into feature modules
 * that only need the middleware.
 */
@Module({
  providers: [TenantMiddleware],
})
export class TenantMiddlewareModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
