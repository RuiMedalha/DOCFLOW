import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

/**
 * ReconciliationModule — owns the bank-tx ↔ document/expense/invoice/
 * payable matching engine and its review surface.
 *
 * Wiring:
 *   - PrismaModule is global — no need to re-import.
 *   - AuditModule is global — AuditService is injectable without an
 *     explicit import here.
 *   - The banking module (when it lands) will be a sibling provider;
 *     this module does not depend on it because we work directly
 *     against `prisma.bankTransaction`. If we ever need BankService
 *     for, say, virtual-account derivation, add it here via the
 *     `BANK_SERVICE` token.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
