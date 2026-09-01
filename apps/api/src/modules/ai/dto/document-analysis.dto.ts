import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export enum DocumentAnalysisProvider {
  GEMINI = 'gemini',
  CLAUDE = 'claude',
  AUTO = 'auto',
}

export class DocumentAnalysisRequestDto {
  @ApiProperty({
    enum: DocumentAnalysisProvider,
    required: false,
    description: 'Preferred vision/LLM provider for the first pass',
  })
  @IsOptional()
  @IsEnum(DocumentAnalysisProvider)
  preferredProvider?: DocumentAnalysisProvider;

  @ApiProperty({ required: false, description: 'Skip the vision/OCR step' })
  @IsOptional()
  @IsBoolean()
  skipVision?: boolean;

  @ApiProperty({ required: false, description: 'Force OCR even if vision succeeded' })
  @IsOptional()
  @IsBoolean()
  forceOcr?: boolean;
}

export class DocumentAnalysisResponseDto {
  @ApiProperty()
  documentId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ type: [String] })
  pipeline!: string[];
}