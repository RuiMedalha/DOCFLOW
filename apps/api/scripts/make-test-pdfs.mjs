/**
 * Generates two small PDFs for testing loadDocumentText():
 *   - invoice-digital.pdf: real PDF with an embedded text layer (single
 *     page, Helvetica, realistic PT invoice). pdf-parse should return
 *     the same lines we wrote here.
 *   - invoice-imageonly.pdf: minimal PDF whose only page content is a
 *     single image XObject (/Subtype /Image). The page has NO Tj text —
 *     pdf-parse will return empty text and our service will mark the
 *     document as needing manual OCR.
 *
 * Run with: `node scripts/make-test-pdfs.mjs`
 * Output goes to `scripts/`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

/**
 * Build a minimal text-layer PDF. Each `obj` is a string ready to be
 * concatenated into the body. The header uses a binary marker so a
 * PDF reader knows where to find xref. Offsets are byte-exact.
 */
function buildDigitalPdf() {
  const textLines = [
    'Empresa XPTO, Lda',
    'Rua das Flores 123, 1000-001 Lisboa',
    'NIF: 500000000',
    '',
    'Fatura FT 2026/1',
    'Data: 15/03/2026',
    'Vencimento: 15/04/2026',
    '',
    'Total: 123,00 EUR',
    'IVA: 23,00 EUR',
    '',
    'IBAN: PT50 0002 0123 1234 5678 9015 4',
  ];

  // Single-line variant: the exact text from the acceptance test
  // (used for verifying IBAN regex + docNumber + classifier).
  const textLinesAcceptance = [
    'Fatura FT 2026/123',
    'NIF: 500697256',
    'Data: 2026-03-15',
    'Total: 123,00 EUR',
    'IVA: 23,00',
    'IBAN: PT50000201231234567890154',
  ];

  // Caller picks which fixture to build via CLI arg: `node make-test-pdfs.mjs [acceptance]`.
  // We support both an env var and a CLI arg so this works under Git-Bash
  // on Windows where inline `VAR=value` prefixes don't propagate to child
  // processes.
  const wantAcceptance =
    process.env.FIXTURE === "acceptance" ||
    process.argv.includes("acceptance");
  const lines = wantAcceptance ? textLinesAcceptance : textLines;

  // Build the BT...ET block. Lines positioned top-down (highest Y first).
  // The page is A4 (595×842pt). We start at y=780 (near top) and step
  // DOWN by 22pt per line — the Y values must be POSITIVE and inside
  // the MediaBox. (Earlier drafts used `780 - i*22` with a leading
  // negative sign which placed the text off-page and pdfjs-dist
  // returned an empty extraction as a result.)
  const tjLines = lines.map((s, i) => {
    const y = 780 - i * 22;
    const safe = s
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
    return `1 0 0 1 0 ${y} Tm (${safe}) Tj`;
  });
  const contentStream = `BT\n/F1 12 Tf\n${tjLines.join('\n')}\nET`;
  const streamBytes = Buffer.byteLength(contentStream, 'latin1');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamBytes} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (const o of objects) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += o;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/**
 * Build a minimal PDF whose only page content is an image XObject.
 * The image is a single-pixel placeholder — we don't need a real raster
 * because pdf-parse only cares about whether Tj/TJ operators exist on
 * the page (they don't here). What matters is that the page has zero
 * extractable text and one image — exactly the "scanned invoice"
 * shape we want to detect.
 */
function buildImageOnlyPdf() {
  // Content stream: just draws the image. NO Tj text operators.
  const contentStream = 'q\n100 0 0 100 50 50 cm\n/Im1 Do\nQ\n';
  const streamBytes = Buffer.byteLength(contentStream, 'latin1');

  // Minimal image XObject: 1x1 grayscale pixel, raw (no filter).
  // A real reader won't render it, but that's irrelevant — we just need
  // the object to exist so pdf-parse can confirm "page has an image, no text".
  const imageData = Buffer.from([0x40]); // single grayscale byte

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamBytes} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${imageData.length} >>\nstream\n`,
  ];
  // Object 5 needs to splice imageData after `stream\n`. We append raw.
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    offsets.push(Buffer.byteLength(body, 'latin1'));
    if (i === 4) {
      body += o; // header before stream
      body += imageData; // raw pixel byte
      body += '\nendstream\nendobj\n';
    } else {
      body += o;
    }
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// ============================================================================
// Write files
// ============================================================================
const digital = buildDigitalPdf();
writeFileSync(join(here, 'invoice-digital.pdf'), digital);
console.log(`Wrote invoice-digital.pdf (${digital.length} bytes)`);

const imageOnly = buildImageOnlyPdf();
writeFileSync(join(here, 'invoice-imageonly.pdf'), imageOnly);
console.log(`Wrote invoice-imageonly.pdf (${imageOnly.length} bytes)`);