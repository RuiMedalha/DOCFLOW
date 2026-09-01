#!/usr/bin/env node
/**
 * Generates a minimal digital PDF whose text layer contains BOTH a valid
 * AT-QR string AND extra lines the QR does NOT carry: IBAN, line items,
 * full supplier name, suggested category. The test for the QR+AI merge
 * reads this PDF via the extraction pipeline.
 */
import { writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const QR_AT =
  "A:500697256*B:500000000*C:PT*D:FT*E:N*F:20260315*G:FT2026/1*H:J66S9FDD-1*" +
  "I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:0.00*R:1234";

// Lines we want the text extractor to pick up. Keep them ASCII-safe for
// pdf-parse's Helvetica encoding.
const lines = [
  "Empresa XPTO Consultores, Lda",
  "Rua das Flores 123, 1000-001 Lisboa",
  "NIF: 500697256",
  "Fatura FT 2026/1",
  "Data: 2026-03-15",
  "Vencimento: 2026-04-15",
  "Total: 123,00 EUR",
  "IVA: 23,00 EUR",
  "IBAN: PT50 0002 0123 1234 5678 9015 4",
  "Linha 1: Consultoria tecnica, 10 x 50,00 = 500,00",
  "Linha 2: Deslocacoes, 1 x 100,00 = 100,00",
  "Categoria SNC: 62.2.4 Honorarios",
  QR_AT,
];

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const textLines = lines.map((l) => `(${escape(l)}) Tj`).join("\n");

// Minimal 1-page PDF with a single Helvetica BT..ET block emitting the
// invoice text and the QR string as one continuous stream.
const stream = `BT
/F1 10 Tf
50 750 Td
${lines
  .map((l, i) => (i === 0 ? "" : "0 -14 Td") + `(${escape(l)}) Tj`)
  .join("\n")}
ET`;

const objs = [
  `<< /Type /Catalog /Pages 2 0 R >>`,
  `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
];

let pdf = "%PDF-1.4\n";
const offsets = [];
for (let i = 0; i < objs.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
}
const xrefOffset = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) {
  pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

const out = process.argv[2] || "scripts/invoice-qr-ai.pdf";
writeFileSync(out, pdf, "latin1");
console.log(`Wrote ${out} (${pdf.length} bytes)`);
