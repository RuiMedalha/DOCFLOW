import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PaymentStatus,
  RecurrenceType,
} from '@prisma/client';

/**
 * DTOs for the payments module — payables, schedules, SEPA exports.
 *
 * Conventions:
 *   - Paginated queries follow the parties/reconciliation shape: explicit
 *     `page`/`limit` with safe defaults.
 *   - Decimal amounts enter class-validator as floats (validated >0).
 *     The Prisma column is Decimal(14,2); we coerce to number at the
 *     service layer after class-validator.
 *   - Date filters accept ISO-8601 strings and are converted by the
 *     service into Date ranges.
 */

// ═════════════════════════════════════════════ payables (CRUD-style) ═══════

/**
 * Generate a PayableItem from an existing Document — the most common path
 * once a fatura_recebida lands in the inbox. The Document must already
 * belong to the tenant; we look it up and copy the relevant header fields
 * into the new PayableItem.
 */
export class CreatePayableFromDocumentDto {
  @ApiProperty({ description: 'Source document id' })
  @IsString()
  documentId: string;

  @ApiPropertyOptional({ description: 'Override the due date (defaults to document.dueDate)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Override the amount (defaults to document.total)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ description: 'Override the party (fornecedor)' })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ description: 'Free-text description override' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

/**
 * Manually create a PayableItem that is NOT linked to an inbound document
 * (e.g. amortisation, bank fee, supplier invoice not yet in the inbox).
 * `partyId` is optional because standalone payments exist too (rent,
 * salaries, ...).
 */
export class CreateManualPayableDto {
  @ApiProperty({ example: 'Renda novembro 2026' })
  @IsString()
  @MaxLength(255)
  description: string;

  @ApiProperty({ example: 1250.0, description: 'EUR, 2 decimal places' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'ISO-8601; default is today + paymentTermDays' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Optional party link' })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 of the source document, if any' })
  @IsOptional()
  @IsString()
  documentId?: string;
}

/**
 * Query for GET /payments/payables. All filters are optional. Date
 * filters are inclusive on both ends.
 */
export class ListPayablesQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus, default: PaymentStatus.TO_PAY })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: 'ISO-8601 inclusive lower bound on dueDate' })
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 inclusive upper bound on dueDate' })
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by party id' })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ description: 'Approved only' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  approvedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Overdue only (compare dueDate<now and status!=PAID)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

/**
 * PATCH /payments/payables/:id — partial update of the editable fields.
 * Approval is a SEPARATE endpoint so RBAC can be enforced at the route
 * level (PaymentsController `@Roles('ADMIN','APPROVER')`).
 */
export class UpdatePayableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Body for POST /payments/payables/:id/approve. The route is RBAC-gated
 * for ADMIN/APPROVER; the body carries an optional note for the audit
 * log.
 */
export class ApprovePayableDto {
  @ApiPropertyOptional({ description: 'Audit note (stored on AuditLog metadata)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

/**
 * Body for POST /payments/payables/:id/mark-paid. The bank transaction
 * (when present) is what reconciliation uses to close the loop; we keep
 * the schema flexible so an operator can mark a payment paid without
 * importing the bank statement first.
 */
export class MarkPaidPayableDto {
  @ApiPropertyOptional({ description: 'EUR actually paid (defaults to amount)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  paidAmount?: number;

  @ApiPropertyOptional({
    description: 'Payment channel: sepa | mb | transfer | card | cash | other',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'SEPA EndToEndId, MB entity+reference, etc.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentRef?: string;

  @ApiPropertyOptional({ description: 'Link the paying bank transaction' })
  @IsOptional()
  @IsString()
  bankTxId?: string;

  @ApiPropertyOptional({
    description:
      'Required when paidAmount differs from the payable amount by more than 1 cent (partial / overpayment). Stored on the audit log.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  partialReason?: string;
}

// ═════════════════════════════════════════════ schedule / calendar ═════════

export class CreatePaymentScheduleDto {
  @ApiProperty({ example: 'Renda escritório Lisboa' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 1250.0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'ISO-8601 of the first occurrence' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({
    description: 'Channel: sepa | mb | transfer | card | cash',
    default: 'transfer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'rent' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: 'Optional party link' })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ description: 'Optional source document' })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  @ApiPropertyOptional({ enum: RecurrenceType })
  @IsOptional()
  @IsEnum(RecurrenceType)
  recurrenceType?: RecurrenceType;

  @ApiPropertyOptional({
    description: 'Multiply recurrence step (every N days/weeks/months)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recurrenceInterval?: number;
}

/**
 * `PartialType` makes every property optional — but class-validator on
 * Prisma Decimal columns doesn't strip the decorator. We use a manual
 * equivalent here to keep the validation surface explicit.
 */
export class UpdatePaymentScheduleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() paymentDate?: string;
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) paymentMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() recurring?: boolean;
  @ApiPropertyOptional({ enum: RecurrenceType })
  @IsOptional()
  @IsEnum(RecurrenceType)
  recurrenceType?: RecurrenceType;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recurrenceInterval?: number;
}

/** Calendar/schedule list query. */
export class ListPaymentSchedulesQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: 'ISO-8601 inclusive lower bound on dueDate' })
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 inclusive upper bound on dueDate' })
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

// ═════════════════════════════════════════════ SEPA export ════════════════

/**
 * Inputs the caller must supply for a SEPA export. The service reads
 * the approved PayableItems and synthesises the rest from the Tenant
 * config + Party masters.
 */
export class SepaExportDto {
  @ApiPropertyOptional({
    description:
      'Subset of payable ids to export. Default = ALL approved (TO_PAY) for the tenant.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  payableIds?: string[];

  @ApiPropertyOptional({
    description: 'Requested execution date. Defaults to the earliest dueDate + 2 BD',
  })
  @IsOptional()
  @IsDateString()
  requestedExecutionDate?: string;

  @ApiPropertyOptional({
    description: 'Force CSV export via Accept header (default true via route)',
    enum: ['xml', 'csv'],
  })
  @IsOptional()
  @IsEnum(['xml', 'csv'])
  format?: 'xml' | 'csv';
}

/** Returned on JSON responses (XML/CSV downloads stream via @Res()). */
export class SepaExportResponseDto {
  @ApiProperty() messageId!: string;
  @ApiProperty() numberOfTransactions!: number;
  @ApiProperty({ example: 12345.67 }) controlSum!: number;
  @ApiProperty({ type: [String], description: 'payable ids that were included' })
  payableIds!: string[];
  @ApiPropertyOptional({ description: 'ISO-8601 execution date baked into the XML' })
  requestedExecutionDate?: string;
}

// ═════════════════════════════════════════════ helpers (re-exports) ═══════

export { RecurrenceType };
