import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

/**
 * Image → single-page PDF converter.
 *
 * Wraps the original photo bytes inside a one-page PDF sized to fit the
 * image at its native aspect ratio. The PDF is meant as a *viewable*
 * derivative for the UI / download route — the original photo stays on
 * disk for re-OCR / re-classification.
 *
 * Why pdf-lib: pure JS, zero native deps, embeds JPG / PNG natively via
 * `embedJpg` / `embedPng`. HEIC is intentionally NOT supported here —
 * mobile upload pipelines should transcode HEIC → JPEG before reaching
 * the upload endpoint (see HEIC conversion note in the upload service).
 *
 * Failure policy: any throw bubbles up to the caller, which logs and
 * continues the upload with the image only. We never block the user
 * because the PDF derivative failed.
 */
@Injectable()
export class ImageToPdfService {
  private readonly logger = new Logger(ImageToPdfService.name);

  /** Default page size when we can't sniff the image dimensions (PNG only — pdf-lib returns sizes for JPG/PNG). */
  private static readonly FALLBACK_PAGE_WIDTH = 595.28; // A4 in points
  private static readonly FALLBACK_PAGE_HEIGHT = 841.89;

  /**
   * Convert image bytes (JPG/PNG) into a single-page PDF embedding them
   * at their native pixel size (1 px == 1 pt by default). The caller is
   * expected to pass a mime that's one of `image/jpeg`, `image/jpg`,
   * `image/png` — anything else throws.
   */
  async convert(buffer: Buffer, mime: string): Promise<Buffer> {
    const normalized = mime.toLowerCase();
    const pdf = await PDFDocument.create();
    pdf.setTitle('DocFlow — uploaded document');
    pdf.setProducer('docflow/image-to-pdf');
    pdf.setCreator('DocFlow');

    let embedded;
    let widthPx = 0;
    let heightPx = 0;

    if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
      embedded = await pdf.embedJpg(buffer);
      widthPx = embedded.width;
      heightPx = embedded.height;
    } else if (normalized === 'image/png') {
      embedded = await pdf.embedPng(buffer);
      widthPx = embedded.width;
      heightPx = embedded.height;
    } else {
      throw new Error(`Unsupported image MIME for PDF conversion: ${mime}`);
    }

    // Page size = image size, but capped at A4 so a 4032×3024 phone photo
    // doesn't generate a multi-megabyte PDF. We scale the image to fit
    // the page and leave a 24-pt margin so the result still prints well.
    const margin = 24;
    const maxW = ImageToPdfService.FALLBACK_PAGE_WIDTH - margin * 2;
    const maxH = ImageToPdfService.FALLBACK_PAGE_HEIGHT - margin * 2;

    let pageWidth = widthPx;
    let pageHeight = heightPx;
    if (pageWidth > maxW || pageHeight > maxH) {
      const scale = Math.min(maxW / pageWidth, maxH / pageHeight);
      pageWidth = Math.round(pageWidth * scale);
      pageHeight = Math.round(pageHeight * scale);
    }

    const page = pdf.addPage([pageWidth + margin * 2, pageHeight + margin * 2]);

    // pdf-lib's drawImage expects the image scaled to fit; we re-scale
    // the embedded image object via `scale()`.
    const fitScale = Math.min(
      pageWidth / widthPx,
      pageHeight / heightPx,
    );
    if (fitScale !== 1) {
      embedded.scale(fitScale);
    }

    page.drawImage(embedded, {
      x: margin,
      y: margin,
      width: widthPx * fitScale,
      height: heightPx * fitScale,
    });

    const bytes = await pdf.save();
    this.logger.log(
      `image-to-pdf: in=${buffer.length}B out=${bytes.length}B mime=${normalized}`,
    );
    return Buffer.from(bytes);
  }

  /** True when this mime should produce a PDF derivative. */
  supports(mime: string): boolean {
    const m = mime.toLowerCase();
    return m === 'image/jpeg' || m === 'image/jpg' || m === 'image/png';
  }
}
