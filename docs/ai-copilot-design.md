# DocFlow AI Copilot & Document Processing Design

> **Status:** Architecture & design v1.0 — 2026-08-30  
> **Scope:** Multimodal vision, semantic extraction, OCR, RAG chat, classification, duplicate & anomaly detection  
> **Sources audited:** deep-seek-documental, gemini-documental, grok-documental

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DOCFLOW AI PIPELINE                                 │
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐ │
│  │ INGEST   │──▶│ VISION   │──▶│ EXTRACT   │──▶│ EMBED    │──▶│ INDEX    │ │
│  │ (upload/ │   │ (Claude/ │   │ (structured│   │ (text-   │   │ (pgvector│ │
│  │  email/  │   │  Gemini) │   │  JSON)    │   │  embedding│   │  + hash) │ │
│  │  IMAP)   │   │          │   │           │   │  3-small)│   │          │ │
│  └──────────┘   └──────────┘   └───────────┘   └──────────┘   └──────────┘ │
│       │                                               │                    │
│       ▼                                               ▼                    │
│  ┌──────────┐                                   ┌──────────┐               │
│  │ OCR      │                                   │ VECTOR   │               │
│  │ FALLBACK │                                   │ STORE    │               │
│  │(Tesseract│                                   │ (pgvector│               │
│  │ .js)     │                                   │  0.8+)   │               │
│  └──────────┘                                   └────┬─────┘               │
│                                                      │                     │
│       ┌──────────────────────────────────────────────┘                     │
│       ▼                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌───────────┐                               │
│  │ RETRIEVE │──▶│ AUGMENT   │──▶│ GENERATE  │                               │
│  │ (top-k   │   │ (context  │   │ (LLM via  │                               │
│  │  hybrid) │   │  window)  │   │  provider)│                               │
│  └──────────┘   └───────────┘   └───────────┘                               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        CO-PILOT CHAT (WebSocket + REST)               │   │
│  │  "Qual o total de faturas da Interotel em 2025?"                     │   │
│  │  "Mostra-me a fatura FT 2025/847"                                    │   │
│  │  "Ha duplicados neste lote?"                                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Pipeline Stages

| Stage | Component | Input | Output | Technology |
|-------|-----------|-------|--------|------------|
| **Ingest** | `ingestion.service.ts` | PDF, PNG, JPG, TIFF, DOCX, EML | File buffer + metadata | Multer, IMAP listener, n8n webhook |
| **Vision** | `vision.service.ts` | Raw image/PDF pages | Structured JSON (supplier, NIF, totals, line items) | Claude 3.5 Sonnet / Gemini 2.0 Flash |
| **OCR Fallback** | `ocr.service.ts` | Image/PDF (vision skipped/unavailable) | Raw text string | Tesseract.js v5 (WASM) |
| **Extract** | `extraction.service.ts` | OCR text or vision JSON | Normalized `ExtractedDocument` | Regex + AT QR parser + AI structuring |
| **Embed** | `embedding.service.ts` | Chunked document text | `vector(1536)` | OpenAI `text-embedding-3-small` |
| **Index** | `vector-store.service.ts` | Embedding + metadata | pgvector index (IVFFlat / HNSW) | PostgreSQL + pgvector |
| **Retrieve** | `retrieval.service.ts` | User query embedding | Top-k document chunks | Cosine similarity + keyword BM25 hybrid |
| **Augment** | `rag.service.ts` | Query + retrieved chunks | Prompt with context | Template assembly |
| **Generate** | `copilot.service.ts` | Augmented prompt | Natural language answer | Claude / GPT-4o / Gemini (configurable) |
| **Classify** | `classification.service.ts` | Extracted fields + text | Document type + category + confidence | Rule-based + embedding similarity |
| **Duplicate** | `duplicate.service.ts` | File buffer + extracted fields | Duplicate match or `null` | SHA-256 hash + cosine(vector) > 0.98 |
| **Anomaly** | `anomaly.service.ts` | Extracted fields vs historical | Anomaly flags + severity | Statistical outlier + rule engine |

### 1.2 Module Dependency Graph

```
ai.module.ts
├── copilot.controller.ts      (REST + WebSocket gateway)
├── copilot.service.ts         (RAG orchestrator)
├── vision.service.ts          (Claude/Gemini multimodal)
├── extraction.service.ts      (Regex + AT-QR + AI structuring)
├── ocr.service.ts             (Tesseract.js fallback)
├── embedding.service.ts       (OpenAI text-embedding-3-small)
├── vector-store.service.ts    (pgvector CRUD)
├── retrieval.service.ts       (Hybrid search)
├── rag.service.ts             (Prompt assembly + context window)
├── classification.service.ts  (Taxonomy + confidence)
├── duplicate.service.ts       (Hash + vector dedup)
├── anomaly.service.ts         (Fraud signals)
└── dto/
    ├── copilot-query.dto.ts
    ├── document-analysis.dto.ts
    ├── extraction-result.dto.ts
    └── classification.dto.ts
```

---

## 2. Vision Model Selection

### 2.1 Comparison Matrix

| Criterion | Claude 3.5 Sonnet | Gemini 2.0 Flash | GPT-4o |
|-----------|-------------------|------------------|--------|
| **Multimodal (image+text)** | ✅ Native | ✅ Native | ✅ Native |
| **PDF page rendering** | ✅ (image pass) | ✅ (inline_data) | ✅ (image pass) |
| **Handwritten docs** | ⭐ Excellent | ⭐ Very Good | ⭐ Very Good |
| **Multi-language (PT/FR/ES/EN)** | ⭐ Excellent | ⭐ Very Good | ⭐ Excellent |
| **Structured JSON output** | ✅ (tool_use / prompt) | ✅ (response_mime_type) | ✅ (response_format) |
| **Cost per 1K images (approx)** | $3.00 | $0.04 | $3.75 |
| **Latency (typical)** | ~2-5s | ~1-3s | ~2-4s |
| **EU data residency** | ❌ (US) | ⚠️ (configurable) | ❌ (US) |
| **AT QR Code parsing** | ⚠️ (needs post-processing) | ⭐ (already proven in gemini-documental) | ⚠️ (needs post-processing) |
| **Receipt line-item extraction** | ⭐ Excellent | ⭐ Very Good | ⭐ Excellent |
| **DUA (customs docs)** | ⭐ Structured extraction | ⭐ Good | ⭐ Structured extraction |
| **Max context** | 200K tokens | 1M tokens | 128K tokens |

### 2.2 Recommended Strategy: **Primary Gemini, Fallback Claude**

```
IF document is AT-QR invoice (Portuguese)
  → Use AT-QR parser directly (no vision needed)

ELSE IF document is simple receipt / standard invoice
  → Gemini 2.0 Flash (cost-effective, fast)

ELSE IF document is complex / handwritten / DUA
  → Claude 3.5 Sonnet (higher accuracy)

IF vision API fails or times out
  → Fallback to Tesseract.js OCR + regex extraction

IF all fails
  → Flag document as "EM_REVISAO" for manual processing
```

**Rationale** (from gemini-documental proof): Gemini 2.0 Flash with `response_mime_type: 'application/json'` already extracts structured invoice data with high fidelity for standard documents. At `$0.04/1K` images vs Claude's `$3.00`, the cost differential is 75x. Gemini's 1M context window also handles multi-page PDFs natively. Claude is reserved for edge cases where Gemini confidence is < 0.7.

### 2.3 Vision Service Interface

```typescript
interface VisionAnalysisRequest {
  fileBase64: string;
  mimeType: string;
  documentContext?: string;       // "invoice", "receipt", "dua", "delivery_note"
  preferredProvider?: 'gemini' | 'claude' | 'auto';
}

interface VisionAnalysisResult {
  provider: string;
  model: string;
  confidence: number;
  extracted: ExtractedDocument;
  rawResponse: string;
  processingTimeMs: number;
  fallbackUsed: boolean;
}
```

---

## 3. OCR Strategy

### 3.1 Tesseract.js Fallback Pipeline

```
                     ┌──────────────────┐
                     │  Document Upload  │
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │ Searchable PDF?   │
                     └────┬─────────┬───┘
                          │YES      │NO
                     ┌────▼───┐ ┌──▼──────────┐
                     │ Extract │ │ Is image or  │
                     │ text    │ │ scanned PDF? │
                     │ via     │ └──┬───────┬───┘
                     │ pdf-    │    │IMG    │SCANNED
                     │ parse   │ ┌──▼──┐ ┌──▼──────────┐
                     └────┬───┘ │Tess.│ │pdf-to-image  │
                          │     │.js  │ │(pdf-poppler) │
                          │     │direct│ │→ Tesseract   │
                          │     └──┬──┘ └──┬───────────┘
                          │        │       │
                          └────────┼───────┘
                                   │
                          ┌────────▼─────────┐
                          │  Raw text output  │
                          │  → extraction    │
                          └──────────────────┘
```

### 3.2 Tesseract.js Configuration

```typescript
const TESSERACT_CONFIG = {
  lang: 'por+eng+fra+spa',
  oem: 3,                       // LSTM + Legacy
  psm: 3,                       // Auto page segmentation
  workerCount: 2,
  preprocessing: {
    denoise: true,
    contrast: 1.4,
    threshold: 'otsu',
    deskew: true,
    scale: 2.0,
  },
};
```

### 3.3 OCR Service Methods

| Method | Purpose |
|--------|---------|
| `extractFromImage(buffer, lang?)` | Direct Tesseract on image buffer |
| `extractFromPdf(filePath)` | pdf-parse for text PDFs, pdf-poppler → Tesseract for scanned |
| `enhanceForOcr(buffer): Buffer` | Sharp-based preprocessing pipeline |
| `detectLanguage(text): string` | franc-min language detection for multilingual OCR |

---

## 4. Classification Taxonomy

### 4.1 Document Type Hierarchy

```
Document
├── FISCAL
│   ├── INVOICE
│   │   ├── FATURA_RECEBIDA        (FT — received invoice)
│   │   ├── FATURA_EMITIDA         (issued invoice)
│   │   ├── FATURA_SIMPLIFICADA    (FS — simplified)
│   │   ├── FATURA_RECIBO          (FR — invoice-receipt)
│   │   └── NOTA_CREDITO           (NC — credit note)
│   ├── RECEIPT
│   │   ├── RECIBO_PAGAMENTO       (RP — payment receipt)
│   │   └── RECIBO_VERDE           (green receipt / eletronico)
│   ├── TRANSPORT
│   │   ├── GUIA_TRANSPORTE        (delivery note)
│   │   └── GUIA_REMESSA           (consignment note)
│   └── CORRECTIVE
│       ├── NOTA_DEBITO            (ND — debit note)
│       └── NOTA_CREDITO           (NC)
├── CUSTOMS
│   ├── DUA_IMPORTACAO
│   ├── DUA_EXPORTACAO
│   └── DOC_ADUANEIRO_UE
├── BANKING
│   ├── EXTRATO_BANCARIO
│   ├── COMPROVATIVO_TRANSFERENCIA
│   └── COMPROVATIVO_PAGAMENTO
├── HR
│   ├── RECIBO_VENCIMENTO          (payslip)
│   ├── DECLARACAO_REMUNERACOES
│   └── SEGURANCA_SOCIAL
├── CONTRACTUAL
│   ├── CONTRATO
│   ├── PROPOSTA
│   └── ENCOMENDA
└── OTHER
    ├── CORRESPONDENCIA
    └── NAO_IDENTIFICADO
```

### 4.2 Classification Strategy (Multi-Pass)

```
PASS 1: FILENAME HEURISTICS — regex patterns on filename
PASS 2: AT-QR CODE — Fields D+E → exact AT type mapping (confidence 0.95)
PASS 3: VISION AI — Gemini/Claude structured classification prompt
PASS 4: KEYWORD MATCHING — OCR text keyword rules
PASS 5: EMBEDDING SIMILARITY — cosine to type cluster centroids
```

### 4.3 Document Lifecycle States

```
NOVO → EM_PROCESSAMENTO → PROCESSADO → EM_REVISAO → CONFIRMADO
  │            │               │             │            │
  │            │               │             │            └──→ ARQUIVADO
  │            │               │             └──→ REJEITADO
  │            │               └──→ ERRO_PROCESSAMENTO (retry)
  │            └──→ ERRO_OCR / ERRO_VISION (retry with fallback)
  └──→ DUPLICADO (blocked)
```

---

## 5. Extraction Schema

### 5.1 `ExtractedDocument` Interface

```typescript
interface ExtractedDocument {
  // ENTITY IDENTIFICATION
  supplier?: {
    name: string;
    nif?: string;               // PT: 9 digits; FR: FRxx...; ES: ESx...
    country?: string;           // ISO 3166-1 alpha-2
    address?: string;
    iban?: string;
    email?: string;
  };
  customer?: {
    name: string;
    nif?: string;
    country?: string;
  };

  // DOCUMENT IDENTIFICATION
  documentType: DocumentType;
  documentNumber: string;
  atcud?: string;
  documentDate: string;         // ISO YYYY-MM-DD
  dueDate?: string;
  currency: string;

  // AMOUNTS
  netAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  withholdingTax?: number;
  stampDuty?: number;
  cashDiscount?: number;
  cashDiscountRate?: number;

  // TAX BREAKDOWN (AT QR spec)
  taxBreakdown?: TaxBreakdown[];

  // LINE ITEMS
  items?: InvoiceItem[];

  // CLASSIFICATION
  category?: string;
  sncCode?: string;
  ivaDeductible?: boolean;
  ivaDeductionRate?: number;

  // METADATA
  confidence: number;
  extractionMethod: 'vision' | 'at_qr' | 'ocr_regex' | 'manual';
  processingTimeMs: number;
  source: string;
  hints: string[];
  originalText?: string;
}

interface TaxBreakdown {
  region?: 'PT' | 'PT_MA' | 'PT_AZ' | 'UE' | 'EXTRA';
  taxRate: number;
  baseAmount: number;
  taxAmount: number;
}

interface InvoiceItem {
  sku?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  taxRate?: number;
}
```

### 5.2 Country-Specific Extraction Rules

| Country | NIF Pattern | Currency | Special Fields |
|---------|------------|----------|----------------|
| **PT** | `\d{9}` | EUR | ATCUD, AT-QR hash, IVA breakdown by region |
| **ES** | `ES[a-zA-Z]\d{7}[a-zA-Z]?` | EUR | NIF-IVA, IRPF retencion |
| **FR** | `FR[a-zA-Z0-9]{2}\d{9}` | EUR | TVA intracom, SIREN/SIRET |
| **DE** | `DE\d{9}` | EUR | USt-IdNr, Steuernummer |
| **UK** | `GB\d{9}(\d{3})?` | GBP | VAT number |
| **INT** | varies | varies | Detect via `franc` + regex country hints |

### 5.3 Extraction Confidence Scoring

```typescript
function computeConfidence(extracted: Partial<ExtractedDocument>): number {
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
```

---

## 6. Duplicate Detection Algorithm

### 6.1 Three-Tier Strategy

```
LAYER 1: EXACT HASH (SHA-256)
  fileHash matches existing → BLOCK (exact duplicate). O(1) indexed lookup. 0% FPR.

LAYER 2: PERCEPTUAL HASH (dHash)
  Compute 9x8 grayscale dHash per image page.
  Hamming distance < 5 → FLAG as potential duplicate (same doc, different scan).
  Cost: O(n) per tenant.

LAYER 3: SEMANTIC VECTOR SIMILARITY
  Embed extracted fields (supplier + total + date).
  Cosine similarity > 0.98 → FLAG as potential duplicate.
  Cost: O(log n) with IVFFlat/HNSW index.

DUPLICATE RESOLUTION:
  LAYER 1 → Auto-reject with message
  LAYER 2 → Flag EM_REVISAO, show side-by-side comparison
  LAYER 3 → Flag EM_REVISAO, show field diff
```

### 6.2 Duplicate Service Interface

```typescript
interface DuplicateCheckResult {
  isDuplicate: boolean;
  tier: 'exact_hash' | 'perceptual' | 'semantic' | 'none';
  confidence: number;
  matchedDocumentId?: string;
  matchedFileName?: string;
  similarity?: number;
  reason?: string;
}

interface BatchDuplicateReport {
  totalDocuments: number;
  duplicatesFound: number;
  uniqueDocuments: number;
  groups: DuplicateGroup[];
}

interface DuplicateGroup {
  documents: { id: string; fileName: string; uploadDate: string }[];
  detectionTier: string;
  recommendedAction: 'keep_first' | 'keep_latest' | 'manual_review';
}
```

### 6.3 Perceptual Hash Implementation Notes

```typescript
// Use sharp to resize 9x8 grayscale, compute dHash
async function computeDHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = y * 9 + x;
      hash += data[idx] < data[idx + 1] ? '1' : '0';
    }
  }
  return hash; // 64-bit
}

function hammingDistance(h1: string, h2: string): number {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) dist++;
  return dist;
}
```

---

## 7. Anomaly Detection (Fraud Signals)

### 7.1 Anomaly Signal Types

| Signal | Description | Severity | Detection Method |
|--------|-------------|----------|------------------|
| **DUPLICATE_AMOUNT** | Same total + supplier within 24h | HIGH | Rule: total + supplier + date window |
| **SUSPICIOUS_TOTAL** | Total > 3σ vs supplier historical avg | MEDIUM | Z-score outlier on supplier totals |
| **MISSING_NIF** | No valid NIF on fiscal document | MEDIUM | Regex: no 9-digit or EU VAT pattern |
| **ROUND_AMOUNTS** | Multiple round amounts (fraud indicator) | LOW | Count of `.00` totals in batch |
| **DATE_ANOMALY** | Document date > 30 days in future or > 2 years past | LOW | Date validation |
| **INCONSISTENT_TAX** | Tax amount doesn't match rate × base | HIGH | Arithmetic: `abs(tax - base * rate) > 0.05` |
| **IBAN_MISMATCH** | IBAN doesn't match known supplier IBAN | HIGH | Lookup supplier→IBAN vs extracted |
| **DUPLICATE_NUMBER** | Same document number, different hashes | CRITICAL | Query by documentNumber within tenant |
| **BURST_UPLOAD** | >20 documents from same IP in 60s | MEDIUM | Rate-limit counter |
| **STRUCTURE_DRIFT** | Document structure differs from supplier norm | LOW | Embedding similarity to supplier centroid < 0.7 |

### 7.2 Anomaly Scoring

```typescript
interface AnomalyReport {
  documentId: string;
  signals: AnomalySignal[];
  totalScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedAction: 'review' | 'block' | 'flag' | 'ignore';
}

interface AnomalySignal {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  weight: number;
  description: string;
  evidence: string;   // e.g. "Expected IVA 23.00, got 17.50"
}
```

---

## 8. RAG Architecture for Treasury Co-Pilot

### 8.1 Embedding & Vector Store

```typescript
// embedding.service.ts
class EmbeddingService {
  private model = 'text-embedding-3-small';  // 1536 dims
  private chunkSize = 512;
  private chunkOverlap = 64;

  async embedDocument(documentId: string): Promise<void>;
  async embedQuery(query: string): Promise<number[]>;
  async chunkText(text: string): Promise<TextChunk[]>;
}

// vector-store.service.ts (PostgreSQL + pgvector)
class VectorStoreService {
  async insert(documentId: string, chunks: TextChunk[]): Promise<void>;
  async search(vector: number[], topK: number, filters?: VectorFilter): Promise<VectorHit[]>;
  async delete(documentId: string): Promise<void>;
}

interface TextChunk {
  index: number;
  content: string;
  metadata: {
    documentId: string;
    field: string;              // 'supplier', 'items', 'total', 'full_text'
    page?: number;
  };
}

interface VectorFilter {
  tenantId: string;
  documentTypes?: string[];
  dateRange?: { start: string; end: string };
  supplierNif?: string;
}
```

### 8.2 Hybrid Retrieval (Vector + Keyword)

```typescript
class RetrievalService {
  /** Hybrid search: 70% vector + 30% BM25 keyword, RRF fusion */
  async hybridSearch(query: string, tenantId: string, topK = 8): Promise<RetrievalResult[]> {
    const queryEmbedding = await this.embedding.embedQuery(query);
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorStore.search(queryEmbedding, topK * 2, { tenantId }),
      this.fullTextSearch(query, tenantId, topK * 2),
    ]);
    return this.reciprocalRankFusion(vectorResults, keywordResults, topK);
  }
}

interface RetrievalResult {
  content: string;
  metadata: TextChunk['metadata'];
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}
```

### 8.3 RAG Prompt Assembly

```typescript
class RagService {
  async buildContext(query: string, tenantId: string, options?: {
    maxChunks?: number; maxTokens?: number;
  }): Promise<CopilotContext>;

  private assembleContextWindow(results: RetrievalResult[], maxTokens: number): string;
}

interface CopilotContext {
  query: string;
  context: string;
  sources: { documentId: string; field: string; snippet: string }[];
}
```

### 8.4 Co-Pilot Service (LLM Generation)

```typescript
class CopilotService {
  async chat(query: string, tenantId: string,
    conversationHistory?: Message[]): Promise<CopilotResponse> {
    // 1. Build RAG context
    const { context, sources } = await this.rag.buildContext(query, tenantId);
    // 2. Select prompt template based on query intent
    const template = this.selectTemplate(query);
    // 3. Assemble final prompt
    const systemPrompt = template.system(context);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversationHistory || []),
      { role: 'user', content: query },
    ];
    // 4. Route to LLM provider
    const llmResponse = await this.llmProvider.chat(messages, {
      model: 'claude-3.5-sonnet', temperature: 0.2, maxTokens: 2000,
    });
    return {
      answer: llmResponse.content,
      sources,
      confidence: llmResponse.confidence,
      suggestedFollowUps: this.generateFollowUps(query, llmResponse),
    };
  }
}

interface CopilotResponse {
  answer: string;
  sources: { documentId: string; field: string; snippet: string }[];
  confidence: number;
  suggestedFollowUps: string[];
}
```

---

## 9. Treasury Q&A Prompt Patterns

### 9.1 System Prompt Template (RAG-augmented)

```
Es o Copiloto de Tesouraria da DocFlow, um assistente financeiro especializado em
analise documental fiscal portuguesa e europeia. Trabalhas para uma empresa
portuguesa (multi-tenant). Tens acesso a base documental digitalizada.

DIRETRIZES:
1. Responde SEMPRE em Portugues de Portugal, com tom profissional mas acessivel.
2. Baseia as respostas APENAS nos documentos fornecidos no CONTEXTO abaixo.
3. Se a informacao nao estiver no contexto, diz "Nao encontrei essa informacao
   nos documentos disponiveis." — nunca inventes.
4. Para valores monetarios, formata sempre com EUR e 2 casas decimais (ex: 1.250,50 EUR).
5. Para datas, usa formato DD/MM/AAAA.
6. Cita a fonte: indica o numero do documento ou nome do ficheiro quando possivel.
7. Se houver informacao contraditoria entre documentos, alerta o utilizador.
8. Para perguntas de agregacao (totais, medias, rankings), calcula com precisao.
9. Se detectares uma possivel anomalia (valores atipicos, duplicados, inconsistencias
   fiscais), menciona como alerta.
10. Mantem confidencialidade absoluta — os dados sao do tenant atual.

CONTEXTO DOCUMENTAL:
{context}

PERGUNTA DO UTILIZADOR:
{query}
```

### 9.2 Intent Classification & Prompt Routing

```typescript
type CopilotIntent =
  | 'AGGREGATION'      // "Qual o total de faturas do fornecedor X em 2025?"
  | 'LOOKUP'           // "Mostra-me a fatura FT 2025/847"
  | 'COMPARISON'       // "Compara os totais de 2024 vs 2025"
  | 'ANOMALY'          // "Ha alguma fatura suspeita este mes?"
  | 'EXPLANATION'      // "Explica-me o IVA desta fatura francesa"
  | 'PREDICTION'       // "Quanto vou pagar de IVA no proximo trimestre?"
  | 'DUPLICATE_CHECK'  // "Este documento e duplicado?"
  | 'STATUS'           // "Qual o estado das faturas pendentes?"
  | 'CLASSIFY'         // "Que tipo de documento e este?"
  | 'EXPORT'           // "Exporta todas as faturas do fornecedor X"
  | 'GENERAL';

function classifyIntent(query: string): CopilotIntent {
  // Keywords: "total"/"soma" → AGGREGATION, "mostra"/"detalhes" → LOOKUP,
  // "vs"/"comparar" → COMPARISON, "suspeito"/"anonmalo" → ANOMALY, etc.
}
```

### 9.3 Aggregation Prompt Template

```
Com base nos documentos abaixo, responde a pergunta de agregacao.

CONTEXTO (documentos filtrados por tenant, periodo e fornecedor):
{context}

TAREFA: Calcula com precisao: {query}

FORMATO DE RESPOSTA:
- Total: X.XXX,XX EUR
- Numero de documentos: N
- Periodo: DD/MM/AAAA a DD/MM/AAAA
- Detalhe por fornecedor (se aplicavel)
- Detalhe por mes (se pedido)
```

### 9.4 Anomaly Detection Prompt Template

```
Analisa os seguintes documentos em busca de anomalias e sinais de fraude.

CONTEXTO: {context}

VERIFICA:
1. Valores totais atipicos vs historico do fornecedor (z-score > 3)
2. Documentos com mesmo numero mas hash diferente (possivel falsificacao)
3. IVA calculado incorretamente (taxAmount != totalAmount * taxa)
4. IBAN diferente do habitual para este fornecedor
5. Documentos com data futura ou muito antiga (>2 anos)
6. Multiplos documentos com valores redondos suspeitos

Responde em Portugues, com formato:
- OK N documentos sem anomalias
- AVISO N alertas encontrados:
  1. [Tipo de anomalia] — [Documento] — [Evidencia] — [Severidade: ALTA/MEDIA/BAIXA]
```

---

## 10. Multi-Provider LLM Configuration

### 10.1 Provider Registry (ported from deep-seek-documental `ai.service.ts`)

```typescript
interface AiProviderConfig {
  name: string;
  type: 'api_key' | 'url' | 'local';
  url: string;
  model: string;
  headers: Record<string, string>;
  capabilities: ('chat' | 'vision' | 'embedding')[];
  visionModel?: string;
}

function getAiProviders(): AiProviderConfig[] {
  const providers: AiProviderConfig[] = [];
  if (process.env.OPENAI_API_KEY) providers.push({
    name: 'openai', type: 'api_key',
    url: process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    capabilities: ['chat', 'vision', 'embedding'],
  });
  if (process.env.ANTHROPIC_API_KEY) providers.push({
    name: 'anthropic', type: 'api_key',
    url: process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1',
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    capabilities: ['chat', 'vision'],
  });
  if (process.env.GEMINI_API_KEY) providers.push({
    name: 'gemini', type: 'api_key',
    url: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    capabilities: ['chat', 'vision'],
    visionModel: 'gemini-2.0-flash',
  });
  if (process.env.OLLAMA_URL) providers.push({
    name: 'ollama', type: 'local',
    url: process.env.OLLAMA_URL,
    model: process.env.OLLAMA_MODEL || 'llama3.1',
    headers: {},
    capabilities: ['chat'],
  });
  return providers;
}
```

### 10.2 LLM Routing Strategy

```typescript
function routeLlmCall(intent: CopilotIntent, task: string): AiProviderConfig {
  if (task === 'embedding')     return getProvider('openai');
  if (task === 'vision')        return getProvider('gemini') || getProvider('anthropic');
  if (['ANOMALY','COMPARISON','PREDICTION'].includes(intent))
    return getProvider('anthropic') || getProvider('openai');
  return getProvider('gemini') || getProvider('openai') || getProvider('ollama');
}
```

---

## 11. Performance & Scalability

### 11.1 Processing Queue (BullMQ)

```
Document Upload → BullMQ Queue "document-processing"
  ├── Job: compute-hash       (priority: high)
  ├── Job: extract-at-qr      (priority: high, skip if no QR)
  ├── Job: vision-analyze     (priority: normal, concurrency: 3)
  ├── Job: ocr-fallback       (priority: low, only if vision fails)
  ├── Job: classify           (priority: normal)
  ├── Job: compute-embedding  (priority: normal)
  ├── Job: duplicate-check    (priority: high)
  └── Job: anomaly-scan       (priority: low, batched)
```

### 11.2 Caching Strategy

| What | How | TTL |
|------|-----|-----|
| Embedding vectors | PostgreSQL pgvector index | Permanent |
| Copilot responses | Redis (keyed by query hash + tenant) | 1 hour |
| Vision analysis | PostgreSQL document metadata | Permanent |
| Supplier centroids | Recalculated nightly | — |
| Provider rate-limit state | Redis | Per-minute window |

### 11.3 Index Configuration

```sql
-- pgvector index for document embeddings (cosine similarity)
CREATE INDEX ON document_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search index
CREATE INDEX ON documents
  USING gin (to_tsvector('portuguese',
    coalesce(ocr_text,'') || ' ' || coalesce(supplier,'') || ' ' || coalesce(doc_number,'')));
```

---

## 12. Source Repo Lineage

| Feature | Primary Source | Key Files Audited |
|---------|---------------|-------------------|
| Multi-provider AI routing | deep-seek-documental | `ai/ai.service.ts` (providers, callAiProvider, parseAiResponse) |
| Vision document analysis | gemini-documental | `app.service.ts` (analyzeWithGemini, structured JSON prompt, base64 inline) |
| AT-QR Code parsing | grok-documental | `extraction/at-qr.parser.ts` (full AT spec A-R, DOC_TYPE_MAP, ivaBreakdown) |
| Regex extraction | deep-seek-documental | `ocr/ocr.service.ts` (parseInvoiceData: NIF, dates, totals, IVA, IBAN) |
| Document upload + hash dedup | grok-documental | `documents/documents.service.ts` (upload, computeHash, conflict detection) |
| Full-text search | grok-documental | `search/search.service.ts` (multi-entity Prisma search) |
| OCR + QR pipeline | deep-seek-documental | `ocr/` (ocr.service, qrcode-at.service, scanner.service) |
| Classification rules | deep-seek-documental | `ai/ai.service.ts` (classifyDocumentWithAi, suggestFiscalCategory) |
| Extraction service | grok-documental | `extraction/extraction.service.ts` (extractFromText, processDocument) |

---

## 13. Environment Variables

```bash
# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# OCR
TESSERACT_WORKER_COUNT=2
TESSERACT_LANGS=por+eng+fra+spa

# RAG
VECTOR_STORE_MAX_CHUNKS=10
RAG_CONTEXT_MAX_TOKENS=4000
RAG_CHUNK_SIZE=512
RAG_CHUNK_OVERLAP=64

# Vision
VISION_DEFAULT_PROVIDER=gemini
VISION_FALLBACK_PROVIDER=anthropic
VISION_TIMEOUT_MS=30000

# Queue
BULL_REDIS_URL=redis://localhost:6379
AI_JOB_CONCURRENCY=3
```
