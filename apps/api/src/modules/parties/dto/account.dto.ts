import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AccountType } from '@prisma/client';

/**
 * Body for POST /accounts — create a PT chart-of-accounts entry.
 *
 * `code` is the official PGC code (1–2 digit roots; e.g. "221", "62", "31").
 * The unique constraint is per-tenant on (tenantId, code), enforced by Prisma.
 */
export class CreateAccountDto {
  @ApiProperty({ example: '221', description: 'PGC / SNC code (numeric string)' })
  @IsString()
  @Matches(/^\d{1,6}$/, { message: 'code must be numeric (1..6 digits)' })
  code: string;

  @ApiProperty({ example: 'Fornecedores c/corrente' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    enum: AccountType,
    default: AccountType.EXPENSE,
  })
  @IsEnum(AccountType)
  type: AccountType = AccountType.EXPENSE;

  @ApiPropertyOptional({ example: '22' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  parentCode?: string;

  @ApiPropertyOptional({ description: 'parent Account.id (overrides parentCode)' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

/** PATCH /accounts/:id — every field optional. */
export class UpdateAccountDto extends PartialType(CreateAccountDto) {}

/** Query string for GET /accounts. */
export class AccountQueryDto {
  @ApiPropertyOptional({ enum: AccountType })
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @ApiPropertyOptional({ example: '22' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  parentCode?: string;

  @ApiPropertyOptional({ example: true, description: 'Default true' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean = true;

  @ApiPropertyOptional({ example: 'fornec' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 100, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;
}
