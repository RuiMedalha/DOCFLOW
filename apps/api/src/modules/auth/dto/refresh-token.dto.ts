import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token issued at login' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ description: 'Refresh token to revoke on logout' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
