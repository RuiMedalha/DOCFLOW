import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service';
import { PartiesController } from './parties.controller';

/**
 * PartiesModule — supplier/customer master + PT chart of accounts + IBAN
 * anti-fraud helpers.
 *
 * AuditModule is GLOBAL so we don't need to import it here — `AuditService`
 * is resolvable from anywhere in the DI tree. PrismaModule is the same.
 *
 * Exports PartiesService so other modules (Documents when assigning a
 * supplier, Extraction when matching a NIF, etc.) can reach into it.
 */
@Module({
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}