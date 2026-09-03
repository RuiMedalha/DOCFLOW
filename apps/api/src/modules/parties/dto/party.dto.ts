import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PartyType } from '@prisma/client';

/**
 * Body for POST /parties — create a supplier/customer/both.
 *
 * NIF/IBAN are validated with the @docflow/shared PT utilities BEFORE the
 * service touches the database; we surface 400s here so the controller can
 * return them without an audit write.
 */
export class CreatePartyDto {
  @ApiProperty({
    enum: PartyType,
    default: PartyType.FORNECEDOR,
    description: 'Supplier, customer, or both (the master Party record)',
  })
  @IsEnum(PartyType)
  type: PartyType = PartyType.FORNECEDOR;

  @ApiProperty({ example: 'EDP Comercial — Comercialização de Energia, SA' })
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
  @IsString()
  @MaxLength(255)
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

  @ApiPropertyOptional({
    example: 'PT50000201231234567890154',
    description: 'IBAN (ISO 13616 + ISO 7064 MOD-97). Validated server-side.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;

  @ApiPropertyOptional({ example: 'BCOMPTPL', description: 'SWIFT/BIC' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  bic?: string;

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

  @ApiPropertyOptional({ example: 'PT', default: 'PT' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
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
    example: ['fornecedor', 'eletricidade'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 30, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  paymentTermDays?: number;

  @ApiPropertyOptional({
    description: 'Account.id used as default DEBIT in the journal entry',
  })
  @IsOptional()
  @IsString()
  defaultDebitAccountId?: string;

  @ApiPropertyOptional({
    description: 'Account.id used as default CREDIT in the journal entry',
  })
  @IsOptional()
  @IsString()
  defaultCreditAccountId?: string;

  @ApiPropertyOptional({
    description: 'External CRM/ERP ids: { hubspot, pipedrive, moloni, woocommerce }',
  })
  @IsOptional()
  externalIds?: Record<string, string | number | null>;
}

/** PATCH /parties/:id — every field optional. */
export class UpdatePartyDto extends PartialType(CreatePartyDto) {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Marks this party as a recurring supplier (auto-set by extraction).',
  })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({
    description:
      'ADMIN-only. When true, freezes isRecurring so the auto-flip in supplier-resolver pauses.',
  })
  @IsOptional()
  @IsBoolean()
  isRecurringManualOverride?: boolean;
}

/** Query string for GET /parties. */
export class PartyQueryDto {
  @ApiPropertyOptional({ enum: PartyType })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  @ApiPropertyOptional({ example: 'edp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ example: true, description: 'Default true' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;

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
}

/** Body for POST /parties/:id/iban/verify — flip ibanVerified=true. */
export class MarkVerifiedIbanDto {
  @ApiPropertyOptional({
    example: 'verified via phone call to contacto+351 21 000 0000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Body for POST /parties/:id/iban/flag — flip ibanFlagged=true. */
export class FlagIbanDto {
  @ApiProperty({
    example: 'IBAN differs from QR-AT payload on the most recent invoice',
  })
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ example: 90, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  riskScore?: number;
}
