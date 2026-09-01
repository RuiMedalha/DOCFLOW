import { Module, forwardRef } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FolderRulesEngine } from './folder-rules/folder-rules.engine';
import { StorageModule } from './storage/storage.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ImageToPdfService } from './image-to-pdf/image-to-pdf.service';

/**
 * DocumentsModule — inbox + folder-rules + storage.
 *
 * Exports DocumentsService and FolderRulesEngine so other modules (CRM,
 * Banking, Reconciliation) can query/update documents without reaching
 * into this module's controllers.
 *
 * StorageModule is imported (NOT made global) so the storage token only
 * resolves inside the documents surface; if S3/MinIO is added later the
 * dependency stays localised.
 *
 * ExtractionModule is imported via forwardRef (it is also `@Global()`,
 * but an explicit import guarantees the injection order is correct AND
 * lets ExtractionService use FolderRulesEngine for AI-driven
 * auto-filing. Both modules reference each other, hence the cycle
 * break).
 */
@Module({
  imports: [StorageModule, forwardRef(() => ExtractionModule)],
  controllers: [DocumentsController],
  providers: [DocumentsService, FolderRulesEngine, ImageToPdfService],
  exports: [DocumentsService, FolderRulesEngine, ImageToPdfService],
})
export class DocumentsModule {}