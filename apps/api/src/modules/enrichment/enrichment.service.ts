import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  EnrichmentProviderFactory,
  type EnrichmentFields,
  type EnrichmentResult,
} from './providers/provider.factory';

/**
 * EnrichmentService — orchestrates the external-API enrichment flow.
 *
 * Lifecycle of `enrichParty(tenantId, partyId)`:
 *
 *   1. SELECT the Party row (id, nif, iban, country, enrichedAt,
 *      enrichedAt, enrichmentSource, enrichmentError, all the fields
 *      we'd potentially fill).
 *   2. Check 30-day TTL gate. If enrichedAt < 30d AND the cached
 *      source was `sabi-pt` / `vies`, return `{ source: 'cached' }`.
 *   3. Pick the provider via factory (country/iban → sabi-pt / vies /
 *      manual). Caller can force a specific provider with the
 *      optional `forceProvider` argument (UI/debug).
 *   4. Call the provider. Never throw — every provider is best-effort.
 *   5. Apply the **only-fill-nulls** rule: only write fields that are
 *      currently null on the Party row. This preserves manual overrides.
 *   6. UPDATE the Party row:
 *        - enrichedAt = now() if any field was filled
 *        - enrichmentSource = 'sabi-pt' | 'vies' | 'manual' on success
 *        - enrichmentError = null | reason string on failure
 *   7. Audit row: AuditAction.EDIT with metadata.subAction = 'party.enrich'
 *      and `fieldsPopulated`, `source`, `error` for forensics.
 *
 * Concurrency: an in-memory `Map<partyId, Promise>` deduplicates
 * concurrent calls so a UI double-click + a pipeline auto-trigger
 * don't both race the provider. The map key is `tenantId:partyId` so
 * two tenants can't collide.
 *
 * Scope note: this service DOES NOT manage the provider cache itself.
 * Each provider returns fresh data and the 30-day gate is a DB column.
 * That keeps the design testable and Redis-optional.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  /** 30-day TTL gate. Aligned with the scout-report §5.4 decision. */
  private static readonly TTL_MS = 30 * 24 * 60 * 60 * 1000;
  /** Single-flight dedupe. Key: `${tenantId}:${partyId}`. */
  private readonly inFlight = new Map<string, Promise<EnrichmentOutcome>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly factory: EnrichmentProviderFactory,
  ) {}

  // ============================================================ public API

  /**
   * Enrich a single Party. Public surface; controller routes here for
   * `POST /parties/:id/enrich`.
   */
  async enrichParty(
    tenantId: string,
    partyId: string,
    userId: string,
    options: { forceProvider?: 'sabi-pt' | 'vies' | 'manual'; skipCache?: boolean } = {},
  ): Promise<EnrichmentOutcome> {
    const cacheKey = `${tenantId}:${partyId}`;
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      this.logger.debug(
        `[enrichParty] dedupe — returning in-flight promise for ${cacheKey}`,
      );
      return existing;
    }

    const promise = this.runEnrich(tenantId, partyId, userId, options).finally(
      () => {
        this.inFlight.delete(cacheKey);
      },
    );
    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  /**
   * Read-only metadata for `GET /parties/:id/enrichment`. Returns the
   * three columns the UI badge needs without triggering an enrich.
   */
  async getMetadata(
    tenantId: string,
    partyId: string,
  ): Promise<{
    lastEnrichedAt: Date | null;
    source: string | null;
    error: string | null;
    provider: 'sabi-pt' | 'vies' | 'manual' | 'none';
  }> {
    const party = await this.prisma.party.findFirst({
      where: { id: partyId, tenantId },
      select: {
        nif: true,
        country: true,
        iban: true,
        enrichedAt: true,
        enrichmentSource: true,
        enrichmentError: true,
      },
    });
    if (!party) {
      return { lastEnrichedAt: null, source: null, error: null, provider: 'none' };
    }
    const provider = this.factory.pick(party.country, party.iban).name;
    return {
      lastEnrichedAt: party.enrichedAt,
      source: party.enrichmentSource,
      error: party.enrichmentError,
      provider,
    };
  }

  // ============================================================ internals

  /**
   * Pick provider, fetch, apply only-fill-nulls, write back, audit.
   */
  private async runEnrich(
    tenantId: string,
    partyId: string,
    userId: string,
    options: { forceProvider?: 'sabi-pt' | 'vies' | 'manual'; skipCache?: boolean },
  ): Promise<EnrichmentOutcome> {
    const party = await this.prisma.party.findFirst({
      where: { id: partyId, tenantId },
      select: {
        id: true,
        nif: true,
        country: true,
        iban: true,
        enrichedAt: true,
        email: true,
        phone: true,
        mobile: true,
        address: true,
        city: true,
        postalCode: true,
        website: true,
        industry: true,
      },
    });
    if (!party) {
      throw new Error(`Party ${partyId} not found in tenant ${tenantId}`);
    }

    // 30-day TTL gate (skip when caller forces a fresh run).
    if (
      !options.skipCache &&
      party.enrichedAt &&
      Date.now() - party.enrichedAt.getTime() < EnrichmentService.TTL_MS
    ) {
      this.logger.log(
        `[enrichParty] cache hit — party=${partyId} enriched ${Math.round(
          (Date.now() - party.enrichedAt.getTime()) / 86400_000,
        )}d ago`,
      );
      return {
        source: 'cached',
        fieldsPopulated: [],
        error: null,
        fetchedAt: party.enrichedAt,
      };
    }

    const provider = options.forceProvider
      ? this.providerByName(options.forceProvider)
      : this.factory.pick(party.country, party.iban);

    this.logger.log(
      `[enrichParty] tenant=${tenantId} party=${partyId} ` +
        `country=${party.country ?? 'null'} iban=${
          party.iban ? party.iban.slice(0, 4) + '***' : 'null'
        } provider=${provider.name}`,
    );

    const result = await provider.fetch({
      nif: party.nif,
      country: party.country,
      iban: party.iban,
    });

    if (!result.ok) {
      await this.recordFailure(tenantId, partyId, userId, result.reason);
      return {
        source: 'manual',
        fieldsPopulated: [],
        error: result.reason,
        fetchedAt: new Date(),
      };
    }

    const merged = this.applyOnlyFillNulls(party, result.fields);
    if (merged.length === 0) {
      // Provider returned nothing we can use. Mark as 'no_data' but
      // do NOT bump enrichedAt — operator should retry later and the
      // 30d gate shouldn't lock out the next attempt.
      await this.recordFailure(tenantId, partyId, userId, 'no_data');
      return {
        source: 'no_data',
        fieldsPopulated: [],
        error: null,
        fetchedAt: new Date(),
      };
    }

    await this.writeEnrichment(
      tenantId,
      partyId,
      userId,
      result.source,
      merged,
      result.fields,
    );
    return {
      source: result.source,
      fieldsPopulated: merged,
      error: null,
      fetchedAt: new Date(),
    };
  }

  /**
   * Apply the only-fill-nulls rule. Returns the LIST of fields that
   * were actually populated (so the audit row and the API response
   * both know what changed).
   */
  private applyOnlyFillNulls(
    party: {
      email: string | null;
      phone: string | null;
      mobile: string | null;
      address: string | null;
      city: string | null;
      postalCode: string | null;
      website: string | null;
      industry: string | null;
    },
    incoming: EnrichmentFields,
  ): string[] {
    const filled: string[] = [];
    for (const field of [
      'email',
      'phone',
      'mobile',
      'address',
      'city',
      'postalCode',
      'website',
      'industry',
    ] as const) {
      const current = party[field];
      const candidate = incoming[field];
      if (current == null && typeof candidate === 'string' && candidate.length > 0) {
        filled.push(field);
      }
    }
    return filled;
  }

  /**
   * Persist the enrichment: update the Party row with the actual
   * values from the provider + write the audit log in one
   * transaction so the trail never falls out of sync with the data.
   *
   * We construct a partial `UpdatePartyDto`-shaped object so the
   * downstream `PartiesService.update` could be used as an alternative
   * — but since that path runs additional validation that we don't
   * need (IBAN black-list, slug regen), we go directly through
   * `prisma.party.update` to keep the write narrowly scoped to
   * enrichment-time fields. The audit row uses the standard
   * `subAction: 'party.enrich'` so forensic tooling can grep for it.
   */
  private async writeEnrichment(
    tenantId: string,
    partyId: string,
    userId: string,
    source: 'sabi-pt' | 'vies',
    fieldsPopulated: string[],
    incoming: EnrichmentFields,
  ): Promise<void> {
    const existing = await this.prisma.party.findFirst({
      where: { id: partyId, tenantId },
      select: {
        email: true,
        phone: true,
        mobile: true,
        address: true,
        city: true,
        postalCode: true,
        website: true,
        industry: true,
      },
    });
    if (!existing) return;
    const updateData: Record<string, string> = {};
    for (const f of fieldsPopulated) {
      const value = incoming[f as keyof EnrichmentFields];
      if (typeof value === 'string' && value.length > 0) {
        updateData[f] = value;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.party.update({
        where: { id: partyId },
        data: {
          ...updateData,
          enrichedAt: new Date(),
          enrichmentSource: source,
          enrichmentError: null,
        },
      });
      await this.audit.logInTx(tx as unknown as PrismaClient, {
        tenantId,
        userId,
        action: AuditAction.EDIT,
        entityType: 'party',
        entityId: partyId,
        metadata: {
          subAction: 'party.enrich',
          source,
          fieldsPopulated,
        },
      });
    });
  }

  /**
   * Record a failed enrichment so the badge can render honestly.
   * Updates `enrichedAt` to null (we don't want a failed run to lock
   * out a future retry via the 30-day gate) and writes the audit row.
   */
  private async recordFailure(
    tenantId: string,
    partyId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.party.update({
        where: { id: partyId },
        data: {
          // Intentionally NOT touching enrichedAt — keeps the gate open
          // for the next attempt.
          enrichmentSource: 'manual',
          enrichmentError: reason,
        },
      });
      await this.audit.logInTx(tx as unknown as PrismaClient, {
        tenantId,
        userId,
        action: AuditAction.EDIT,
        entityType: 'party',
        entityId: partyId,
        metadata: {
          subAction: 'party.enrich.failed',
          reason,
        },
      });
    });
  }

  /**
   * Resolve a provider by name when the caller passed `forceProvider`.
   * Goes through the factory's instances directly so we don't have to
   * expose the providers as separate injections.
   */
  private providerByName(
    name: 'sabi-pt' | 'vies' | 'manual',
  ): import('./providers/provider.factory').EnrichmentProvider {
    switch (name) {
      case 'sabi-pt':
        return this.factory['sabiPt'];
      case 'vies':
        return this.factory['vies'];
      case 'manual':
        return this.factory['manual'];
    }
  }
}

/**
 * Result returned to the controller. Mirrors `EnrichmentResponseDto`
 * but keeps the date as a Date object for tests (controller converts
 * to ISO before serializing).
 */
export interface EnrichmentOutcome {
  source: 'sabi-pt' | 'vies' | 'manual' | 'cached' | 'no_data';
  fieldsPopulated: string[];
  error: string | null;
  fetchedAt: Date;
}
