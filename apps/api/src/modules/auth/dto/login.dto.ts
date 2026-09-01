import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@docflow.pt' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin123!Secure' })
  @IsString()
  password!: string;

  @ApiProperty({ example: 'docflow-demo', description: 'Tenant slug (multi-tenant routing)' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  tenantSlug!: string;

  @ApiProperty({
    example: '123456',
    required: false,
    description: '6-digit TOTP code — required only if user has 2FA enabled',
  })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(10)
  twoFactorCode?: string;
}
