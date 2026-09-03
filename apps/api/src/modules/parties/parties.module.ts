import { Module, forwardRef } from '@nestjs/common';
import { PartiesService } from './parties.service';
import { PartiesController } from './parties.controller';
import { DocumentsModule } from '../documents/documents.module';

/**
 * PartiesModule — supplier/customer master + PT chart of accounts + IBAN
 * anti-fraud helpers.
 *
 * AuditModule is GLOBAL so we don't need to import it here — `AuditService`
 * is resolvable from anywhere in the DI tree. PrismaModule is the same.
 *
 * DocumentsModule is imported via `forwardRef` to break the circular
 * dependency (DocumentsModule also depends on PartiesService for the
 * supplier assignment path). The PartiesController reaches into
 * DocumentsService directly for the GET /parties/:id/documents read,
 * keeping the documents query logic inside the documents module.
 *
 * Exports PartiesService so other modules (Documents when assigning a
 * supplier, Extraction when matching a NIF, etc.) can reach into it.
 */
@Module({
  imports: [forwardRef(() => DocumentsModule)],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}