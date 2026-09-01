import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import {
  IrcSimulatorQueryDto,
  IrcSimulatorResult,
  IvaSimulatorQueryDto,
  IvaSimulatorResult,
} from './dto/tax-simulator.dto';
import { TaxSimulatorService } from './tax-simulator.service';

/**
 * Tax Simulator controller — preview the tenant's quarterly IVA and
 * annual IRC obligations from in-app data. All routes are RBAC-gated to
 * ADMIN + CONTABILIDADE (RbacGuard is global, see app.module.ts).
 *
 *   GET /tax-simulator/iva?year=2026&quarter=1    — DP subset
 *   GET /tax-simulator/irc?year=2026              — IRC + autónoma
 *
 * The tenant is implicit (CurrentUser.tenantId) — there is no cross-tenant
 * preview. The simulator never writes to the DB; only an AuditLog row is
 * appended so the user can prove they ran a preview.
 */
@ApiTags('tax-simulator')
@ApiBearerAuth()
@Controller('tax-simulator')
export class TaxSimulatorController {
  constructor(private readonly svc: TaxSimulatorService) {}

  // ──────────────────────────────────────────── IVA ────────────────────────

  @Get('iva')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @ApiOperation({
    summary: 'Quarterly IVA preview (Declaração Periódica)',
    description:
      'Aggregates documents in the year/quarter window by rate and splits ' +
      'them into liquidado (sales: FATURA_EMITIDA, NOTA_DEBITO) and ' +
      'deductivel (purchases: FATURA_RECEBIDA, NOTA_CREDITO). NOTA_CREDITO ' +
      'negates the originating document. Intracommunity documents are ' +
      'surfaced in notes for separate reporting.',
  })
  @ApiQuery({ name: 'year', example: 2026, required: true })
  @ApiQuery({ name: 'quarter', example: 1, required: true, enum: [1, 2, 3, 4] })
  @ApiQuery({ name: 'region', example: 'PT', required: false })
  @ApiResponse({
    status: 200,
    description: 'Per-rate buckets + totals + notes',
  })
  @ApiResponse({ status: 400, description: 'Invalid year/quarter' })
  @ApiResponse({ status: 403, description: 'Requires ADMIN or CONTABILIDADE' })
  iva(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IvaSimulatorQueryDto,
  ): Promise<IvaSimulatorResult> {
    return this.svc.simulateIva(user.tenantId, user.id, query);
  }

  // ──────────────────────────────────────────── IRC ────────────────────────

  @Get('irc')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @ApiOperation({
    summary: 'Annual IRC + autonomous taxation rough estimate',
    description:
      'Sums debits on PGC 6x accounts in the year and applies a flat 21% ' +
      'IRC rate + a 10% autonomous-taxation rate. Top 10 expense accounts ' +
      'are returned for sanity-checking. Caveats (revenues excluded, no ' +
      'carry-forward, no regime split) are surfaced in `notes`.',
  })
  @ApiQuery({ name: 'year', example: 2026, required: true })
  @ApiResponse({
    status: 200,
    description: 'Headline figures + top accounts + notes',
  })
  @ApiResponse({ status: 403, description: 'Requires ADMIN or CONTABILIDADE' })
  irc(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IrcSimulatorQueryDto,
  ): Promise<IrcSimulatorResult> {
    return this.svc.simulateIrc(user.tenantId, user.id, query);
  }
}