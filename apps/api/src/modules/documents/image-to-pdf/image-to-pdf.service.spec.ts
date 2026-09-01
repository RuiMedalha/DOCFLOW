import { PDFDocument } from 'pdf-lib';
import { ImageToPdfService } from './image-to-pdf.service';

/**
 * ImageToPdfService unit tests.
 *
 * We feed the service a real but tiny JPG/PNG so pdf-lib actually
 * parses the bytes — this is the integration surface that bites in
 * production (corrupt mime sniffing, exotic PNG chunks, etc.). The
 * service has no I/O and runs synchronously after a single
 * `PDFDocument.embed*` call.
 */
describe('ImageToPdfService', () => {
  let svc: ImageToPdfService;

  beforeEach(() => {
    svc = new ImageToPdfService();
  });

  describe('supports()', () => {
    it('accepts jpeg / jpg / png', () => {
      expect(svc.supports('image/jpeg')).toBe(true);
      expect(svc.supports('image/jpg')).toBe(true);
      expect(svc.supports('image/png')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(svc.supports('application/pdf')).toBe(false);
      expect(svc.supports('image/heic')).toBe(false);
      expect(svc.supports('text/plain')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(svc.supports('IMAGE/JPEG')).toBe(true);
      expect(svc.supports('Image/Png')).toBe(true);
    });
  });

  describe('convert()', () => {
    // 1×1 PNG with a single transparent pixel — smallest valid PNG.
    // Encoded inline so the test has no external file dependency.
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );

    it('produces a valid PDF from a real PNG', async () => {
      const pdfBytes = await svc.convert(tinyPng, 'image/png');
      // Sanity-check the magic header.
      expect(pdfBytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
      // pdf-lib can re-open what it wrote — round-trip parse to make
      // sure the PDF is structurally complete, not just bytes with a
      // magic header.
      const reopened = await PDFDocument.load(pdfBytes);
      expect(reopened.getPages()).toHaveLength(1);
    });

    it('rejects unsupported mime types with a clear error', async () => {
      await expect(svc.convert(tinyPng, 'image/heic')).rejects.toThrow(
        /Unsupported image MIME/,
      );
    });
  });
});
