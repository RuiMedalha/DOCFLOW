import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Standalone parse request (no Document side-effects). Used by preview
 * UIs and the bulk-import wizard to validate QR payloads before commit.
 */
export class ParseAtQrDto {
  @ApiProperty({ description: 'Raw QR-AT payload text.', minLength: 10, maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  qrText!: string;
}