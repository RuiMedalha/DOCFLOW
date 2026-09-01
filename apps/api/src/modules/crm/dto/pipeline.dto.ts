import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DealStage } from '@prisma/client';

/**
 * Single stage in a pipeline definition. The full pipeline is stored as a
 * JSON column on CrmPipeline.stages; the order of stages is the array order.
 */
export class PipelineStageDto {
  @ApiProperty({ example: 'LEAD', enum: DealStage })
  @IsEnum(DealStage)
  key: DealStage;

  @ApiProperty({ example: 'Lead', description: 'Display label for the UI.' })
  @IsString()
  @MaxLength(60)
  label: string;

  @ApiProperty({
    example: 20,
    description: 'Default probability (%) used when a deal lands on this stage.',
    minimum: 0,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultProbability: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Marks the terminal WON stage.',
  })
  @IsOptional()
  @IsBoolean()
  isWon?: boolean = false;

  @ApiPropertyOptional({
    default: false,
    description: 'Marks the terminal LOST stage.',
  })
  @IsOptional()
  @IsBoolean()
  isLost?: boolean = false;
}

/** POST /crm/pipelines — create a named pipeline with an ordered stage list. */
export class CreatePipelineDto {
  @ApiProperty({ example: 'Default Sales' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    type: [PipelineStageDto],
    description:
      'Ordered list of stages. Defaults to LEAD → QUALIFIED → PROPOSAL → NEGOTIATION → WON/LOST when omitted.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PipelineStageDto)
  stages?: PipelineStageDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** PATCH /crm/pipelines/:id — partial update on a pipeline. */
export class UpdatePipelineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: [PipelineStageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PipelineStageDto)
  stages?: PipelineStageDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
