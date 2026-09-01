import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ContactType } from '@prisma/client';

/**
 * POST /crm/contacts — create a CrmContact (company or individual).
 *
 * NIF is validated with the @docflow/shared PT utility before any DB write.
 * `partyId` (optional) links the contact to an existing master Party row so
 * duplicates between master data and CRM stay in sync.
 */
export class CreateContactDto {
  @ApiProperty({
    enum: ContactType,
    default: ContactType.COMPANY,
    description: 'COMPANY or INDIVIDUAL.',
  })
  @IsEnum(ContactType)
  type: ContactType = ContactType.COMPANY;

  @ApiProperty({ example: 'EDP Comercial, SA' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: '500697256',
    description: 'PT NIF (9 digits, mod-11). Validated server-side.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'NIF must be 9 digits' })
  nif?: string;

  @ApiPropertyOptional({ example: 'clientes@edp.pt' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+351 210 000 000' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '+351 910 000 000' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mobile?: string;

  @ApiPropertyOptional({ example: 'Rua dos Clientes, 12' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'Lisboa' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: '1050-070' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Portugal', default: 'Portugal' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ example: 'https://www.edp.pt' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @ApiPropertyOptional({ example: 'Energia' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ example: 'Notas internas…' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['cliente-priority', 'energia'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Optional id of an existing Party row from the parties module to link this CRM contact to.',
  })
  @IsOptional()
  @IsString()
  partyId?: string;
}

/** PATCH /crm/contacts/:id — every field optional, plus isActive toggle. */
export class UpdateContactDto extends PartialType(CreateContactDto) {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

/** Body for POST /crm/contacts/:id/persons — add a contact person. */
export class CreateContactPersonDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'Diretor Financeiro' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional({ example: 'joao.silva@edp.pt' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+351 910 000 000' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPrimary?: boolean;
}

/** PATCH /crm/persons/:id — partial update on a single contact person. */
export class UpdateContactPersonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPrimary?: boolean;
}

/** Query string for GET /crm/contacts. */
export class ContactQueryDto {
  @ApiPropertyOptional({ enum: ContactType })
  @IsOptional()
  @IsEnum(ContactType)
  type?: ContactType;

  @ApiPropertyOptional({ example: 'edp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;

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
