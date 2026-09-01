import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
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
import { DealStage } from '@prisma/client';

/**
 * POST /crm/deals — create a new deal in a pipeline.
 *
 * `value` is stored on the `Decimal(14,2)` column; we keep it as a JS
 * number in the DTO and let Prisma coerce it. The frontend formats it.
 */
export class CreateDealDto {
  @ApiProperty({ description: 'CRM contact the deal belongs to.' })
  @IsString()
  contactId: string;

  @ApiPropertyOptional({ description: 'Pipeline the deal is in.' })
  @IsOptional()
  @IsString()
  pipelineId?: string;

  @ApiProperty({ example: 'Contrato anual — Hotel Praia' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 12500.0,
    description: 'Estimated value of the deal in EUR.',
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value: number;

  @ApiPropertyOptional({
    enum: DealStage,
    default: DealStage.LEAD,
    description: 'Starting stage. Defaults to LEAD.',
  })
  @IsOptional()
  @IsEnum(DealStage)
  stage?: DealStage;

  @ApiPropertyOptional({
    example: 25,
    minimum: 0,
    maximum: 100,
    description: 'Probability the deal closes, as a percentage.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  probability?: number;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Expected close date (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;
}

/** PATCH /crm/deals/:id — partial update. */
export class UpdateDealDto extends PartialType(CreateDealDto) {}

/** PATCH /crm/deals/:id/stage — move a deal to a new stage. */
export class MoveDealStageDto {
  @ApiProperty({ enum: DealStage })
  @IsEnum(DealStage)
  stage: DealStage;

  @ApiPropertyOptional({
    example: 60,
    minimum: 0,
    maximum: 100,
    description:
      'Override probability. If omitted, the pipeline stage default is applied.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  probability?: number;

  @ApiPropertyOptional({
    example: 'Moved after proposal signed by CFO.',
    description: 'Optional note recorded in the deal stage-change audit row.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /crm/deals — query filters. */
export class DealQueryDto {
  @ApiPropertyOptional({ enum: DealStage })
  @IsOptional()
  @IsEnum(DealStage)
  stage?: DealStage;

  @ApiPropertyOptional({ description: 'Filter by contact id.' })
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Filter by pipeline id.' })
  @IsOptional()
  @IsString()
  pipelineId?: string;

  @ApiPropertyOptional({ description: 'Filter by the deal owner.' })
  @IsOptional()
  @IsString()
  createdById?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
