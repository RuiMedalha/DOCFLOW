// copilot-query.dto.ts — DTOs for Copilot chat and query operations

import { IsString, IsOptional, IsArray, ValidateNested, IsEnum, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageDto {
  @IsEnum(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @IsString()
  content: string;
}

export class CopilotQueryDto {
  @IsString()
  @MinLength(2)
  query: string;

  @IsString()
  tenantId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  history?: MessageDto[];

  @IsOptional()
  @IsString()
  preferredProvider?: 'gemini' | 'claude' | 'openai' | 'auto';
}

export class CopilotResponseDto {
  answer: string;
  sources: { documentId: string; field: string; snippet: string }[];
  confidence: number;
  suggestedFollowUps: string[];
}
