import { Module } from '@nestjs/common';
import { TaxSimulatorController } from './tax-simulator.controller';
import { TaxSimulatorService } from './tax-simulator.service';

/**
 * TaxSimulatorModule — preview endpoint for the tenant's IVA (quarterly)
 * and IRC (annual) obligations. Read-only — does not write any domain
 * row, only an AuditLog entry per call.
 *
 * AuditModule is GLOBAL so AuditService is resolvable without an explicit
 * import. PrismaModule is the same. RBAC is enforced globally via the
 * `Roles` decorator on each route.
 */
@Module({
  controllers: [TaxSimulatorController],
  providers: [TaxSimulatorService],
  exports: [TaxSimulatorService],
})
export class TaxSimulatorModule {}