import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DocumentOrigin, Prisma } from '@prisma/client';
import { OAuthStateStore } from '../integrations/core/oauth-state.store';
import { PrismaService } from '../../prisma/prisma.service';
import { InboundService } from '../inbound/inbound.service';
import { decryptJson, encryptJson } from './oauth-crypto';
import { fetchWithTimeout } from './fetch-with-timeout';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MS_SCOPES = ['offline_access', 'Mail.Read', 'User.Read'].join(' ');

interface OutlookTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  email?: string;
}

interface GraphAttachment {
  '@odata.type': string;
  id: string;
  name: string;
  contentType: string;
  size: number;
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  from?: { emailAddress?: { address?: string } };
  subject?: string;
  hasAttachments?: boolean;
}

interface GraphMessageListResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
}

const ACCEPTED_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'docx']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * OutlookService — Microsoft Identity Platform OAuth + Microsoft Graph
 * for unread mail attachments. Mirrors the Gmail service exactly
 * (CSRF state via OAuthStateStore, credential envelope via
 * `INTEGRATION_ENC_KEY`, attachment ingest through
 * `InboundService.ingestFiles` with `origin: OUTLOOK`).
 */
@Injectable()
export class OutlookService {
  private readonly logger = new Logger(OutlookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauthStates: OAuthStateStore,
    @Inject(forwardRef(() => InboundService))
    private readonly inbound: InboundService,
  ) {}

  async generateAuthUrl(tenantId: string, userId: string): Promise<{ authUrl: string; state: string }> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ??
      'http://localhost:4000/api/v1/email-inbound/oauth/microsoft/callback';
    if (!clientId) {
      throw new Error('MICROSOFT_CLIENT_ID env var is required');
    }
    const state = randomBytes(32).toString('hex');
    await this.oauthStates.put(tenantId, 'outlook', state, redirectUri);

    const url = new URL(MS_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: MS_SCOPES,
      state,
    }).toString();
    return { authUrl: url.toString(), state };
  }

  async handleCallback(
    code: string,
    state: string,
    tenantId: string,
    _userId: string,
  ): Promise<{ provider: 'outlook'; email?: string }> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ??
      'http://localhost:4000/api/v1/email-inbound/oauth/microsoft/callback';
    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required');
    }
    const tokenRes = await fetchWithTimeout(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      throw new Error(`Microsoft token exchange failed: ${tokenRes.status} ${detail}`);
    }
    const body = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    let email: string | undefined;
    try {
      email = await this.fetchUserEmail(body.access_token);
    } catch (err) {
      this.logger.warn(`Outlook userinfo fetch failed: ${(err as Error).message}`);
    }

    const tokens: OutlookTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope,
      email,
    };

    await this.prisma.integration.upsert({
      where: { tenantId_provider: { tenantId, provider: 'outlook' } },
      create: {
        tenantId,
        provider: 'outlook',
        credentials: encryptJson(tokens),
        isActive: true,
      },
      update: {
        credentials: encryptJson(tokens),
        isActive: true,
        lastSyncAt: null,
        lastSyncStatus: null,
      },
    });
    return { provider: 'outlook', email };
  }

  async pollTenant(tenantId: string): Promise<{ processed: number; errors: string[] }> {
    const integration = await this.prisma.integration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'outlook' } },
    });
    if (!integration?.isActive) return { processed: 0, errors: ['not-configured'] };

    const tokens = decryptJson<OutlookTokens>(String(integration.credentials));
    const fresh = await this.refreshAccessTokenIfNeeded(tenantId, tokens);
    const errors: string[] = [];
    let processed = 0;

    let messages: GraphMessage[] = [];
    try {
      const url = `${GRAPH_BASE}/me/messages?$filter=isRead eq false and hasAttachments eq true&$top=25&$select=id,conversationId,from,subject,hasAttachments`;
      const res = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${fresh.accessToken}` } });
      if (!res.ok) throw new Error(`graph list ${res.status}`);
      const body = (await res.json()) as GraphMessageListResponse;
      messages = body.value ?? [];
    } catch (err) {
      errors.push((err as Error).message);
    }

    for (const meta of messages) {
      try {
        const detailRes = await fetchWithTimeout(
          `${GRAPH_BASE}/me/messages/${meta.id}/attachments`,
          { headers: { authorization: `Bearer ${fresh.accessToken}` } },
        );
        if (!detailRes.ok) throw new Error(`graph attachments ${detailRes.status}`);
        const detail = (await detailRes.json()) as { value: GraphAttachment[] };
        const accepted = (detail.value ?? []).filter(
          (a) =>
            ACCEPTED_EXTS.has(a.name.split('.').pop()?.toLowerCase() ?? '') &&
            a.size > 0 &&
            a.size <= MAX_FILE_SIZE,
        );
        if (accepted.length > 0) {
          const inboundFiles = await Promise.all(
            accepted.map(async (a) => {
              const contentRes = await fetchWithTimeout(
                `${GRAPH_BASE}/me/messages/${meta.id}/attachments/${a.id}/$value`,
                { headers: { authorization: `Bearer ${fresh.accessToken}` } },
              );
              if (!contentRes.ok) throw new Error(`graph attachment bytes ${contentRes.status}`);
              const buffer = Buffer.from(await contentRes.arrayBuffer());
              return {
                buffer,
                originalname: a.name,
                mimetype: a.contentType,
                size: buffer.length,
              };
            }),
          );
          await this.inbound.ingestFiles(
            tenantId,
            inboundFiles,
            DocumentOrigin.OUTLOOK,
            {
              source: 'outlook-poller',
              graphMessageId: meta.id,
              conversationId: meta.conversationId ?? null,
              from: meta.from?.emailAddress?.address ?? null,
              subject: meta.subject ?? null,
            } as Prisma.InputJsonValue,
          );
          processed += inboundFiles.length;
        }
      } catch (err) {
        errors.push(`${meta.id}: ${(err as Error).message}`);
      }
    }

    await this.prisma.integration.update({
      where: { tenantId_provider: { tenantId, provider: 'outlook' } },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: errors.length === 0 ? 'success' : 'partial',
      },
    });
    return { processed, errors };
  }

  private async refreshAccessTokenIfNeeded(
    tenantId: string,
    tokens: OutlookTokens,
  ): Promise<OutlookTokens> {
    const REFRESH_SKEW_MS = 60_000;
    if (!tokens.refreshToken || tokens.expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return tokens;
    }
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required');
    }
    const res = await fetchWithTimeout(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
        scope: MS_SCOPES,
      }),
    });
    if (!res.ok) throw new Error(`outlook refresh ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    const next: OutlookTokens = {
      ...tokens,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope ?? tokens.scope,
    };
    await this.prisma.integration.update({
      where: { tenantId_provider: { tenantId, provider: 'outlook' } },
      data: { credentials: encryptJson(next) },
    });
    return next;
  }

  private async fetchUserEmail(accessToken: string): Promise<string | undefined> {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`graph me ${res.status}`);
    const body = (await res.json()) as { mail?: string; userPrincipalName?: string };
    return body.mail ?? body.userPrincipalName;
  }
}
