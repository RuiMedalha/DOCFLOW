import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import { EnrichmentService } from './enrichment.service';
import {
  EnrichmentResponseDto,
  EnrichPartyDto,
} from './dto/enrichment.dto';

/**
 * EnrichmentController — Sprint I.
 *
 * Two routes, both scoped to /parties/:id/enrich* so the UI can
 * find them grouped with the party master record.
 *
 *   POST /parties/:id/enrich            — manual trigger (ADMIN)
 *   GET  /parties/:id/enrichment        — badge metadata (any role)
 *
 * Auth: every route goes through the global JwtGuard + TenantGuard +
 * RbacGuard stack. Tenant scoping comes from `user.tenantId`, never
 * from a body field.
 *
 * RBAC: the manual trigger is ADMIN-only because a misconfigured
 * provider key could burn the tenant's API quota. The GET is open to
 * any authenticated user so the badge can render in the read-only
 * detail view without elevating permissions.
 */
@ApiTags('enrichment')
@ApiBearerAuth()
@Controller()
export class EnrichmentController {
  constructor(private readonly enrichment: EnrichmentService) {}

  @Post('parties/:id/enrich')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enrich a Party from external APIs (Sabi PT / VIES / manual)',
    description:
      'Triggers an immediate external-API enrichment. Cache TTL 30 days; pass ' +
      '{ forceProvider: "sabi-pt" | "vies" | "manual", skipCache: true } to bypass.',
  })
  @ApiResponse({ status: 200, type: EnrichmentResponseDto })
  @ApiResponse({ status: 403, description: 'ADMIN role required' })
  @ApiResponse({ status: 404, description: 'Party not found' })
  async enrich(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EnrichPartyDto,
  ): Promise<EnrichmentResponseDto> {
    try {
      const result = await this.enrichment.enrichParty(
        user.tenantId,
        id,
        user.id,
        {
          forceProvider: dto.forceProvider,
          skipCache: false,
        },
      );
      return {
        source: result.source,
        fieldsPopulated: result.fieldsPopulated,
        error: result.error,
        fetchedAt: result.fetchedAt.toISOString(),
      };
    } catch (err) {
      // Surface a clean 404 when the party doesn't exist (the
      // service throws a plain Error today; map it for the controller).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('Party ') && msg.includes('not found')) {
        throw new NotFoundException(msg);
      }
      throw err;
    }
  }

  @Get('parties/:id/enrichment')
  @ApiOperation({
    summary: 'Get the enrichment badge metadata for a Party',
    description:
      'Returns lastEnrichedAt, source, error, and the provider the factory ' +
      'would pick today — enough to render the badge without triggering an enrich.',
  })
  @ApiResponse({ status: 200, schema: { example: {
    lastEnrichedAt: '2026-09-05T12:34:56.000Z',
    source: 'sabi-pt',
    error: null,
    provider: 'sabi-pt',
  } } })
  async getMetadata(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.enrichment.getMetadata(user.tenantId, id);
  }
}
