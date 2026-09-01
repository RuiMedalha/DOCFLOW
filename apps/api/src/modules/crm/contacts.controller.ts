import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ContactsService } from './contacts.service';
import {
  FindDuplicatesResponseDto,
  MergeContactsDto,
} from './dto/contacts-merge.dto';

/**
 * ContactsController — contact hygiene endpoints (merge + duplicate scan).
 *
 * The big CrmController keeps the everyday CRUD; this controller owns the
 * non-trivial ones. They share the same JwtGuard + TenantGuard + RbacGuard
 * stack via the global APP_GUARD bindings.
 */
@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  /**
   * GET /crm/contacts/duplicates — scan the tenant for likely-duplicate
   * contacts. Returns clusters grouped by NIF / email / phone / normalized
   * name. Caller picks the master and the duplicates to absorb and calls
   * POST /crm/contacts/merge.
   */
  @Get('duplicates')
  @ApiOperation({
    summary: 'Find likely-duplicate contacts in the tenant',
    description:
      'Clusters contacts by NIF (exact), email (case-insensitive exact), phone (digits-only), and normalized name. Confidence 1.0 (NIF), 0.95 (email), 0.9 (phone), 0.7 (name).',
  })
  @ApiResponse({ status: 200, type: FindDuplicatesResponseDto })
  findDuplicates(@CurrentUser() user: AuthenticatedUser) {
    return this.contacts.findDuplicates(user.tenantId);
  }

  /**
   * POST /crm/contacts/merge — absorb one or more duplicate contacts into
   * a master. Field-level merge: defaults to fill-nulls-only; pass
   * `overwrite=true` to replace non-null master values.
   *
   * Re-points deals / activities / contact persons, soft-deletes the
   * duplicates, and writes an audit row with the field-level merges.
   */
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Merge duplicate contacts into a master',
    description:
      'Master keeps its id. Duplicates are soft-deleted (isActive=false) and tagged `merged-into:<masterId>` so the list de-duplicates without losing history. Deals, activities, and contact persons are re-pointed to the master.',
  })
  @ApiResponse({ status: 404, description: 'Master or one of the duplicates not found' })
  mergeContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MergeContactsDto,
  ) {
    return this.contacts.mergeContacts(user.tenantId, user.id, dto);
  }
}