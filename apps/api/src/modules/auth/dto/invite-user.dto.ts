import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class InviteUserDto {
  @ApiProperty({ example: 'user@docflow.pt' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Maria Operadora' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: Role, example: Role.OPERADOR })
  @IsEnum(Role)
  role!: Role;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canViewBankValues?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canViewReconciliation?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canApprovePayments?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canExportData?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canManagePayroll?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  canManageIntegrations?: boolean;
}
