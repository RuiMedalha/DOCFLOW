import { PDFParse } from 'pdf-parse';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

async function probe(file) {
  const buf = readFileSync(join(here, file));
  const parser = new PDFParse({ data: buf });
  try {
    const info = await parser.getInfo();
    const text = await parser.getText();
    return {
      file,
      ok: true,
      meta: info.info,
      textLen: text.text.length,
      firstChars: text.text.slice(0, 200),
      pages: text.pages?.length,
    };
  } catch (err) {
    return { file, ok: false, error: err.message };
  }
}

const a = await probe('invoice-digital.pdf');
console.log('DIGITAL:', JSON.stringify(a, null, 2));
const b = await probe('invoice-imageonly.pdf');
console.log('IMAGEONLY:', JSON.stringify(b, null, 2));

process.exit(0);