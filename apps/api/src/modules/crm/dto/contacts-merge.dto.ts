import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /crm/contacts/merge — merge N contacts into one master.
 *
 * `masterId` wins: every non-null field on the other contacts is overlaid
 * only when the master's value is null (we never overwrite existing data).
 * The non-master contacts are soft-deleted (isActive=false) and linked to
 * the master via `mergedIntoId` so we keep a paper trail.
 */
export class MergeContactsDto {
  @ApiProperty({
    description: 'Contact id that survives the merge (the master).',
    example: 'cm1234master',
  })
  @IsString()
  @MaxLength(64)
  masterId!: string;

  @ApiProperty({
    type: [String],
    description:
      'Contact ids to absorb into the master. After the merge, these are flagged isActive=false and recorded as mergedIntoId=masterId.',
    example: ['cm1234dup1', 'cm1234dup2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  duplicateIds!: string[];

  @ApiPropertyOptional({
    description:
      'If true, overwrite non-null fields on the master with non-null values from the duplicates. Default false (only fill nulls).',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overwrite?: boolean = false;
}

/** GET /crm/contacts/duplicates response — clusters of likely-duplicate contacts. */
export class DuplicateClusterDto {
  @ApiProperty({ example: 'nif:500697256' })
  reason!: string;

  @ApiProperty({ type: [String] })
  contactIds!: string[];

  @ApiProperty({ example: 0.92 })
  confidence!: number;
}

export class FindDuplicatesResponseDto {
  @ApiProperty({ type: [DuplicateClusterDto] })
  clusters!: DuplicateClusterDto[];

  @ApiProperty({ example: 12 })
  scanned!: number;
}