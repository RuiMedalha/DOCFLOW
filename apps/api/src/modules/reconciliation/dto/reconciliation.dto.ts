import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MatchStatus, MatchType } from '@prisma/client';

/**
 * Query string for GET /reconciliation/suggestions. Status defaults to
 * PENDING (the inbox of pending matches awaiting human review).
 */
export class ListSuggestionsQueryDto {
  @ApiPropertyOptional({
    enum: MatchStatus,
    default: MatchStatus.PENDING,
    description: 'Filter suggestions by status. Defaults to PENDING.',
  })
  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus = MatchStatus.PENDING;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({
    enum: MatchType,
    description: 'Filter by minimum tier.',
  })
  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;
}

/**
 * Compact suggestion payload returned by the list endpoint.
 * Stays JSON-safe (Decimals → number, dates → ISO).
 */
export class MatchSuggestionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: MatchStatus }) status!: MatchStatus;
  @ApiProperty({ enum: MatchType }) matchType!: MatchType;
  @ApiProperty({ example: 0.85 }) score!: number;
  @ApiPropertyOptional() reason?: string | null;
  @ApiProperty() createdAt!: string;

  @ApiPropertyOptional() expenseId?: string | null;
  @ApiPropertyOptional() invoiceId?: string | null;
  @ApiPropertyOptional() documentId?: string | null;

  @ApiProperty({
    description: 'Bank transaction payload (subset).',
  })
  bankTransaction!: {
    id: string;
    date: string;
    description: string;
    amount: number;
    reference: string | null;
    counterpartyName: string | null;
  };

  @ApiPropertyOptional({
    description: 'Linked expense (if any).',
  })
  expense?: {
    id: string;
    description: string | null;
    amount: number;
    supplier: string | null;
  } | null;

  @ApiPropertyOptional({
    description: 'Linked invoice (if any).',
  })
  invoice?: {
    id: string;
    number: string | null;
    amount: number;
    customer: string | null;
  } | null;

  @ApiPropertyOptional({
    description: 'Linked document (if any).',
  })
  document?: {
    id: string;
    fileName: string;
    docNumber: string | null;
    total: number | null;
    supplier: string | null;
  } | null;
}

/**
 * Wrapped paginated list. Same envelope the other modules use.
 */
export class PaginatedSuggestionsDto {
  @ApiProperty({ type: [MatchSuggestionResponseDto] })
  items!: MatchSuggestionResponseDto[];
  meta!: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Response for POST /reconciliation/run.
 */
export class RunMatchingResponseDto {
  @ApiProperty({ example: 312 })
  scannedTransactions!: number;

  @ApiProperty({ example: 47 })
  suggestionsCreated!: number;

  @ApiProperty({ description: 'Tier breakdown of the new suggestions.' })
  byType!: {
    STRONG: number;
    MEDIUM: number;
    WEAK: number;
  };

  @ApiProperty({ description: 'Wall-clock duration in ms.' })
  durationMs!: number;
}