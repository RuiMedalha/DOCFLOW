// classification.service.ts — Document type & category classification
// Design: §4 — 5-pass strategy: filename → AT-QR → Vision AI → keyword → embedding

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type DocumentType =
  | 'FATURA_RECEBIDA' | 'FATURA_EMITIDA' | 'FATURA_SIMPLIFICADA'
  | 'FATURA_RECIBO' | 'NOTA_CREDITO' | 'NOTA_DEBITO'
  | 'RECIBO_PAGAMENTO' | 'RECIBO_VERDE'
  | 'GUIA_TRANSPORTE' | 'GUIA_REMESSA'
  | 'DUA_IMPORTACAO' | 'DUA_EXPORTACAO' | 'DOC_ADUANEIRO_UE'
  | 'EXTRATO_BANCARIO' | 'COMPROVATIVO_TRANSFERENCIA' | 'COMPROVATIVO_PAGAMENTO'
  | 'RECIBO_VENCIMENTO' | 'DECLARACAO_REMUNERACOES' | 'SEGURANCA_SOCIAL'
  | 'CONTRATO' | 'PROPOSTA' | 'ENCOMENDA'
  | 'CORRESPONDENCIA' | 'OUTRO' | 'NAO_IDENTIFICADO';

export interface ClassificationResult {
  documentType: DocumentType;
  category?: string;
  sncCode?: string;
  ivaDeductible?: boolean;
  ivaDeductionRate?: number;
  confidence: number;
  method: 'filename' | 'at_qr' | 'vision' | 'keyword' | 'embedding';
}

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(private prisma: PrismaService) {}

  /** Multi-pass classification pipeline */
  async classify(documentId: string, extractedText?: string): Promise<ClassificationResult> {
    // PASS 1: Filename heuristics
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new Error('Document not found');

    const filenameResult = this.classifyByFilename(doc.fileName);
    if (filenameResult && filenameResult.confidence >= 0.8) return filenameResult;

    // PASS 2: AT-QR code (if available in metadata)
    const qrResult = this.classifyByAtQr(doc.metadata as Record<string, unknown>);
    if (qrResult && qrResult.confidence >= 0.95) return qrResult;

    // PASS 3: Keyword matching on OCR/extracted text
    if (extractedText) {
      const keywordResult = this.classifyByKeywords(extractedText);
      if (keywordResult.confidence >= 0.6) return keywordResult;
    }

    // PASS 4: Vision AI classification — STUB (call Gemini with classification prompt)
    // PASS 5: Embedding similarity to type centroids — STUB

    return {
      documentType: 'NAO_IDENTIFICADO',
      confidence: 0.1,
      method: 'keyword',
    };
  }

  /** PASS 1: Filename-based classification */
  private classifyByFilename(fileName: string): ClassificationResult | null {
    const f = fileName.toUpperCase();

    if (/\bFT[_\-\s]/.test(f) || /\bFATURA\b/.test(f)) return { documentType: 'FATURA_RECEBIDA', confidence: 0.80, method: 'filename' };
    if (/\bFS[_\-\s]/.test(f)) return { documentType: 'FATURA_SIMPLIFICADA', confidence: 0.80, method: 'filename' };
    if (/\bFR[_\-\s]/.test(f)) return { documentType: 'FATURA_RECIBO', confidence: 0.80, method: 'filename' };
    if (/\bNC[_\-\s]/.test(f)) return { documentType: 'NOTA_CREDITO', confidence: 0.75, method: 'filename' };
    if (/\bND[_\-\s]/.test(f)) return { documentType: 'NOTA_DEBITO', confidence: 0.75, method: 'filename' };
    if (/\bDUA\b/.test(f)) return { documentType: 'DUA_IMPORTACAO', confidence: 0.90, method: 'filename' };
    if (/\bRECIBO\b/.test(f)) return { documentType: 'RECIBO_PAGAMENTO', confidence: 0.80, method: 'filename' };
    if (/\bGUIA[_\-\s]/.test(f)) return { documentType: 'GUIA_TRANSPORTE', confidence: 0.75, method: 'filename' };
    if (/\bEXTRATO\b/.test(f)) return { documentType: 'EXTRATO_BANCARIO', confidence: 0.85, method: 'filename' };
    if (/\bCONTRATO\b/.test(f)) return { documentType: 'CONTRATO', confidence: 0.85, method: 'filename' };
    if (/\bPROPOSTA\b/.test(f)) return { documentType: 'PROPOSTA', confidence: 0.80, method: 'filename' };
    if (/\bENCOMENDA\b/.test(f)) return { documentType: 'ENCOMENDA', confidence: 0.80, method: 'filename' };

    return null;
  }

  /** PASS 2: AT-QR code document type mapping */
  private classifyByAtQr(metadata?: Record<string, unknown>): ClassificationResult | null {
    const qr = metadata?.['atQr'] as Record<string, string> | undefined;
    if (!qr?.['D']) return null; // Field D = document type code

    const map: Record<string, DocumentType> = {
      FT: 'FATURA_RECEBIDA', FS: 'FATURA_SIMPLIFICADA',
      FR: 'FATURA_RECIBO', NC: 'NOTA_CREDITO',
      ND: 'NOTA_DEBITO', RC: 'RECIBO_PAGAMENTO',
    };

    const docType = map[qr['D'].toUpperCase()] || 'FATURA_RECEBIDA';
    return { documentType: docType, confidence: 0.95, method: 'at_qr' };
  }

  /** PASS 3: Keyword matching on OCR text */
  private classifyByKeywords(text: string): ClassificationResult {
    const t = text.toLowerCase();

    if (t.includes('fatura') || t.includes('factura') || t.includes('invoice')) {
      if (t.includes('recibo')) return { documentType: 'FATURA_RECIBO', confidence: 0.70, method: 'keyword' };
      if (t.includes('simplificada')) return { documentType: 'FATURA_SIMPLIFICADA', confidence: 0.75, method: 'keyword' };
      return { documentType: 'FATURA_RECEBIDA', confidence: 0.65, method: 'keyword' };
    }
    if (t.includes('recibo')) return { documentType: 'RECIBO_PAGAMENTO', confidence: 0.65, method: 'keyword' };
    if (t.includes('dua') || t.includes('alfândega') || t.includes('aduaneiro')) return { documentType: 'DUA_IMPORTACAO', confidence: 0.80, method: 'keyword' };
    if (t.includes('guia de transporte') || t.includes('guia de remessa')) return { documentType: 'GUIA_TRANSPORTE', confidence: 0.70, method: 'keyword' };
    if (t.includes('nota de crédito') || t.includes('nota de credito')) return { documentType: 'NOTA_CREDITO', confidence: 0.70, method: 'keyword' };
    if (t.includes('nota de débito') || t.includes('nota de debito')) return { documentType: 'NOTA_DEBITO', confidence: 0.70, method: 'keyword' };
    if (t.includes('extrato') || t.includes('bank statement')) return { documentType: 'EXTRATO_BANCARIO', confidence: 0.75, method: 'keyword' };
    if (t.includes('contrato') || t.includes('contract')) return { documentType: 'CONTRATO', confidence: 0.65, method: 'keyword' };
    if (t.includes('encomenda') || t.includes('purchase order')) return { documentType: 'ENCOMENDA', confidence: 0.65, method: 'keyword' };
    if (t.includes('vencimento') || t.includes('remunera')) return { documentType: 'RECIBO_VENCIMENTO', confidence: 0.70, method: 'keyword' };

    return { documentType: 'OUTRO', confidence: 0.30, method: 'keyword' };
  }
}
