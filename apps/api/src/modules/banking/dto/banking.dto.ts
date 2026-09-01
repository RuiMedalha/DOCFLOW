import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsNumber,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Column mapping accepted by the CSV import wizard. The user picks which
 * file column feeds each canonical field — either `amount` OR the pair
 * (`debit` + `credit`) must be supplied.
 *
 * All fields are optional at the DTO level so the caller can also pass the
 * flat `dateColumn` / `amountColumn` / etc. fields on PreviewCsvDto; the
 * service folds them via `toEffectiveMapping()` before parsing. The parser
 * still requires date + description + (amount OR debit/credit) at runtime
 * and will return clear mapping errors instead of crashing.
 */
export class CsvColumnMappingDto {
  @ApiPropertyOptional({ example: 'Data' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'Descrição' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'Valor',
    description: 'Use amount OR debit+credit',
  })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ example: 'Débito' })
  @IsOptional()
  @IsString()
  debit?: string;

  @ApiPropertyOptional({ example: 'Crédito' })
  @IsOptional()
  @IsString()
  credit?: string;

  @ApiPropertyOptional({ example: 'Saldo' })
  @IsOptional()
  @IsString()
  balance?: string;

  @ApiPropertyOptional({ example: 'Referência' })
  @IsOptional()
  @IsString()
  reference?: string;
}

export class CreateCsvTemplateDto {
  @ApiProperty({ example: 'Millennium BCP' })
  @IsString()
  name!: string;

  @ApiProperty({ type: CsvColumnMappingDto })
  @IsObject()
  mapping!: CsvColumnMappingDto;

  @ApiPropertyOptional({ example: 'DD/MM/YYYY', default: 'DD/MM/YYYY' })
  @IsOptional()
  @IsIn(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'])
  @IsString()
  dateFormat?: string;

  @ApiPropertyOptional({ example: ',', default: ',' })
  @IsOptional()
  @IsString()
  decimalSep?: string;

  @ApiPropertyOptional({ example: '.', default: '.' })
  @IsOptional()
  @IsString()
  thousandSep?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  hasHeader?: boolean;
}

export class UpdateCsvTemplateDto {
  @ApiPropertyOptional({ type: CsvColumnMappingDto })
  @IsOptional()
  @IsObject()
  mapping?: CsvColumnMappingDto;

  @ApiPropertyOptional({ example: 'DD/MM/YYYY' })
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @ApiPropertyOptional({ example: ',' })
  @IsOptional()
  @IsString()
  decimalSep?: string;

  @ApiPropertyOptional({ example: '.' })
  @IsOptional()
  @IsString()
  thousandSep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasHeader?: boolean;
}

export class PreviewCsvDto {
  @ApiProperty({
    type: CsvColumnMappingDto,
    description:
      'Nested mapping object. Required unless the flat *Column fields are ' +
      'supplied instead (legacy OpenAPI shape).',
  })
  @IsOptional()
  @IsObject()
  mapping?: CsvColumnMappingDto;

  @ApiPropertyOptional({
    example: 'Data',
    description:
      'Flat shape (legacy OpenAPI docs). Name of the column that holds the ' +
      'transaction date. Falls back to mapping.date when both are supplied.',
  })
  @IsOptional()
  @IsString()
  dateColumn?: string;

  @ApiPropertyOptional({
    example: 'Descrição',
    description: 'Flat shape (legacy OpenAPI docs). Description column.',
  })
  @IsOptional()
  @IsString()
  descriptionColumn?: string;

  @ApiPropertyOptional({
    example: 'Valor',
    description: 'Flat shape (legacy OpenAPI docs). Amount column.',
  })
  @IsOptional()
  @IsString()
  amountColumn?: string;

  @ApiPropertyOptional({
    example: 'Saldo',
    description: 'Flat shape (legacy OpenAPI docs). Balance column.',
  })
  @IsOptional()
  @IsString()
  balanceColumn?: string;

  @ApiPropertyOptional({ example: 'DD/MM/YYYY' })
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @ApiPropertyOptional({ example: ',' })
  @IsOptional()
  @IsString()
  decimalSep?: string;

  @ApiPropertyOptional({ example: '.' })
  @IsOptional()
  @IsString()
  thousandSep?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  hasHeader?: boolean;

  /**
   * Resolve the effective mapping, folding the legacy flat *Column fields into
   * the nested `mapping` object the parser expects. Callers may supply one,
   * the other, or both — flat wins on a per-field basis when both are set,
   * so a request that mixes the two shapes doesn't silently lose columns.
   */
  toEffectiveMapping(): CsvColumnMappingDto {
    return {
      date: this.mapping?.date ?? this.dateColumn ?? '',
      description: this.mapping?.description ?? this.descriptionColumn ?? '',
      amount: this.mapping?.amount ?? this.amountColumn,
      debit: this.mapping?.debit,
      credit: this.mapping?.credit,
      balance: this.mapping?.balance ?? this.balanceColumn,
      reference: this.mapping?.reference,
    };
  }
}

export class ImportCsvDto extends PreviewCsvDto {
  @ApiPropertyOptional({ description: 'Save as template with this name' })
  @IsOptional()
  @IsString()
  saveAsTemplate?: string;
}

export class ImportCamtDto {
  @ApiPropertyOptional({
    description:
      'ISO 20022 CAMT.053 bank statement XML. Accepts UTF-8 string (≤ 5MB).',
    maxLength: 5_242_880,
  })
  @IsOptional()
  @IsString()
  xml?: string;

  @ApiPropertyOptional({
    description: 'Optional label for the batch (visible in audit log).',
  })
  @IsOptional()
  @IsString()
  batchLabel?: string;
}

export class BankTransactionQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'ISO date YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Substring search on description/ref' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by source (CSV or CAMT.053)' })
  @IsOptional()
  @IsString()
  source?: string;
}