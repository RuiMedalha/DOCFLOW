import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'DocFlow Demo Lda', description: 'Tenant / company name' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  tenantName!: string;

  @ApiProperty({ example: 'docflow-demo', description: 'Unique tenant slug (URL-safe)' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, digits or dashes' })
  tenantSlug!: string;

  @ApiProperty({ example: '500123456', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'NIF must be 9 digits' })
  tenantNif?: string;

  @ApiProperty({ example: 'admin@docflow.pt' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin123!Secure' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}
