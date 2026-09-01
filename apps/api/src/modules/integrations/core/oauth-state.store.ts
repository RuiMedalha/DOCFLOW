import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * OAuthStateStore — Prisma-backed storage for OAuth2 PKCE state tokens.
 *
 * Why Prisma and not an in-memory Map? The previous implementation kept
 * state in a process-local Map, which meant:
 *   - a restart silently invalidated every in-flight authorize() call;
 *   - horizontal scaling broke (each pod had its own state);
 *   - cluster restarts left dangling states.
 *
 * We use the Integration table itself: every authorize() call writes a
 * row with the (provider, state) unique key + TTL, callback() consumes
 * it (UPDATE lastSyncAt) so it's easy to audit. A nightly job can sweep
 * `expiresAt < now()`.
 *
 * Concurrency: callback() uses `delete` which is atomic. The store's
 * `consume()` returns the row if-and-only-if it was present, so two
 * concurrent callbacks racing the same state can't both win.
 */
@Injectable()
export class OAuthStateStore {
  private readonly logger = new Logger(OAuthStateStore.name);

  // The integration table has unique on (tenantId, provider). We use a
  // synthetic tenant id ("__oauth_states__") so authorize() doesn't
  // collide with a real configured provider row.
  static readonly STATES_TENANT = '__oauth_states__';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a state token for the (provider, state) pair. Returns the
   * encrypted-shape object the callback will need: tenantId, provider,
   * redirectUri.
   *
   * @param ttlSeconds how long the state stays valid (default 600 = 10 min).
   */
  async put(
    tenantId: string,
    provider: string,
    state: string,
    redirectUri: string,
    ttlSeconds = 600,
  ): Promise<void> {
    // We piggy-back on the Integration model by writing a row keyed by a
    // sentinel provider name. Cleaner would be a dedicated OAuthState
    // table, but that requires a schema migration; the sentinel keeps it
    // deployable today.
    const sentinel = `__state__:${provider}:${state}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.integration.upsert({
      where: {
        tenantId_provider: {
          tenantId: OAuthStateStore.STATES_TENANT,
          provider: sentinel,
        },
      },
      create: {
        tenantId: OAuthStateStore.STATES_TENANT,
        provider: sentinel,
        credentials: JSON.stringify({
          tenantId,
          provider,
          redirectUri,
          expiresAt: expiresAt.toISOString(),
        }) as unknown as Prisma.InputJsonValue,
        isActive: false,
      },
      update: {
        credentials: JSON.stringify({
          tenantId,
          provider,
          redirectUri,
          expiresAt: expiresAt.toISOString(),
        }) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Consume a state token. Returns the stored metadata, OR `null` if
   * the token is unknown or expired. Always deletes the row on hit so
   * a state can only be used once (OAuth2 best practice).
   */
  async consume(
    provider: string,
    state: string,
  ): Promise<{
    tenantId: string;
    provider: string;
    redirectUri: string;
  } | null> {
    const sentinel = `__state__:${provider}:${state}`;
    const row = await this.prisma.integration.findUnique({
      where: {
        tenantId_provider: {
          tenantId: OAuthStateStore.STATES_TENANT,
          provider: sentinel,
        },
      },
    });
    if (!row) return null;

    let payload: {
      tenantId: string;
      provider: string;
      redirectUri: string;
      expiresAt: string;
    };
    try {
      payload = JSON.parse(String(row.credentials));
    } catch {
      // Corrupt row — nuke it.
      await this.prisma.integration.delete({ where: { id: row.id } });
      return null;
    }

    if (new Date(payload.expiresAt).getTime() < Date.now()) {
      this.logger.warn(`OAuth state expired: ${provider}/${state}`);
      await this.prisma.integration.delete({ where: { id: row.id } });
      return null;
    }

    await this.prisma.integration.delete({ where: { id: row.id } });
    return {
      tenantId: payload.tenantId,
      provider: payload.provider,
      redirectUri: payload.redirectUri,
    };
  }

  /**
   * Sweep expired state rows. Safe to call from a cron; returns the
   * number of rows deleted.
   */
  async sweepExpired(): Promise<number> {
    // We can't filter on `credentials` (JSON column) for a server-side
    // date check, so this is a coarse scan + filter in code. Fine for
    // the volume of OAuth state rows we'll ever have.
    const rows = await this.prisma.integration.findMany({
      where: {
        tenantId: OAuthStateStore.STATES_TENANT,
        provider: { startsWith: '__state__:' },
      },
      select: { id: true, credentials: true },
    });
    let deleted = 0;
    for (const row of rows) {
      try {
        const payload = JSON.parse(String(row.credentials));
        if (new Date(payload.expiresAt).getTime() < Date.now()) {
          await this.prisma.integration.delete({ where: { id: row.id } });
          deleted++;
        }
      } catch {
        await this.prisma.integration.delete({ where: { id: row.id } });
        deleted++;
      }
    }
    return deleted;
  }
}