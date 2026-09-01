// ai.module.ts — NestJS module registering all AI/Copilot services
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { VisionService } from './vision.service';
import { ExtractionService } from './extraction.service';
import { OcrService } from './ocr.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { RetrievalService } from './retrieval.service';
import { RagService } from './rag.service';
import { ClassificationService } from './classification.service';
import { DuplicateService } from './duplicate.service';
import { AnomalyService } from './anomaly.service';
import { LlmProvider } from './llm-provider';

@Module({
  imports: [PrismaModule],
  controllers: [CopilotController],
  providers: [
    LlmProvider,
    CopilotService,
    VisionService,
    ExtractionService,
    OcrService,
    EmbeddingService,
    VectorStoreService,
    RetrievalService,
    RagService,
    ClassificationService,
    DuplicateService,
    AnomalyService,
  ],
  exports: [
    LlmProvider,
    CopilotService,
    VisionService,
    // ExtractionService is intentionally not re-exported here — it's owned by
    // ExtractionModule to avoid a circular module dependency. ExtractionModule
    // imports AiModule so it can use VisionService, but AiModule does not
    // depend on ExtractionModule.
    OcrService,
    EmbeddingService,
    DuplicateService,
    AnomalyService,
  ],
})
export class AiModule {}