// make-fixtures.mjs — generate the three test fixtures used by the
// live extraction verification:
//
//   (a) digital-text-invoice.pdf
//         A PDF whose content stream contains an `BT...ET` block with
//         plain-text drawing operators. pdf-parse's text-layer parser
//         will pick these up (loaded.source === 'pdf-text').
//
//   (b) photo-invoice.png
//         A 1024×640 grayscale-ish PNG that "looks like" an invoice:
//         a few horizontal bars + dark text rendered into the pixel
//         buffer via the 1-bit font. We render text by drawing
//         individual pixel patterns for each character — slow but
//         dependency-free. Gemini vision reads PNG natively so it
//         should OCR this just fine.
//
//   (c) scanned-invoice.pdf
//         An image-only PDF: the page content stream is just an XObject
//         reference to a JPEG-like stream (we use a tiny embedded raw
//         bitmap wrapped in /FlateDecode). pdf-parse will see no text
//         layer and we'll route it through the new rasterisation path.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const INVOICE_TEXT_LINES_TEMPLATE = [
  'Empresa XPTO, Lda.',
  'NIF: 500000000',
  'IBAN: PT50 0002 0123 1234 5678 9015 4',
  'Fatura FT 2026/123',
  'ATCUD: ABC123456789',
  '2026-01-15',
  'Total a pagar: 1234.56 EUR',
  'IVA 23%: 230.85 EUR',
];

// ---------------------------------------------------------------------------
// (a) Digital PDF — embeds the invoice as a literal text stream.
// ---------------------------------------------------------------------------
function buildDigitalPdf() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const INVOICE_TEXT_LINES = [...INVOICE_TEXT_LINES_TEMPLATE, `Ref: ${stamp}`];
  // Build the page content stream — for each text line we emit `Tj`
  // with the literal between parentheses. pdfjs splits lines on Tj.
  const contentLines = INVOICE_TEXT_LINES.map((line) =>
    `(${line.replace(/[()\\]/g, (c) => '\\' + c)}) Tj 0 -18 Td`
  ).join('\n');
  const contentStream = `BT\n/F1 12 Tf\n50 750 Td\n${contentLines}\nET\n`;

  const objects = [];
  function add(body) {
    const id = objects.length + 1;
    objects.push({ id, body });
    return id;
  }

  // Reserve IDs we need to reference up-front.
  const catalogId = add('');
  const pagesId = add('');
  const pageId = add('');
  const fontId = add('');
  const contentId = add(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`);

  objects[0].body = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1].body = `<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`;
  objects[2].body = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[3].body = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  // Assemble xref table.
  let pdf = '%PDF-1.4\n%\xff\xff\xff\xff\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

// ---------------------------------------------------------------------------
// (b) PNG — render the invoice text into a 1024×640 RGB pixel buffer
// using a hand-drawn 5×7 bitmap font, then encode it as a PNG (filter 0,
// no compression — zlib stored blocks). The point is to give Gemini a
// real rasterised image that looks like a scanned phone photo.
// ---------------------------------------------------------------------------
const FONT = {
  // 5 wide × 7 tall, row-major, top-to-bottom.
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '€': ['01000', '11111', '01000', '01000', '01000', '11111', '01000'],
};

function drawText(pixels, width, x, y, text, scale = 4) {
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = x + c * scale + dx;
              const py = y + r * scale + dy;
              if (px < width && py < pixels.length / width) {
                pixels[py * width + px] = 0; // black
              }
            }
          }
        }
      }
    }
    x += 6 * scale; // 5 + 1 spacing
  }
}

function buildPng() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const INVOICE_TEXT_LINES = [...INVOICE_TEXT_LINES_TEMPLATE, `Ref: ${stamp}`];
  const width = 1024;
  const height = 640;
  // Off-white "paper" background, dark text — what a real invoice looks like.
  const pixels = new Uint8Array(width * height);
  pixels.fill(245);

  let y = 40;
  const scale = 6;
  for (const line of INVOICE_TEXT_LINES) {
    drawText(pixels, width, 40, y, line, scale);
    y += 9 * scale + 8;
  }

  // PNG encoding: filter 0 (none), 1 byte per pixel (grayscale, colorType=0).
  // The "stride" must include exactly 1 filter byte + width data bytes.
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    raw[row * stride] = 0; // filter type 0 (None)
    for (let col = 0; col < width; col++) {
      raw[row * stride + 1 + col] = pixels[row * width + col];
    }
  }
  const compressed = deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    const crc = crc32(crcBuf);
    const crcBytes = Buffer.alloc(4);
    crcBytes.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, t, data, crcBytes]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type 0 = grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// (c) Image-only / scanned-style PDF — embed a small bitmap (the same
// text rendered into pixels, re-encoded as a PDF Image XObject) and
// reference it from a page with NO text stream. pdf-parse will see zero
// text, so the new rasterisation path kicks in.
// ---------------------------------------------------------------------------
function buildScannedPdf() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const INVOICE_TEXT_LINES = [...INVOICE_TEXT_LINES_TEMPLATE, `Ref: ${stamp}`];
  // Build a tiny monochrome "scanned page" — 600×400 px, white with
  // black text. We embed it as a /FlateDecode bitmap XObject (PDF's
  // inline-image equivalent).
  const width = 600;
  const height = 400;
  const pixels = new Uint8Array(((width + 7) >> 3) * height); // 1 bit/px, row-padded to byte
  pixels.fill(0xff);

  function drawTextPng(x, y, text) {
    for (const ch of text.toUpperCase()) {
      const glyph = FONT[ch] || FONT[' '];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (glyph[r][c] === '1') {
            const px = x + c * 4;
            const py = y + r * 4;
            for (let dy = 0; dy < 3; dy++) {
              for (let dx = 0; dx < 3; dx++) {
                const xx = px + dx;
                const yy = py + dy;
                if (xx >= width || yy >= height) continue;
                const byteIndex = yy * ((width + 7) >> 3) + (xx >> 3);
                const bitIndex = 7 - (xx & 7);
                pixels[byteIndex] &= ~(1 << bitIndex);
              }
            }
          }
        }
      }
      x += 6 * 4;
    }
  }

  let yy = 30;
  for (const line of INVOICE_TEXT_LINES) {
    drawTextPng(40, yy, line);
    yy += 9 * 4 + 6;
  }

  // Invert bits: PDF image XObject treats 0=white, 1=black (RGB default).
  for (let i = 0; i < pixels.length; i++) pixels[i] = pixels[i] ^ 0xff;
  const compressedImage = deflateSync(Buffer.from(pixels));

  const objects = [];
  function add(body) {
    const id = objects.length + 1;
    objects.push({ id, body });
    return id;
  }
  const catalogId = add('');
  const pagesId = add('');
  const pageId = add('');
  const imageId = add('');

  // Content stream: scale image to fill a 612×792 page and draw it.
  const drawImageStream =
    `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;

  const contentId = add(
    `<< /Length ${drawImageStream.length} >>\nstream\n${drawImageStream}endstream`,
  );

  objects[0].body = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1].body = `<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`;
  objects[2].body = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[3].body =
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceGray /BitsPerComponent 1 ` +
    `/Filter /FlateDecode /Length ${compressedImage.length} >>\n` +
    `stream\n${compressedImage.toString('binary')}endstream`;

  let pdf = '%PDF-1.4\n%\xff\xff\xff\xff\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

// ---------------------------------------------------------------------------
// Main — write the three fixtures.
// ---------------------------------------------------------------------------
const UNIQUE = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
writeFileSync(new URL('./digital-invoice.pdf', import.meta.url), buildDigitalPdf());
writeFileSync(new URL('./photo-invoice.png', import.meta.url), buildPng());
writeFileSync(new URL('./scanned-invoice.pdf', import.meta.url), buildScannedPdf());

console.log('Wrote fixtures (UNIQUE:', UNIQUE, '):');
console.log('  digital-invoice.pdf   ', buildDigitalPdf().length, 'bytes');
console.log('  photo-invoice.png     ', buildPng().length, 'bytes');
console.log('  scanned-invoice.pdf   ', buildScannedPdf().length, 'bytes');
