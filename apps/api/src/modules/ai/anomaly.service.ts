// anomaly.service.ts — Fraud signal detection in document batches
// Design: §7 — 10 signal types, severity-weighted scoring

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnomalyReport {
  documentId: string;
  signals: AnomalySignal[];
  totalScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedAction: 'review' | 'block' | 'flag' | 'ignore';
}

export interface AnomalySignal {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  weight: number;
  description: string;
  evidence: string;
}

export interface BatchAnomalyReport {
  scannedCount: number;
  cleanCount: number;
  flaggedCount: number;
  reports: AnomalyReport[];
  summary: string;
}

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(private prisma: PrismaService) {}

  /** Severity weights for each signal type */
  private readonly weights: Record<string, number> = {
    DUPLICATE_NUMBER: 30,     // CRITICAL: same doc number, different hash
    INCONSISTENT_TAX: 25,     // HIGH: tax doesn't match rate × base
    IBAN_MISMATCH: 25,         // HIGH: IBAN != known supplier IBAN
    DUPLICATE_AMOUNT: 20,      // HIGH: same total + supplier in 24h
    MISSING_NIF: 15,           // MEDIUM: no valid NIF on fiscal doc
    BURST_UPLOAD: 15,          // MEDIUM: >20 docs from same IP in 60s
    SUSPICIOUS_TOTAL: 10,      // MEDIUM: total > 3σ vs supplier history
    DATE_ANOMALY: 5,           // LOW: date > 30d future or > 2y past
    ROUND_AMOUNTS: 3,          // LOW: multiple .00 totals in batch
    STRUCTURE_DRIFT: 3,         // LOW: embedding differs from supplier centroid
  };

  /** Severity label from weight */
  private severityLabel(weight: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (weight >= 25) return 'CRITICAL';
    if (weight >= 20) return 'HIGH';
    if (weight >= 10) return 'MEDIUM';
    return 'LOW';
  }

  /** Risk level from total score */
  private riskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 50) return 'CRITICAL';
    if (score >= 30) return 'HIGH';
    if (score >= 15) return 'MEDIUM';
    return 'LOW';
  }

  /** Recommended action from risk level */
  private recommendedAction(level: string): 'review' | 'block' | 'flag' | 'ignore' {
    if (level === 'CRITICAL') return 'block';
    if (level === 'HIGH') return 'review';
    if (level === 'MEDIUM') return 'flag';
    return 'ignore';
  }

  /**
   * Scan a single document for anomalies.
   * Compares extracted fields against historical data and known patterns.
   */
  async scanDocument(tenantId: string, documentId: string): Promise<AnomalyReport> {
    const signals: AnomalySignal[] = [];

    // STUB — production checks:
    // 1. Load document + extracted fields from DB
    // 2. Query supplier historical totals → compute z-score (SUSPICIOUS_TOTAL)
    // 3. Query supplier known IBAN → compare (IBAN_MISMATCH)
    // 4. Check tax amount vs rate × base (INCONSISTENT_TAX)
    // 5. Check document date validity (DATE_ANOMALY)
    // 6. Check for same number, different hash (DUPLICATE_NUMBER)
    // 7. Check IP rate limiting (BURST_UPLOAD)

    const totalScore = signals.reduce((sum, s) => sum + s.weight, 0);
    const level = this.riskLevel(totalScore);

    return {
      documentId,
      signals,
      totalScore,
      riskLevel: level,
      recommendedAction: this.recommendedAction(level),
    };
  }

  /** Batch anomaly scan — runs scanDocument on each ID */
  async scanBatch(tenantId: string, documentIds: string[]): Promise<BatchAnomalyReport> {
    this.logger.log(`Anomaly scan: ${documentIds.length} documents`);

    const reports = await Promise.all(
      documentIds.map(id => this.scanDocument(tenantId, id)),
    );

    const cleanCount = reports.filter(r => r.signals.length === 0).length;
    const flaggedCount = reports.length - cleanCount;

    return {
      scannedCount: documentIds.length,
      cleanCount,
      flaggedCount,
      reports,
      summary: `${flaggedCount}/${documentIds.length} documentos com anomalias detectadas`,
    };
  }

  /** Compute z-score for a value against historical data */
  computeZScore(value: number, historicalValues: number[]): number {
    if (historicalValues.length < 3) return 0;
    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const variance = historicalValues.reduce((a, b) => a + (b - mean) ** 2, 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? 0 : (value - mean) / stdDev;
  }
}
