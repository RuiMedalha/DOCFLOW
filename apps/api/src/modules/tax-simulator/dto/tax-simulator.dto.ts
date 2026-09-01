import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Coerce a query string to a trimmed integer. Lets callers pass
 * `?year=2026&quarter=1` without having to know about the
 * enableImplicitConversion path in ValidationPipe.
 */
const ToInt = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return value;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  });

const ToStr = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Query for GET /tax-simulator/iva — Declaração Periódica de IVA.
 *
 * Window: a calendar year + a quarter in {1,2,3,4}.
 * `region` defaults to PT (continente); pass PT-AC / PT-MA for the Açores /
 * Madeira Declaração Periódica fields which use different rate columns.
 */
export class IvaSimulatorQueryDto {
  @ApiProperty({ example: 2026, description: 'Calendar year' })
  @Type(() => Number)
  @ToInt()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 1, description: 'Quarter (1..4)', enum: [1, 2, 3, 4] })
  @Type(() => Number)
  @ToInt()
  @IsInt()
  @IsIn([1, 2, 3, 4])
  quarter!: number;

  @ApiPropertyOptional({
    example: 'PT',
    description: 'Region (PT | PT-AC | PT-MA). Defaults to PT (continente).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  region?: string;
}

/**
 * Query for GET /tax-simulator/irc — IRC + autonomous taxation rough
 * estimate for a calendar year.
 */
export class IrcSimulatorQueryDto {
  @ApiProperty({ example: 2026, description: 'Calendar year' })
  @Type(() => Number)
  @ToInt()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

/**
 * Per-rate row returned by /tax-simulator/iva. Each row matches ONE of the
 * Declaração Periódica cells for the selected region:
 *   - PT:       Q1 base/tax @6, Q2 base/tax @13, Q3 base/tax @23
 *   - PT-AC:    Q1 base/tax @4, Q2 base/tax @9, Q3 base/tax @16
 *   - PT-MA:    Q1 base/tax @5, Q2 base/tax @12, Q3 base/tax @23 (sic — 22)
 *
 * `exemptBase` rolls up all Mxx (isento / não sujeito) bases for the
 * window; `exemptCount` is the number of line items that contributed.
 */
export interface IvaRateBucket {
  rate: number;
  kind: 'reduced' | 'intermediate' | 'normal' | 'exempt' | 'other';
  /** Taxable base for sales (liquidado) for this rate in the window. */
  baseLiquidado: number;
  /** Tax amount for sales (liquidado) for this rate in the window. */
  taxLiquidado: number;
  /** Taxable base for purchases (dedutível) for this rate in the window. */
  baseDeductivel: number;
  /** Tax amount for purchases (dedutível) for this rate in the window. */
  taxDeductivel: number;
  /** Number of documents that contributed to this bucket. */
  documentCount: number;
}

export interface IvaSimulatorResult {
  tenantId: string;
  year: number;
  quarter: number;
  region: 'PT' | 'PT-AC' | 'PT-MA';
  /** ISO start of the quarter window (inclusive). */
  windowStart: string;
  /** ISO end of the quarter window (exclusive — start of next quarter). */
  windowEnd: string;
  /** Buckets keyed by rate percentage (stringified for JSON stability). */
  buckets: Record<string, IvaRateBucket>;
  /** Sum of every liquidated tax in the window (sales output VAT). */
  totalLiquidado: number;
  /** Sum of every deductible tax in the window (input VAT). */
  totalDeductivel: number;
  /** totalLiquidado − totalDeductivel. Negative = credit (a favor). */
  ivaAPagar: number;
  /** Net taxable base (sum of taxable bases across buckets, excludes exempt). */
  totalBase: number;
  /** Documents in window — diagnostic. */
  documentCount: number;
  /** Notes for the user (PT legal references, warnings). */
  notes: string[];
}

/**
 * Per-account breakdown used by /tax-simulator/irc to give the user a
 * readable summary alongside the headline figures.
 */
export interface IrcAccountBucket {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Total debits in the year (positive cost). */
  debit: number;
  /** Total credits in the year (positive cost when negative for a contra). */
  credit: number;
  /** net = debit − credit (cost). Negative for a credit-balance account. */
  net: number;
}

export interface IrcSimulatorResult {
  tenantId: string;
  year: number;
  /** Total deductible expenses aggregated from PGC 6x accounts (cost of goods + services). */
  totalExpenses: number;
  /** Headline IRC estimate at the configured rate (rough, pre-CAF/préjuízo). */
  ircEstimado: number;
  /** Autonomous taxation (rough): 10% on a flat base (mock until payroll integration). */
  tributacaoAutonoma: number;
  /** Sum ircEstimado + tributacaoAutonoma. */
  totalEstado: number;
  /** Effective rate used for IRC (default 21% — PME regime). */
  ircRate: number;
  /** Effective rate used for autonomous taxation (default 10%). */
  autonomoRate: number;
  /** Top accounts by debit for context (PT SNC 6x). */
  topAccounts: IrcAccountBucket[];
  notes: string[];
}
