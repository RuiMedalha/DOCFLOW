import {
  BadRequestException,
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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';

import { PaymentsService } from './payments.service';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_NAMES } from '../../common/throttle/throttle.constants';
import {
  ApprovePayableDto,
  CreateManualPayableDto,
  CreatePayableFromDocumentDto,
  CreatePaymentScheduleDto,
  ListPayablesQueryDto,
  ListPaymentSchedulesQueryDto,
  MarkPaidPayableDto,
  PayPaymentEventDto,
  SepaExportDto,
  UpdatePayableDto,
  UpdatePaymentScheduleDto,
} from './dto/payments.dto';

/**
 * Payments REST surface — mounted at /api/v1/payments.
 *
 * Auth/RBAC:
 *   - Global JwtGuard + TenantGuard + RbacGuard apply to every route.
 *   - Approve + SEPA export require ADMIN or APPROVER role.
 *   - Mark-paid + manual create do NOT need APPROVER — an OPERADOR
 *     importing CAMT.053 may legitimately close the loop without the
 *     approval ceremony (the audit trail still records who).
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('calendar')
  @ApiOperation({ summary: 'List approved-document payment events by due date' })
  calendarEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    return this.payments.calendarEvents(user.tenantId, from, to);
  }

  @Post('events/:id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a payment calendar event as paid' })
  payEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PayPaymentEventDto,
  ) {
    return this.payments.payEvent(user.tenantId, user.id, id, dto);
  }

  // ════════════════════════════════════════════ PAYABLES ════════════════════

  @Get('payables')
  @ApiOperation({
    summary: 'List payables (paginated, filterable)',
    description:
      'Filters: status, dueDateFrom/dueDateTo, partyId, approvedOnly, overdueOnly.',
  })
  listPayables(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPayablesQueryDto,
  ) {
    return this.payments.listPayables(user.tenantId, query);
  }

  @Get('payables/:id')
  @ApiOperation({ summary: 'Get a payable by id' })
  findOnePayable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.payments.findOnePayable(user.tenantId, id);
  }

  @Post('payables/from-document')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate a PayableItem from an inbound document',
    description:
      'Copies supplier/total/dueDate from a FATURA_RECEBIDA and creates an UNAPPROVED PayableItem.',
  })
  createPayableFromDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayableFromDocumentDto,
  ) {
    return this.payments.createPayableFromDocument(user.tenantId, user.id, dto);
  }

  @Post('payables')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a manual PayableItem (no inbound document)',
  })
  createManualPayable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateManualPayableDto,
  ) {
    return this.payments.createManualPayable(user.tenantId, user.id, dto);
  }

  @Patch('payables/:id')
  @ApiOperation({ summary: 'Partial update of a PayableItem' })
  updatePayable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayableDto,
  ) {
    return this.payments.updatePayable(user.tenantId, user.id, id, dto);
  }

  @Post('payables/:id/approve')
  @Roles(Role.ADMIN, Role.APPROVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a PayableItem',
    description:
      'RBAC: ADMIN or APPROVER role required.',
  })
  approvePayable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApprovePayableDto,
  ) {
    return this.payments.approvePayable(user.tenantId, user.id, id, dto);
  }

  @Post('payables/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a PayableItem as paid',
    description:
      'Records paidAt/paidAmount/paymentMethod/paymentRef. Optionally links the paying BankTransaction.',
  })
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkPaidPayableDto,
  ) {
    return this.payments.markPayablePaid(user.tenantId, user.id, id, dto);
  }

  // ════════════════════════════════════════════ SCHEDULE ════════════════════

  @Get('schedule')
  @ApiOperation({ summary: 'List payment schedules (paginated)' })
  listSchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPaymentSchedulesQueryDto,
  ) {
    return this.payments.listSchedules(user.tenantId, query);
  }

  @Get('schedule/calendar')
  @ApiOperation({
    summary: 'Calendar view with recurrence expansion',
    description:
      'Returns every schedule occurrence in [from, to], expanding recurring entries up to maxOccurrences (default 12) per source.',
  })
  calendarView(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('maxOccurrences') maxOccurrences?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (ISO-8601)');
    }
    return this.payments.calendarView(user.tenantId, from, to, {
      maxOccurrences: maxOccurrences ? Number(maxOccurrences) : undefined,
    });
  }

  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment schedule (one-off or recurring)' })
  createSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentScheduleDto,
  ) {
    return this.payments.createSchedule(user.tenantId, user.id, dto);
  }

  @Patch('schedule/:id')
  @ApiOperation({ summary: 'Update a payment schedule' })
  updateSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentScheduleDto,
  ) {
    return this.payments.updateSchedule(user.tenantId, user.id, id, dto);
  }

  @Delete('schedule/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-cancel a payment schedule',
    description: 'Flips the schedule status to CANCELLED — keeps history.',
  })
  softDeleteSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.payments.softDeleteSchedule(user.tenantId, user.id, id);
  }

  // ════════════════════════════════════════════ SEPA EXPORT ════════════════

  // Rate limit: 1 export / min / per user (bucket 'export'). Prevents
  // accidental re-runs and accidental DoS on the SEPA serializer.
  @Throttle({ [THROTTLE_NAMES.EXPORT]: { ttl: 60 * 1000, limit: 1 } })
  @Post('sepa/export')
  @Roles(Role.ADMIN, Role.APPROVER)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('application/xml')
  @ApiOperation({
    summary: 'Export approved payables as a pain.001.001.03 SEPA XML',
    description:
      'Returns the XML body for download. All creditor IBANs are validated with @docflow/shared before serialisation.',
  })
  @ApiOkResponse({
    schema: {
      type: 'string',
      format: 'binary',
      example:
        '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">...</Document>',
    },
  })
  async exportSepaXml(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SepaExportDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const { summary, xml } = await this.payments.exportSepa(
      user.tenantId,
      user.id,
      dto,
    );

    const filename = `sepa-${summary.messageId}.xml`;
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-DocFlow-Message-Id': summary.messageId,
      'X-DocFlow-Control-Sum': String(summary.controlSum),
      'X-DocFlow-Number-Of-Tx': String(summary.numberOfTransactions),
    });
    res.send(xml);
  }

  @Throttle({ [THROTTLE_NAMES.EXPORT]: { ttl: 60 * 1000, limit: 1 } })
  @Post('sepa/export-csv')
  @Roles(Role.ADMIN, Role.APPROVER)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export approved payables as a homebanking-friendly CSV',
    description:
      'Same set as the XML export, rendered as ;-delimited rows for banks without XML ingestion.',
  })
  async exportSepaCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SepaExportDto,
    @Res() res: Response,
  ) {
    const { csv, rows, controlSum } = await this.payments.exportSepaCsv(
      user.tenantId,
      dto,
    );

    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sepa-${stamp}.csv"`,
      'X-DocFlow-Control-Sum': String(controlSum),
      'X-DocFlow-Number-Of-Tx': String(rows),
    });
    // UTF-8 BOM helps Excel open the file without garbling accented
    // characters (essencial for vendor names like "Construções Árvore").
    res.write('﻿');
    res.end(csv);
  }
}
