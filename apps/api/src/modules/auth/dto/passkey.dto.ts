import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class PasskeyChallengeDto {
  @ApiProperty({ required: false, description: 'User email; if omitted a generic challenge is issued' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  email?: string;
}

export class PasskeyVerifyDto {
  @ApiProperty({ description: 'WebAuthn challenge id issued by /auth/passkey/challenge' })
  @IsString()
  @MinLength(8)
  challengeId!: string;

  @ApiProperty({ description: 'Base64URL-encoded WebAuthn attestation/assertion' })
  @IsString()
  @MinLength(8)
  credential!: string;
}
