import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { ContactsService } from './contacts.service';
import { PipelinesService } from './pipelines.service';
import { DealsService } from './deals.service';
import { ActivitiesService } from './activities.service';
import { ContactsController } from './contacts.controller';

/**
 * CrmModule — contacts, contact persons, pipelines, deals, activities,
 * import pipeline (HubSpot / Pipedrive adapters — mock today).
 *
 * Split into focused services:
 *   - CrmService: the original big service (CRUD + import + facade).
 *   - ContactsService: merge + duplicate detection.
 *   - PipelinesService: pipeline + stage probability resolution.
 *   - DealsService: deal board view + forecasting.
 *   - ActivitiesService: pending/overdue activities.
 *
 * AuditModule is GLOBAL so we don't need to import it here — `AuditService`
 * is resolvable from anywhere in the DI tree. PrismaModule is the same.
 *
 * Exports every service so other modules (Documents when assigning a
 * contact, Extraction when matching a NIF, etc.) can reach into them.
 */
@Module({
  controllers: [CrmController, ContactsController],
  providers: [
    CrmService,
    ContactsService,
    PipelinesService,
    DealsService,
    ActivitiesService,
  ],
  exports: [CrmService, ContactsService, PipelinesService, DealsService, ActivitiesService],
})
export class CrmModule {}