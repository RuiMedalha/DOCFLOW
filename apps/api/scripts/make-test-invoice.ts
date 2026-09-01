// scripts/make-test-invoice.ts — synthesise a Portuguese-style invoice PDF
// for the 2026-09-01 "missing-fields" extraction test. Two VAT rates (23 %
// + 13 %), a line discount, a global discount, a due date, and supplier +
// NIF + IBAN so the vision path has anchor fields too.
//
// Output: /tmp/test-invoice-discount-vat.pdf
// Run:    node --experimental-strip-types scripts/make-test-invoice.ts
//   or   npx tsx scripts/make-test-invoice.ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

async function main() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const grey = rgb(0.4, 0.4, 0.4);
  let y = 800;
  const left = 50;
  const lineH = 14;

  function write(text: string, opts: { bold?: boolean; size?: number; color?: any; x?: number } = {}) {
    page.drawText(text, {
      x: opts.x ?? left,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? bold : font,
      color: opts.color ?? black,
    });
  }

  function newline() { y -= lineH; }

  // Header
  write("Empresa Teste, Lda", { bold: true, size: 16 });
  newline();
  write("Rua das Flores 123, 1000-001 Lisboa", { color: grey });
  newline();
  write("NIF: 500000000  IBAN: PT50 0002 0123 1234 5678 9015 4", { color: grey });
  newline();
  y -= 8;
  write("Fatura FT 2026/99", { bold: true, size: 13 });
  newline();
  write("Data: 2026-08-31");
  newline();
  write("Vencimento: 2026-10-15");
  newline();
  write("Cliente: Cliente Demo, Lda  —  NIF: 509999999");
  newline();
  y -= 10;

  // Line items table
  write("Descrição", { bold: true });
  write("Qtd", { bold: true, x: 280 });
  write("Preço unit.", { bold: true, x: 310 });
  write("Desc.", { bold: true, x: 370 });
  write("IVA", { bold: true, x: 420 });
  write("Total", { bold: true, x: 470 });
  newline();
  page.drawLine({
    start: { x: left, y: y + 4 },
    end: { x: 545, y: y + 4 },
    thickness: 0.5,
    color: grey,
  });

  // Line 1 — Consultoria — 10 h * 100 EUR — IVA 23 % — discount 50
  write("Consultoria técnica (10h)");
  write("10", { x: 280 });
  write("100,00", { x: 310 });
  write("50,00", { x: 370 });
  write("23%", { x: 420 });
  write("1.150,00", { x: 470 });
  newline();
  // Line 2 — Manual técnico — 1 * 200 EUR — IVA 13 % — discount 0
  write("Manual técnico");
  write("1", { x: 280 });
  write("200,00", { x: 310 });
  write("0,00", { x: 370 });
  write("13%", { x: 420 });
  write("226,00", { x: 470 });
  newline();

  y -= 4;
  page.drawLine({
    start: { x: left, y: y + 4 },
    end: { x: 545, y: y + 4 },
    thickness: 0.5,
    color: grey,
  });
  y -= 4;

  // Totals
  write("Subtotal:", { x: 380 });
  write("1.250,00", { x: 470 });
  newline();
  write("Desconto global:", { x: 380 });
  write("-50,00", { x: 470 });
  newline();
  write("Base:", { x: 380 });
  write("1.200,00", { x: 470 });
  newline();
  write("IVA 23% (1.000,00):", { x: 380 });
  write("230,00", { x: 470 });
  newline();
  write("IVA 13% (200,00):", { x: 380 });
  write("26,00", { x: 470 });
  newline();
  write("Total:", { bold: true, x: 380 });
  write("1.456,00", { bold: true, x: 470 });

  const bytes = await pdf.save();
  writeFileSync("/tmp/test-invoice-discount-vat.pdf", bytes);
  console.log(
    "Wrote /tmp/test-invoice-discount-vat.pdf",
    bytes.length,
    "bytes",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});