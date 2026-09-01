import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ReconciliationService } from './reconciliation.service';
import {
  ListSuggestionsQueryDto,
  PaginatedSuggestionsDto,
  RunMatchingResponseDto,
} from './dto/reconciliation.dto';

/**
 * Reconciliation REST surface — mounted under the global `/api/v1`
 * prefix with the `/reconciliation` segment. All routes inherit the
 * global JwtGuard + TenantGuard + RbacGuard stack from app.module.ts.
 *
 * Routes:
 *   POST /reconciliation/run                  — run matching job
 *   GET  /reconciliation/suggestions          — list (default PENDING)
 *   POST /reconciliation/suggestions/:id/accept
 *   POST /reconciliation/suggestions/:id/reject
 *
 * Permissions: reconciliation data is gated by `User.canViewReconciliation`
 * at the service layer for read paths, and `User.canApprovePayments` for
 * accept. Route-level role guard keeps OPERADOR out of read entirely as
 * the coarse first filter.
 */
@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the matching engine',
    description:
      'For every unreconciled bank transaction in the tenant, score it ' +
      'against documents / expenses / invoices / payables. Persists the ' +
      'best candidate per (tx, entity-type) group and returns counts.',
  })
  @ApiResponse({ status: 200, type: RunMatchingResponseDto })
  async run(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RunMatchingResponseDto> {
    return this.reconciliation.runMatching(user.tenantId, user.id);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'List match suggestions',
    description:
      'Paginated list of suggestions for review. Defaults to PENDING; ' +
      'pass ?status=ACCEPTED or REJECTED to see history. Sorted by ' +
      'score desc, then createdAt desc.',
  })
  @ApiResponse({ status: 200, type: PaginatedSuggestionsDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSuggestionsQueryDto,
  ): Promise<PaginatedSuggestionsDto> {
    return this.reconciliation.listSuggestions(user.tenantId, query);
  }

  @Post('suggestions/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a match suggestion',
    description:
      'Marks the suggestion ACCEPTED, auto-rejects competing pendings ' +
      'for the same bank tx, links the BankTransaction to the matched ' +
      'entity (expense/invoice/payable/document), sets reconciledAt and ' +
      'reconciledById, and writes a hash-chained audit row.',
  })
  @ApiResponse({
    status: 200,
    description: 'Accepted',
    schema: {
      type: 'object',
      properties: {
        accepted: { type: 'boolean', example: true },
        bankTransactionId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Suggestion not found' })
  @ApiResponse({
    status: 400,
    description: 'Suggestion already processed (not pending)',
  })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ accepted: true; bankTransactionId: string }> {
    return this.reconciliation.acceptSuggestion(user.tenantId, user.id, id);
  }

  @Post('suggestions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a match suggestion',
    description:
      'Marks the suggestion REJECTED. The bank transaction remains ' +
      'unreconciled and may match again on the next run. Writes a ' +
      'hash-chained audit row.',
  })
  @ApiResponse({
    status: 200,
    description: 'Rejected',
    schema: {
      type: 'object',
      properties: {
        rejected: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Suggestion not found' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ rejected: true }> {
    return this.reconciliation.rejectSuggestion(user.tenantId, user.id, id);
  }
}
