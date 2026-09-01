import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { Response } from 'express';
import { BankingService } from './banking.service';
import {
  CreateCsvTemplateDto,
  PreviewCsvDto,
  ImportCsvDto,
  ImportCamtDto,
  UpdateCsvTemplateDto,
  BankTransactionQueryDto,
} from './dto/banking.dto';

/**
 * Banking module REST surface. Mounted under the global `/api/v1` prefix
 * (see main.ts), which gives the final URL prefix `/api/v1/banking`.
 *
 * Auth: every route inherits the global JwtGuard + TenantGuard + RbacGuard
 * stack from app.module.ts. CsvTemplate CRUD and imports require
 * ADMIN or CONTABILIDADE per the doc-flow RBAC matrix.
 */
@ApiTags('banking')
@ApiBearerAuth()
@Controller('banking')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  // ============================================================ Templates

  @Get('templates')
  @ApiOperation({ summary: 'List CSV templates for tenant' })
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.banking.listTemplates(user.tenantId);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get one CSV template' })
  getTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.banking.getTemplate(user.tenantId, id);
  }

  @Post('templates')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @ApiOperation({ summary: 'Create CSV mapping template' })
  createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCsvTemplateDto,
  ) {
    return this.banking.createTemplate(user.tenantId, user.id, dto);
  }

  @Patch('templates/:id')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @ApiOperation({ summary: 'Update CSV mapping template' })
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCsvTemplateDto,
  ) {
    return this.banking.updateTemplate(user.tenantId, user.id, id, dto);
  }

  @Delete('templates/:id')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete CSV mapping template' })
  deleteTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.banking.deleteTemplate(user.tenantId, user.id, id);
  }

  // ============================================================ CSV wizard

  @Post('csv/preview')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Parse a CSV string (sent in body) and return the first 20 mapped rows for the wizard',
  })
  preview(@Body() body: PreviewCsvDto & { content: string }) {
    const { content, ...rest } = body;
    // Fold the legacy flat *Column fields into the nested `mapping` object
    // before handing off to the service — keeps backwards compatibility with
    // the OpenAPI-documented body shape (dateColumn / amountColumn / ...).
    const dto = new PreviewCsvDto();
    Object.assign(dto, rest);
    return this.banking.previewCsv(content, dto);
  }

  @Post('csv/import')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import CSV bank transactions (content in body).',
  })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ImportCsvDto & { content: string },
  ) {
    const { content, ...rest } = body;
    const dto = new ImportCsvDto();
    Object.assign(dto, rest);
    return this.banking.importCsv(user.tenantId, user.id, content, dto);
  }

  // ============================================================ CAMT.053

  @Post('camt/import')
  @Roles(Role.ADMIN, Role.CONTABILIDADE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import ISO 20022 CAMT.053 bank statement (XML in body).',
  })
  importCamt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportCamtDto,
  ) {
    return this.banking.importCamt(user.tenantId, user.id, dto);
  }

  // ============================================================ Transactions

  @Get('transactions')
  @ApiOperation({
    summary: 'List bank transactions (paginated, with filters).',
  })
  listTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BankTransactionQueryDto,
  ) {
    return this.banking.listTransactions(user.tenantId, query);
  }

  @Get('transactions/export')
  @ApiOperation({
    summary: 'Export bank transactions to a PT-friendly CSV (Excel).',
  })
  @ApiProduces('text/csv')
  async exportTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BankTransactionQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.banking.exportTransactionsCsv(
      user.tenantId,
      query,
    );
    const filename = `movimentos-bancarios-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(csv);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get bank transaction by id' })
  getTransaction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.banking.getTransaction(user.tenantId, id);
  }
}