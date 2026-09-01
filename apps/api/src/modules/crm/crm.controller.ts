import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { CrmService } from './crm.service';
import { ActivitiesService } from './activities.service';
import { DealsService } from './deals.service';
import { PipelinesService } from './pipelines.service';
import {
  ActivityQueryDto,
  CreateActivityDto,
  UpdateActivityDto,
} from './dto/activity.dto';
import {
  ContactQueryDto,
  CreateContactDto,
  CreateContactPersonDto,
  UpdateContactDto,
  UpdateContactPersonDto,
} from './dto/contact.dto';
import {
  CreateDealDto,
  DealQueryDto,
  MoveDealStageDto,
  UpdateDealDto,
} from './dto/deal.dto';
import {
  CreatePipelineDto,
  UpdatePipelineDto,
} from './dto/pipeline.dto';
import {
  ImportContactsDto,
  ImportContactsResponseDto,
} from './dto/import.dto';

/**
 * CrmController — contacts, contact persons, pipelines, deals, activities,
 * plus the import pipeline (HubSpot / Pipedrive — adapters are stubbed but
 * the mapping + persistence path is real).
 *
 * Auth: every route goes through the global JwtGuard + TenantGuard +
 * RbacGuard (APP_GUARD). Tenants are auto-scoped via the Prisma extension.
 */
@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly deals: DealsService,
    private readonly activities: ActivitiesService,
  ) {}

  // ─────────────────────────────────────────── CONTACTS ──────────────────

  @Get('contacts')
  @ApiOperation({
    summary: 'List CRM contacts',
    description:
      'Paginated. Filters: type (COMPANY|INDIVIDUAL), isActive (default true), search over name/nif/email.',
  })
  listContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ContactQueryDto,
  ) {
    return this.crm.findAllContacts(user.tenantId, query);
  }

  @Post('contacts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a CRM contact' })
  @ApiResponse({ status: 409, description: 'NIF or email already exists for the tenant' })
  createContact(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContactDto,
  ) {
    return this.crm.createContact(user.tenantId, user.id, dto);
  }

  @Get('contacts/:id')
  @ApiOperation({ summary: 'Get CRM contact detail' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findOneContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.findOneContact(user.tenantId, id);
  }

  @Patch('contacts/:id')
  @ApiOperation({ summary: 'Update a CRM contact' })
  updateContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.crm.updateContact(user.tenantId, user.id, id, dto);
  }

  @Delete('contacts/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a CRM contact' })
  removeContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.softDeleteContact(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── CONTACT PERSONS ───────────

  @Post('contacts/:id/persons')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a contact person to a CRM contact' })
  addPerson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') contactId: string,
    @Body() dto: CreateContactPersonDto,
  ) {
    return this.crm.addContactPerson(user.tenantId, user.id, contactId, dto);
  }

  @Patch('persons/:id')
  @ApiOperation({ summary: 'Update a contact person' })
  updatePerson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContactPersonDto,
  ) {
    return this.crm.updateContactPerson(user.tenantId, user.id, id, dto);
  }

  @Delete('persons/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a contact person' })
  removePerson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.removeContactPerson(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── PIPELINES ─────────────────

  @Get('pipelines')
  @ApiOperation({ summary: 'List CRM pipelines (ordered by isDefault desc)' })
  listPipelines(@CurrentUser() user: AuthenticatedUser) {
    return this.crm.listPipelines(user.tenantId);
  }

  @Post('pipelines')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a CRM pipeline with ordered stages' })
  createPipeline(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePipelineDto,
  ) {
    return this.crm.createPipeline(user.tenantId, user.id, dto);
  }

  @Get('pipelines/:id')
  @ApiOperation({ summary: 'Get CRM pipeline detail' })
  findOnePipeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.findOnePipeline(user.tenantId, id);
  }

  @Patch('pipelines/:id')
  @ApiOperation({ summary: 'Update a CRM pipeline' })
  updatePipeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.crm.updatePipeline(user.tenantId, user.id, id, dto);
  }

  @Delete('pipelines/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a CRM pipeline',
    description:
      'Refuses when deals still reference the pipeline (delete or reassign them first).',
  })
  removePipeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.deletePipeline(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── DEALS ─────────────────────

  @Get('deals')
  @ApiOperation({
    summary: 'List deals (opportunities)',
    description: 'Paginated. Filters: stage, contactId, pipelineId, createdById.',
  })
  listDeals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DealQueryDto,
  ) {
    return this.crm.findAllDeals(user.tenantId, query);
  }

  @Post('deals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a deal (opportunity)' })
  createDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDealDto,
  ) {
    return this.crm.createDeal(user.tenantId, user.id, dto);
  }

  @Get('deals/stats')
  @ApiOperation({
    summary: 'Pipeline stats (counts + values + weighted forecast)',
  })
  pipelineStats(@CurrentUser() user: AuthenticatedUser) {
    return this.crm.pipelineStats(user.tenantId);
  }

  @Get('deals/:id')
  @ApiOperation({ summary: 'Get deal detail' })
  findOneDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.findOneDeal(user.tenantId, id);
  }

  @Patch('deals/:id')
  @ApiOperation({
    summary: 'Update a deal',
    description: 'Does NOT change stage; use PATCH /deals/:id/stage for that.',
  })
  updateDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.crm.updateDeal(user.tenantId, user.id, id, dto);
  }

  @Patch('deals/:id/stage')
  @ApiOperation({
    summary: 'Move a deal to a new stage',
    description:
      'Sets wonAt when stage=WON, lostAt when stage=LOST. Resolves probability from the pipeline stage defaults unless overridden.',
  })
  moveDealStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MoveDealStageDto,
  ) {
    return this.crm.moveDealStage(user.tenantId, user.id, id, dto);
  }

  @Delete('deals/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a deal' })
  removeDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.deleteDeal(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── ACTIVITIES ────────────────

  @Get('activities')
  @ApiOperation({
    summary: 'List activities',
    description: 'Paginated. Filters: type, contactId, dealId, assignedToId, onlyPending.',
  })
  listActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ActivityQueryDto,
  ) {
    return this.crm.findAllActivities(user.tenantId, query);
  }

  @Post('activities')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Log an activity (call/email/meeting/task/note/follow-up)' })
  createActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateActivityDto,
  ) {
    return this.crm.createActivity(user.tenantId, user.id, dto);
  }

  @Get('activities/:id')
  @ApiOperation({ summary: 'Get activity detail' })
  findOneActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.findOneActivity(user.tenantId, id);
  }

  @Patch('activities/:id')
  @ApiOperation({ summary: 'Update an activity' })
  updateActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.crm.updateActivity(user.tenantId, user.id, id, dto);
  }

  @Post('activities/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an activity complete (sets completedAt=now)' })
  completeActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.completeActivity(user.tenantId, user.id, id);
  }

  @Delete('activities/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an activity' })
  removeActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.crm.deleteActivity(user.tenantId, user.id, id);
  }

  // ─────────────────────────────────────────── DEAL BOARD + FORECAST ─────

  @Get('deals/board')
  @ApiOperation({
    summary: 'Deal board (Kanban view)',
    description:
      'Returns one column per stage with deals sorted by value desc. Includes weightedValue per column. `includeLost=true` to also show LOST deals; otherwise the LOST column is hidden.',
  })
  dealBoard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('pipelineId') pipelineId?: string,
    @Query('includeLost') includeLost?: string,
  ) {
    return this.deals.dealBoard(user.tenantId, {
      pipelineId,
      includeLost: includeLost === 'true',
    });
  }

  @Get('deals/forecast')
  @ApiOperation({
    summary: 'Weighted-value forecast by month',
    description:
      'Sum of weighted values per month from now to `horizonMonths` (default 6, max 24). Includes `winRate` (WON / (WON+LOST)) and `unassigned` bucket for open deals missing an expectedCloseDate.',
  })
  dealForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Query('horizonMonths') horizonMonths?: string,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.deals.forecast(user.tenantId, {
      horizonMonths: horizonMonths ? Number(horizonMonths) : undefined,
      pipelineId,
    });
  }

  // ─────────────────────────────────────────── ACTIVITIES (extra) ────────

  @Get('activities/pending')
  @ApiOperation({
    summary: 'List pending activities (open + due date)',
    description:
      'Pass `onlyOverdue=true` to filter to overdue items. Items without a due date are excluded by default — set `onlyOverdue=false` (default) to include them when dueDate is set.',
  })
  pendingActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('onlyOverdue') onlyOverdue?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activities.pending(user.tenantId, {
      onlyOverdue: onlyOverdue === 'true',
      assignedToId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('activities/:id/attach-deal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Attach an activity to a deal',
  })
  attachActivityToDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { dealId: string },
  ) {
    return this.activities.attachToDeal(user.tenantId, user.id, id, body.dealId);
  }

  @Post('activities/:id/detach-deal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Detach an activity from its deal',
  })
  detachActivityFromDeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.activities.detachFromDeal(user.tenantId, user.id, id);
  }

  @Post('activities/bulk-complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-complete a list of activities',
  })
  bulkComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { activityIds: string[] },
  ) {
    return this.activities.bulkComplete(user.tenantId, user.id, body.activityIds);
  }

  // ─────────────────────────────────────────── IMPORT ────────────────────

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-import contacts from HubSpot or Pipedrive',
    description:
      'Adapters are STUBS today (mock mode) — they return canned rows when the body is empty. The mapping + persistence path is real, including dedup by NIF/email, optional merge, dry-run preview, and a sync-history audit row per run.',
  })
  @ApiResponse({ status: 200, type: ImportContactsResponseDto })
  importContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportContactsDto,
  ) {
    return this.crm.importContacts(user.tenantId, user.id, dto);
  }

  @Get('sync-history')
  @ApiOperation({
    summary: 'Recent CRM import runs (read from AuditLog)',
    description:
      'Returns the `crm_sync` audit rows the import endpoint writes — one entry per run with the full per-row summary.',
  })
  syncHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('source') source?: 'hubspot' | 'pipedrive',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crm.listSyncHistory(user.tenantId, {
      source,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }
}