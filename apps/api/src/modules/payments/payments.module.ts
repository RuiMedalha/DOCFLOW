import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * PaymentsModule — payables + payment schedule + SEPA export.
 *
 * AuditModule is GLOBAL so AuditService is injectable without an explicit
 * import here. PrismaModule is the same. PartiesModule is a sibling
 * provider (not a dependency here): we work against the `Party` model
 * directly through prisma.party.* instead of going through PartiesService
 * — the parties module owns the master data + IBAN history, the payments
 * module owns the operational flow on top of it.
 *
 * Exports PaymentsService so downstream modules (e.g. reconciliation
 * close-the-loop, AI agent suggesting upcoming payments) can call into
 * it without re-implementing the IBAN validation + audit plumbing.
 */
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}