import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Response from `POST /parties/:id/enrich` and
 * `GET /parties/:id/enrichment`. Tells the UI which provider ran,
 * which fields were filled, and which (if any) errored.
 *
 * `source` is one of:
 *   - 'sabi-pt'    — Sabi PT returned data
 *   - 'vies'       — VIES returned data
 *   - 'manual'     — extra-EU / no provider available; row untouched
 *   - 'cached'     — fresh cache hit (< 30d); no provider called
 *   - 'no_data'    — provider called, no fields returned
 */
export class EnrichmentResponseDto {
  @ApiProperty({ example: 'sabi-pt', enum: ['sabi-pt', 'vies', 'manual', 'cached', 'no_data'] })
  source!: 'sabi-pt' | 'vies' | 'manual' | 'cached' | 'no_data';

  @ApiProperty({ example: ['email', 'address', 'city'], type: [String] })
  fieldsPopulated!: string[];

  @ApiPropertyOptional({ example: 'rate_limited' })
  error?: string | null;

  @ApiProperty({ example: '2026-09-05T12:34:56.000Z' })
  fetchedAt!: string;
}

/**
 * Path params for `/parties/:id/enrich` and `/parties/:id/enrichment`.
 * `id` is the Party cuid. RBAC enforced at the controller (ADMIN only
 * for the manual trigger; any authenticated user for the GET status).
 */
export class EnrichmentPathDto {
  @ApiProperty({ description: 'Party cuid' })
  @IsString()
  id!: string;
}

/**
 * Optional body for POST /parties/:id/enrich — caller can force a
 * provider override (e.g. a tool that wants to test VIES against a
 * PT NIF without going through the factory). When omitted, the
 * factory picks based on country/iban.
 */
export class EnrichPartyDto {
  @ApiPropertyOptional({
    enum: ['sabi-pt', 'vies', 'manual'],
    description:
      'Force a specific provider. When omitted the factory picks based on Party.country/iban.',
  })
  @IsOptional()
  @IsIn(['sabi-pt', 'vies', 'manual'])
  forceProvider?: 'sabi-pt' | 'vies' | 'manual';
}
