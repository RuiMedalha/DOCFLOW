// embedding.service.ts — Deterministic hash-based embedding for MVP
// Design: §8.1 — 256-dim bag-of-words projection with feature hashing.
// No external API required: deterministic so retrieval is reproducible in
// dev/CI. Real OpenAI embeddings can be swapped in later by replacing
// `embedText()`; the rest of the pipeline only needs the vector shape.

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

export interface TextChunk {
  index: number;
  content: string;
  metadata: {
    documentId: string;
    field: string;     // 'supplier' | 'items' | 'total' | 'full_text'
    page?: number;
  };
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  readonly dimensions = 256;
  private readonly chunkSize = 80;       // words per chunk
  private readonly chunkOverlap = 16;

  /**
   * Deterministic bag-of-words projection.
   * Each token is hashed into one of `dimensions` buckets; the bucket
   * value is the token's term-frequency. The vector is L2-normalised so
   * cosine similarity between two vectors falls in [0, 1].
   */
  embedText(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    if (!text) return vec;

    const tokens = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // strip accents (PT)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && t.length <= 24);

    if (tokens.length === 0) return vec;

    for (const tok of tokens) {
      const h = createHash('sha1').update(tok).digest();
      const bucket = (h[0] * 256 + h[1]) % this.dimensions;
      vec[bucket] += 1;
    }

    // L2 normalise
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / mag;
    return vec;
  }

  /** Embed a single query string → 256-d vector */
  async embedQuery(query: string): Promise<number[]> {
    return this.embedText(query);
  }

  /** Chunk document text into overlapping word-window segments */
  chunkText(text: string, documentId: string, field = 'full_text'): TextChunk[] {
    if (!text || text.trim().length === 0) return [];

    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const chunks: TextChunk[] = [];
    let index = 0;
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + this.chunkSize, words.length);
      const content = words.slice(start, end).join(' ');
      chunks.push({
        index: index++,
        content,
        metadata: { documentId, field },
      });
      start += this.chunkSize - this.chunkOverlap;
    }

    return chunks;
  }

  /** Embed document text and return chunk vectors for vector-store insertion */
  async embedDocument(
    documentId: string,
    text: string,
    field = 'full_text',
  ): Promise<{ chunk: TextChunk; vector: number[] }[]> {
    const chunks = this.chunkText(text, documentId, field);
    return chunks.map((chunk) => ({
      chunk,
      vector: this.embedText(chunk.content),
    }));
  }
}
