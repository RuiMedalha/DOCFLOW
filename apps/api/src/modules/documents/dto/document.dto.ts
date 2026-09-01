import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  DocumentOrigin,
  DocumentStatus,
  DocumentType,
} from '@prisma/client';
import { EXPENSE_CATEGORIES } from '../folder-rules/folder-rules.types';

/**
 * Body sent alongside a multipart upload. The file itself travels in the
 * `file` field — multer picks it up; this DTO covers the rest.
 */
export class UploadDocumentDto {
  @ApiPropertyOptional({
    enum: DocumentOrigin,
    default: DocumentOrigin.UPLOAD,
    description: 'Channel the document arrived through',
  })
  @IsOptional()
  @IsEnum(DocumentOrigin)
  origin?: DocumentOrigin = DocumentOrigin.UPLOAD;

  @ApiPropertyOptional({
    enum: DocumentType,
    description: 'Pre-classify the document type (the rules engine can override)',
  })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}

/**
 * Body for PATCH /documents/:id. Every field is optional — partial updates.
 * The service is responsible for re-evaluating folder rules when type or
 * supplier change.
 */
export class UpdateDocumentDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional({ example: 'EDP Comercial' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplier?: string;

  @ApiPropertyOptional({ example: '500000001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplierNif?: string;

  @ApiPropertyOptional({ example: 'Cliente Demo SA' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer?: string;

  @ApiPropertyOptional({ example: '501000002' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerNif?: string;

  @ApiPropertyOptional({ example: 'FT 2026/1234' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  docNumber?: string;

  @ApiPropertyOptional({ example: '2026-08-30' })
  @IsOptional()
  @IsDateString()
  docDate?: string;

  @ApiPropertyOptional({ example: '2026-09-29' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 123.45 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total?: number;

  @ApiPropertyOptional({ example: 28.39 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ example: 95.06 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  netAmount?: number;

  @ApiPropertyOptional({ example: 'EUR', default: 'EUR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ type: [String], example: ['fatura', 'edp'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Force folder assignment to a specific Folder.id. Pass null to clear and let the rules engine re-suggest.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  folderId?: string | null;

  @ApiPropertyOptional({
    description:
      'Manual expense-category override (PT). One of EXPENSE_CATEGORIES. ' +
      'When set, the folder-rules engine re-files the document under ' +
      '`/Despesas/{Categoria}/{Ano}/{Mes}/` (or /Estrangeiras/... when foreign). ' +
      'Pass an empty string to clear the override and fall back to the AI suggestion.',
    enum: [...EXPENSE_CATEGORIES, ''],
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  expenseCategory?: string;

  @ApiPropertyOptional({
    description:
      'Link the document to a Party.id (supplier/customer). The folder-rules ' +
      'engine reads the party\'s country + isRecurring flag to decide between ' +
      '/Fornecedores/{Nome}/, /Despesas/{Categoria}/, and /Estrangeiras/...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  partyId?: string;
}

/**
 * All-in-one PATCH body exposed publicly. Internal-only fields (fileKey,
 * fileHash, tenantId) cannot be set through this DTO.
 */
export class UpdateDocumentResponseDto extends PartialType(UpdateDocumentDto) {}

/**
 * Query string for GET /documents and GET /documents/inbox.
 * Mirrors the controller surface and stays compatible with class-validator's
 * transform-on-query.
 */
export class DocumentQueryDto {
  @ApiPropertyOptional({ enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional({
    description: 'Filter by party.id (supplier or customer link)',
  })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ example: '2026-08-01', description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Free-text search over fileName / supplier / customer / docNumber / NIF',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    description: 'Set true on inbox endpoint to skip status filter (already NOVO)',
  })
  @IsOptional()
  inbox?: boolean;
}

/**
 * Response wrapper for paginated lists.
 */
export class PaginatedDocumentsDto {
  items: any[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Request shape for PATCH /documents/:id/folder — used by the drag-and-drop
 * UI to explicitly move a document into a Folder.
 */
export class AssignFolderDto {
  @ApiPropertyOptional({
    description:
      'Folder.id to assign. Pass null to clear (the document then falls back to the rules engine).',
  })
  @IsOptional()
  @IsUUID()
  folderId?: string;
}