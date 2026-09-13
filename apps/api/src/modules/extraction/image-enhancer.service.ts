import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface ImageEnhanceOptions {
  autoRotate?: boolean;
  normalizeContrast?: boolean;
  sharpen?: boolean;
  binarize?: boolean;
  threshold?: number;
}

export interface VisionPreparationResult {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
}

/**
 * ImageEnhancerService — motor de alta velocidade sobre libvips (C/C++).
 *
 * Inspirado nas técnicas do ImageToolbox e Parsr:
 *   1. Auto-rotação física via metadados EXIF da câmara.
 *   2. Resgate de talões térmicos (combustível, restauração) com tinta fraca.
 *   3. Equalização de histograma e binarização adaptativa para OCR.
 *   4. Otimização de payload para Visão IA (Gemini/OpenAI) mantendo 100% de legibilidade.
 */
@Injectable()
export class ImageEnhancerService {
  private readonly logger = new Logger(ImageEnhancerService.name);

  /**
   * Verifica se o motor sharp / libvips está operacional no runtime.
   */
  isAvailable(): boolean {
    try {
      return typeof sharp === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Normaliza a orientação física da imagem com base nos metadados EXIF.
   */
  async autoRotate(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer).rotate().toBuffer();
    } catch (err) {
      this.logger.warn(`Falha na auto-rotação da imagem: ${(err as Error).message}`);
      return buffer;
    }
  }

  /**
   * Resgata talões térmicos apagados ou desbotados (papel amarelado/cinzento, tinta fraca).
   * Aplica esticamento de níveis, amplificação de contraste e filtro de arestas de texto.
   */
  async rescueThermalReceipt(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .rotate()
        .grayscale()
        .toColourspace('b-w')
        .normalize()
        .linear(1.3, -15) // Amplifica o contraste do texto contra o papel térmico
        .sharpen({ sigma: 1.8, m1: 0.8, m2: 2.5 })
        .toBuffer();
    } catch (err) {
      this.logger.warn(`Falha no resgate térmico: ${(err as Error).message}`);
      return buffer;
    }
  }

  /**
   * Pré-processamento geral para OCR e leitura de QR Codes difíceis.
   */
  async enhanceForOcr(buffer: Buffer, options: ImageEnhanceOptions = {}): Promise<Buffer> {
    const {
      autoRotate = true,
      normalizeContrast = true,
      sharpen: shouldSharpen = true,
      binarize = false,
      threshold = 128,
    } = options;

    try {
      let pipeline = sharp(buffer);

      if (autoRotate) {
        pipeline = pipeline.rotate();
      }

      pipeline = pipeline.grayscale().toColourspace('b-w');

      if (normalizeContrast) {
        pipeline = pipeline.normalize();
      }

      if (shouldSharpen) {
        pipeline = pipeline.sharpen({ sigma: 1.4, m1: 0.5, m2: 2.0 });
      }

      if (binarize) {
        pipeline = pipeline.threshold(threshold);
      }

      return await pipeline.toBuffer();
    } catch (err) {
      this.logger.warn(`Falha no pré-processamento de OCR: ${(err as Error).message}`);
      return buffer;
    }
  }

  /**
   * Prepara imagens para envio à Visão IA (Gemini / OpenAI / OpenRouter).
   * Redimensiona documentos com dimensões gigantescas (ex: 48MP de telemóvel)
   * para uma densidade ótima de leitura (max 2048px), poupando quotas e memória.
   */
  async prepareForVisionAi(
    buffer: Buffer,
    maxDimension = 2048,
  ): Promise<VisionPreparationResult> {
    const originalBytes = buffer.length;
    try {
      const metadata = await sharp(buffer).metadata();
      const currentWidth = metadata.width || 2048;
      const currentHeight = metadata.height || 2048;

      let pipeline = sharp(buffer).rotate();

      if (currentWidth > maxDimension || currentHeight > maxDimension) {
        pipeline = pipeline.resize({
          width: currentWidth >= currentHeight ? maxDimension : undefined,
          height: currentHeight > currentWidth ? maxDimension : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Normaliza contraste suavemente para facilitar leitura da IA sem estragar layout
      const optimizedBuffer = await pipeline
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      const outMeta = await sharp(optimizedBuffer).metadata();

      return {
        buffer: optimizedBuffer,
        mimeType: 'image/jpeg',
        width: outMeta.width || currentWidth,
        height: outMeta.height || currentHeight,
        originalBytes,
        optimizedBytes: optimizedBuffer.length,
      };
    } catch (err) {
      this.logger.warn(`Falha ao otimizar imagem para IA: ${(err as Error).message}`);
      return {
        buffer,
        mimeType: 'image/jpeg',
        width: 0,
        height: 0,
        originalBytes,
        optimizedBytes: originalBytes,
      };
    }
  }

  /**
   * Obtém metadados visuais rápidos (largura, altura, formato, rotação EXIF).
   */
  async getMetadata(buffer: Buffer): Promise<sharp.Metadata | null> {
    try {
      return await sharp(buffer).metadata();
    } catch {
      return null;
    }
  }
}
