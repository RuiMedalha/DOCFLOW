import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global AuditModule — every other module can inject `AuditService`
 * without having to add `AuditModule` to its `imports[]`.
 *
 * Keeping it `@Global()` is the whole point: this module exists to remove
 * the "remember to import the helper" footgun. Without the global flag,
 * the next builder who forgets to add AuditModule to their imports[] is
 * right back where we started — tsc errors and broken chains.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}