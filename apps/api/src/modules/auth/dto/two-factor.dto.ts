import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class TwoFactorSetupDto {
  @ApiProperty({
    description: 'Initial 6-digit TOTP code from authenticator to confirm enrollment',
    example: '123456',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'TOTP code must be exactly 6 digits' })
  token!: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  token!: string;
}

export class TwoFactorDisableDto {
  @ApiProperty({ description: 'Current password confirmation' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ description: 'Last 6-digit TOTP code' })
  @IsString()
  @Matches(/^\d{6}$/)
  token!: string;
}
