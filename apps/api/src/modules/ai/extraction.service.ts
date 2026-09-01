// extraction.service.ts — Regex + AT-QR + AI structured field extraction
// Ported from grok-documental extraction/extraction.service.ts + deep-seek-documental ocr/ocr.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ExtractedDocument {
  supplier?: { name: string; nif?: string; country?: string; address?: string; iban?: string; email?: string };
  customer?: { name: string; nif?: string; country?: string };
  documentType: string;
  documentNumber?: string;
  atcud?: string;
  documentDate?: string;
  dueDate?: string;
  currency: string;
  netAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  withholdingTax?: number;
  stampDuty?: number;
  cashDiscount?: number;
  cashDiscountRate?: number;
  taxBreakdown?: TaxBreakdown[];
  items?: InvoiceItem[];
  category?: string;
  sncCode?: string;
  ivaDeductible?: boolean;
  ivaDeductionRate?: number;
  confidence: number;
  extractionMethod: 'vision' | 'at_qr' | 'ocr_regex' | 'manual';
  processingTimeMs: number;
  source: string;
  hints: string[];
  originalText?: string;
}

export interface TaxBreakdown {
  region?: 'PT' | 'PT_MA' | 'PT_AZ' | 'UE' | 'EXTRA';
  taxRate: number;
  baseAmount: number;
  taxAmount: number;
}

export interface InvoiceItem {
  sku?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  taxRate?: number;
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Extract structured fields from raw OCR text or vision JSON.
   * Three-phase extraction: AT-QR > Regex patterns > AI structuring.
   */
  extractFromText(text: string): ExtractedDocument {
    const hints: string[] = [];
    const normalized = text.replace(/\r/g, '\n');

    // PHASE 1: AT-QR Code (highest priority — confidence 0.95)
    const qrResult = this.tryAtQrExtraction(normalized);
    if (qrResult) return qrResult;

    // PHASE 2: Regex extraction (NIF, dates, totals, IVA, IBAN, doc number)
    const regexResult = this.regexExtraction(normalized, hints);

    // PHASE 3: AI structuring (fill gaps with LLM) — STUB
    return regexResult;
  }

  /** Try to extract from AT QR Code embedded in text (Portuguese documents) */
  private tryAtQrExtraction(text: string): ExtractedDocument | null {
    // STUB: import and call at-qr.parser from grok-documental
    // Pattern: A:123456789*B:500000000*D:FT*F:20260315*...
    const atQrPattern = /(?:^|\*)A:\d{9}/;
    if (!atQrPattern.test(text)) return null;

    // TODO: implement AT-QR field parsing per AT spec (fields A-R)
    // See at-qr.parser.ts from grok-documental for full implementation
    return null;
  }

  /** Regex-based extraction (ported from deep-seek-documental + grok-documental) */
  private regexExtraction(text: string, hints: string[]): ExtractedDocument {
    let confidence = 0.0;

    // NIF: Portuguese 9-digit starting with 1/2/3/5/6/8
    const nifMatch = text.match(/(?:NIF|Contribuinte|N\.?\s*I\.?\s*F\.?)[:\s]*(\d{9})/i)
                  || text.match(/\b([123568]\d{8})\b/);
    const nif = nifMatch?.[1];
    if (nif) { hints.push(`nif:${nif}`); confidence += 0.25; }

    // Document number
    const numMatch = text.match(/(?:Fatura|Factura|FT|Invoice|N[º°\.]*\s*(?:Fatura|FT)?)[:\s#]*([A-Z0-9\/\-]+)/i);
    const docNumber = numMatch?.[1]?.trim();
    if (docNumber) { hints.push(`docNumber:${docNumber}`); confidence += 0.15; }

    // Dates
    const dateMatches = [...text.matchAll(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g)];
    let docDate: string | undefined;
    if (dateMatches[0]) {
      const [, d, m, y] = dateMatches[0];
      docDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      hints.push(`docDate:${docDate}`);
      confidence += 0.10;
    }

    // Due date
    const dueLabel = text.match(/(?:Vencimento|Data\s*limite|Due\s*date)[:\s]*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
    let dueDate: string | undefined;
    if (dueLabel) {
      dueDate = `${dueLabel[3]}-${dueLabel[2].padStart(2, '0')}-${dueLabel[1].padStart(2, '0')}`;
      hints.push(`dueDate:${dueDate}`);
    }

    // Total amount
    const totalMatch = text.match(/(?:Total\s*(?:a\s*pagar|il[ií]quido|com\s*IVA)?|Total\s*GERAL|Amount\s*due)[:\s]*€?\s*([\d\.,]+)/i)
                    || text.match(/TOTAL[:\s]*€?\s*([\d\.,]+)/i);
    const total = this.parsePtAmount(totalMatch?.[1]);
    if (total != null) { hints.push(`total:${total}`); confidence += 0.25; }

    // IVA
    const ivaMatch = text.match(/(?:IVA|VAT|I\.V\.A\.)[:\s]*€?\s*([\d\.,]+)/i);
    const iva = this.parsePtAmount(ivaMatch?.[1]);
    if (iva != null) { hints.push(`iva:${iva}`); confidence += 0.10; }

    // Supplier name heuristic
    const supplierLine = text.match(/(?:Fornecedor|Emitente|De|From)[:\s]+([^\n]{3,80})/i);
    const supplier = supplierLine?.[1]?.trim()?.slice(0, 120);
    if (supplier) { hints.push(`supplier:${supplier}`); confidence += 0.05; }

    // IBAN
    const ibanMatch = text.match(/\bPT\d{23}\b/i);
    const iban = ibanMatch?.[0];

    return {
      supplier: { name: supplier || '', nif, iban },
      documentType: 'OUTRO',
      documentNumber: docNumber,
      documentDate: docDate,
      dueDate,
      currency: 'EUR',
      totalAmount: total || 0,
      taxAmount: iva,
      confidence: Math.min(confidence, 0.95),
      extractionMethod: 'ocr_regex',
      processingTimeMs: 0,
      source: 'regex',
      hints,
    };
  }

  /** Parse Portuguese-formatted amount (1.250,50 → 1250.50) */
  private parsePtAmount(value?: string): number | undefined {
    if (!value) return undefined;
    const cleaned = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Compute confidence score based on which fields were extracted */
  computeConfidence(extracted: Partial<ExtractedDocument>): number {
    let score = 0;
    if (extracted.supplier?.nif)  score += 0.20;
    if (extracted.totalAmount)    score += 0.20;
    if (extracted.documentNumber) score += 0.15;
    if (extracted.documentDate)   score += 0.10;
    if (extracted.netAmount)      score += 0.10;
    if (extracted.taxAmount)      score += 0.10;
    if (extracted.supplier?.name)  score += 0.05;
    if (extracted.dueDate)         score += 0.05;
    if (extracted.atcud)           score += 0.03;
    if (extracted.items?.length)   score += 0.02;
    return Math.min(score, 1.0);
  }
}
