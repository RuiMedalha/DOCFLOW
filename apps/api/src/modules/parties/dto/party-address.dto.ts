import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PartyAddressType } from '@prisma/client';

/**
 * Body for POST /parties/:partyId/addresses — add a new address.
 *
 * `type` is one of the PartyAddressType enum values. The service layer
 * enforces "at most one isPrimary per (partyId, type)" via a transactional
 * advisory lock — see PartyAddressesService.create / update.
 */
export class CreatePartyAddressDto {
  @ApiProperty({
    enum: PartyAddressType,
    description: 'BILLING (faturação) / CORRESPONDENCE (postal) / OPERATIONAL (sede/armazém) / OTHER',
  })
  @IsEnum(PartyAddressType)
  type: PartyAddressType;

  @ApiProperty({ example: 'Rua dos Clientes, 12' })
  @IsString()
  @MaxLength(255)
  line1: string;

  @ApiPropertyOptional({ example: 'Piso 3, sala 7' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @ApiPropertyOptional({ example: '1050-070' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z\- ]{3,20}$/, {
    message: 'Código postal inválido',
  })
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Lisboa' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'PT',
    description: 'ISO 3166-1 alpha-2 country code',
    default: 'PT',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Marque como primário deste tipo (BILLING/CORRESPONDENCE/...)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** PATCH /parties/:partyId/addresses/:id — every field optional. */
export class UpdatePartyAddressDto extends PartialType(CreatePartyAddressDto) {}
