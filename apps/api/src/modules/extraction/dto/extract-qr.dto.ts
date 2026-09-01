import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Payload for POST /extraction/documents/:id/at-qr — manual paste of an
 * AT QR payload captured by a camera or external scanner. Service-layer
 * parsing/validation runs through `@docflow/shared/portuguese/qr-at`.
 */
export class ExtractAtQrDto {
  @ApiProperty({
    description: 'Raw QR-AT payload text (fields A:R separated by `*`).',
    example:
      'A:500000000*B:123456789*D:FT*E:N*F:20260315*G:FT 2026/1*H:J66S9FDD-1*I1:PT*I7:100.00*O:123.00*Q:abcd*R:1234',
    minLength: 10,
    maxLength: 4096,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  qrText!: string;
}