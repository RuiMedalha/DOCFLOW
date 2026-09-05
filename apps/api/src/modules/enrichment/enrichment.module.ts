import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentController } from './enrichment.controller';
import { SabiPtProvider } from './providers/sabi-pt.provider';
import { ViesProvider } from './providers/vies.provider';
import { ManualProvider } from './providers/manual.provider';
import { EnrichmentProviderFactory } from './providers/provider.factory';

/**
 * EnrichmentModule — Sprint I.
 *
 * Provides party enrichment via external APIs (Sabi PT for Portuguese
 * suppliers, VIES for EU VAT numbers, ManualProvider fallback for
 * extra-EU). Wires the provider chain, the service that orchestrates
 * the 30-day TTL cache + only-fill-nulls semantic, and the controller
 * exposing `POST /parties/:id/enrich` (manual trigger from the UI).
 *
 * Wiring notes:
 *   - AuditService is @Global so we don't need to import AuditModule.
 *   - PrismaService is @Global too.
 *   - ConfigModule gives the providers env access for
 *     `SABI_PT_API_KEY`. The providers are `@Injectable` + receive
 *     ConfigService via the constructor — the factory itself is stateless.
 *   - No queue dependency: enrich is a short-running API call (5s
 *     timeout per provider), serialised per-partyId via an in-memory
 *     `Map<string, Promise>` to dedupe concurrent manual clicks.
 */
@Module({
  imports: [ConfigModule],
  controllers: [EnrichmentController],
  providers: [
    SabiPtProvider,
    ViesProvider,
    ManualProvider,
    EnrichmentProviderFactory,
    EnrichmentService,
  ],
  exports: [EnrichmentService, EnrichmentProviderFactory],
})
export class EnrichmentModule {}
