// duplicate.service.ts — Three-tier duplicate detection: SHA-256 hash → perceptual dHash → semantic vector
// Design: §6 — Ported from grok-documental + deep-seek-documental hash dedup patterns

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  tier: 'exact_hash' | 'perceptual' | 'semantic' | 'none';
  confidence: number;
  matchedDocumentId?: string;
  matchedFileName?: string;
  similarity?: number;
  reason?: string;
}

export interface BatchDuplicateReport {
  totalDocuments: number;
  duplicatesFound: number;
  uniqueDocuments: number;
  groups: DuplicateGroup[];
}

export interface DuplicateGroup {
  documents: { id: string; fileName: string; uploadDate: string }[];
  detectionTier: string;
  recommendedAction: 'keep_first' | 'keep_latest' | 'manual_review';
}

@Injectable()
export class DuplicateService {
  private readonly logger = new Logger(DuplicateService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check if a document is a duplicate.
   * Tier 1 (exact hash): O(1) — SHA-256 indexed lookup. Auto-block if match.
   * Tier 2 (perceptual): O(n) — dHash Hamming distance < 5. Flag for review.
   * Tier 3 (semantic): O(log n) — cosine similarity of extracted fields > 0.98. Flag.
   */
  async check(tenantId: string, fileBuffer: Buffer, fileName: string): Promise<DuplicateCheckResult> {
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // TIER 1: Exact hash match
    const exactMatch = await this.prisma.document.findFirst({
      where: { tenantId, fileHash: hash, status: { not: 'ARQUIVADO' as any } },
    });
    if (exactMatch) {
      return {
        isDuplicate: true,
        tier: 'exact_hash',
        confidence: 1.0,
        matchedDocumentId: exactMatch.id,
        matchedFileName: exactMatch.fileName || exactMatch['fileName'],
        reason: 'SHA-256 hash identico — ficheiro exatamente igual',
      };
    }

    // TIER 2: Perceptual hash — STUB
    // const dHash = await this.computeDHash(fileBuffer);
    // Query all tenant documents, compute Hamming distances, flag if < 5

    // TIER 3: Semantic vector similarity — STUB
    // Embed (supplier + total + date) and compare with pgvector cosine search

    return { isDuplicate: false, tier: 'none', confidence: 0.0 };
  }

  /** Batch duplicate check across a set of documents */
  async checkBatch(tenantId: string, documentIds: string[]): Promise<BatchDuplicateReport> {
    this.logger.log(`Batch duplicate check: ${documentIds.length} documents`);
    // STUB: pairwise comparison within batch + against existing corpus
    return {
      totalDocuments: documentIds.length,
      duplicatesFound: 0,
      uniqueDocuments: documentIds.length,
      groups: [],
    };
  }

  /** Compute perceptual hash (dHash) using sharp */
  async computeDHash(buffer: Buffer): Promise<string> {
    // STUB: sharp(buffer).resize(9,8).grayscale().raw().toBuffer()
    //   → compute difference hash (64-bit string)
    return '0'.repeat(64); // STUB
  }

  /** Hamming distance between two hash strings */
  hammingDistance(h1: string, h2: string): number {
    let dist = 0;
    for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) dist++;
    return dist;
  }
}
