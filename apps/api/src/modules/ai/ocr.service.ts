// ocr.service.ts — Tesseract.js v5 WASM fallback OCR service
// Design: §3 — used when vision API fails or for text-based PDFs

import { Injectable, Logger } from '@nestjs/common';
// import { createWorker, Worker } from 'tesseract.js'; // uncomment when installed

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private workerPool: unknown[] = []; // Worker[]
  private initialized = false;

  /** Supported languages: Portuguese + English + French + Spanish */
  private readonly languages = 'por+eng+fra+spa';

  /** Initialize Tesseract.js worker pool */
  async initialize(workerCount = 2): Promise<void> {
    this.logger.log(`Initializing OCR worker pool (count=${workerCount}, langs=${this.languages})`);
    // STUB: production — createWorker({ langPath, gzip: false }) per worker
    // Workers are configured with OEM 3 (LSTM+Legacy) and PSM 3 (Auto)
    this.initialized = true;
  }

  /** Extract text from an image buffer using Tesseract */
  async extractFromImage(buffer: Buffer, lang?: string): Promise<string> {
    if (!this.initialized) await this.initialize();
    // STUB: worker.recognize(buffer, { lang: lang || this.languages })
    //        → return result.data.text
    this.logger.log(`OCR: image extraction (${buffer.length} bytes)`);
    return ''; // STUB
  }

  /** Extract text from a PDF using pdf-parse (searchable) or pdf-poppler → Tesseract (scanned) */
  async extractFromPdf(filePath: string): Promise<string> {
    this.logger.log(`OCR: PDF extraction from ${filePath}`);
    // STUB:
    // 1. Try pdf-parse for searchable PDFs
    // 2. If empty text → convert pages to images (pdf-poppler)
    // 3. Run Tesseract on each page
    // 4. Concatenate page texts
    return ''; // STUB
  }

  /** Preprocess image for better OCR accuracy using sharp */
  async enhanceForOcr(buffer: Buffer): Promise<Buffer> {
    // STUB: sharp(buffer)
    //   .grayscale()
    //   .normalize()
    //   .linear(1.4, 0)       // contrast boost
    //   .median(1)            // denoise
    //   .threshold(128)       // or otsu adaptive
    //   .toBuffer()
    return buffer; // STUB
  }

  /** Detect language of extracted text using franc-min */
  detectLanguage(text: string): string {
    // STUB: franc(text, { minLength: 5, only: ['por','eng','fra','spa'] })
    if (!text || text.length < 10) return 'por';
    // Simple heuristic for Portuguese characters
    if (/[áàãâéêíóôõúç]/.test(text)) return 'por';
    return 'eng';
  }

  /** Shutdown workers gracefully */
  async shutdown(): Promise<void> {
    // STUB: await Promise.all(this.workerPool.map(w => w.terminate()))
    this.initialized = false;
  }
}
