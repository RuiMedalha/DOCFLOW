import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ContactType } from '@prisma/client';

/**
 * A single source-row from HubSpot / Pipedrive (mocked). The shape is
 * intentionally lenient: real exports include extra fields we ignore. The
 * mapping step is responsible for picking the canonical DocFlow column.
 */
export class ImportContactRowDto {
  @ApiProperty({ description: 'External id from the source CRM.' })
  @IsString()
  externalId: string;

  @ApiProperty({
    description:
      'Arbitrary fields from the source CRM. Keys depend on the source (hubspot / pipedrive).',
    example: {
      name: 'EDP Comercial, SA',
      nif: '500697256',
      email: 'clientes@edp.pt',
      phone: '+351 210 000 000',
      city: 'Lisboa',
    },
  })
  @IsObject()
  fields: Record<string, unknown>;
}

/** Field mapping table. Each entry is `sourceField → targetColumn`. */
export class ImportFieldMappingDto {
  @ApiProperty({
    description:
      'Maps an external field name to a DocFlow CrmContact column (name, nif, email, phone, mobile, city, address, postalCode, country, website, industry, notes, type, tags).',
    example: { company: 'name', vat_number: 'nif', email_address: 'email' },
  })
  @IsObject()
  fields: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'How to interpret the "type" value from the source. Keys are external values, values are ContactType enums. Defaults to COMPANY for unknown values.',
    example: { person: 'INDIVIDUAL', company: 'COMPANY' },
  })
  @IsOptional()
  @IsObject()
  typeMap?: Record<string, ContactType>;
}

/** POST /crm/import — bulk import contacts from an external CRM. */
export class ImportContactsDto {
  @ApiProperty({
    enum: ['hubspot', 'pipedrive'],
    description: 'Source CRM (only the two adapters are supported today).',
  })
  @IsEnum(['hubspot', 'pipedrive'] as const)
  source: 'hubspot' | 'pipedrive';

  @ApiProperty({
    type: [ImportContactRowDto],
    description: 'Source rows to import.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportContactRowDto)
  rows: ImportContactRowDto[];

  @ApiProperty({ type: ImportFieldMappingDto })
  @ValidateNested()
  @Type(() => ImportFieldMappingDto)
  mapping: ImportFieldMappingDto;

  @ApiPropertyOptional({
    default: false,
    description:
      'When true, do NOT persist anything. Returns the would-be result so the caller can preview the import before committing.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, rows that match an existing contact by NIF or email are merged (only null/empty fields are updated).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mergeExisting?: boolean = false;
}

/** A single per-row result entry, returned from the import endpoint. */
export class ImportContactResultDto {
  @ApiProperty()
  externalId: string;

  @ApiPropertyOptional({ description: 'DocFlow contact id (created or merged).' })
  id?: string;

  @ApiProperty({ enum: ['created', 'merged', 'skipped', 'failed'] })
  outcome: 'created' | 'merged' | 'skipped' | 'failed';

  @ApiPropertyOptional({ description: 'Human-readable note (e.g. skip reason).' })
  reason?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Validation problems for this row.',
  })
  warnings?: string[];
}

/** Full response payload returned by POST /crm/import. */
export class ImportContactsResponseDto {
  @ApiProperty({ description: 'Echo of the source.' })
  source: 'hubspot' | 'pipedrive';

  @ApiProperty()
  dryRun: boolean;

  @ApiProperty()
  created: number;

  @ApiProperty()
  merged: number;

  @ApiProperty()
  skipped: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: [ImportContactResultDto] })
  results: ImportContactResultDto[];

  @ApiProperty()
  startedAt: string;

  @ApiProperty()
  finishedAt: string;
}
