import { DocumentOrigin } from '@prisma/client';
import { OutlookService } from '../outlook.service';
import { encryptJson } from '../oauth-crypto';

/**
 * Tests for OutlookService — Microsoft Identity Platform OAuth +
 * Microsoft Graph polling. Mirrors the Gmail test surface for
 * consistency between the two providers.
 */

const TENANT = 'tenant-outlook';

function makeFixture() {
  const integrations = new Map<string, any>();
  integrations.set(`outlook:${TENANT}`, {
    tenantId: TENANT,
    provider: 'outlook',
    credentials: encryptJson({
      accessToken: 'stale',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000 * 1000, // expired — forces refresh
      email: 'me@example.com',
    }),
    isActive: true,
  });

  const prisma = {
    integration: {
      findUnique: jest.fn(async ({ where }: any) =>
        integrations.get(`${where.tenantId_provider.provider}:${where.tenantId_provider.tenantId}`) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = integrations.get(`${where.tenantId_provider.provider}:${where.tenantId_provider.tenantId}`);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
  } as any;

  const ingestCalls: any[] = [];
  const inbound = {
    ingestFiles: jest.fn(async (...args: any[]) => {
      ingestCalls.push(args);
      return [{ id: 'doc-1' }];
    }),
  } as any;

  return { prisma, integrations, ingestCalls, inbound };
}

describe('OutlookService.handleCallback', () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = 'cid';
    process.env.MICROSOFT_CLIENT_SECRET = 'csecret';
    process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:4000/callback';
    process.env.INTEGRATION_ENC_KEY = 'integration-secret-key';
  });

  it('persists Outlook tokens encrypted', async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('login.microsoftonline.com/common/oauth2/v2.0/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'outlook-access',
            refresh_token: 'outlook-refresh',
            expires_in: 3600,
            scope: 'Mail.Read',
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('graph.microsoft.com/v1.0/me') && urlStr.endsWith('/me')) {
        return new Response(
          JSON.stringify({ mail: 'me@example.com' }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });

    (globalThis as any).fetch = fetchMock;

    const upsert = jest.fn(async () => undefined);
    const prisma = {
      integration: {
        findUnique: jest.fn(async () => null),
        upsert,
        update: jest.fn(),
      },
    } as any;
    const inbound = { ingestFiles: jest.fn() } as any;
    const oauthStates = { put: jest.fn() } as any;
    const service = new OutlookService(prisma, oauthStates, inbound);
    const out = await service.handleCallback('code', 'state', TENANT, 'user-1');
    expect(out.provider).toBe('outlook');
    expect(upsert).toHaveBeenCalled();
  });
});

describe('OutlookService.pollTenant', () => {
  let originalFetch: any;
  beforeEach(() => {
    originalFetch = (globalThis as any).fetch;
    process.env.INTEGRATION_ENC_KEY = 'integration-secret-key';
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('ingests unread attachments as OUTLOOK origin', async () => {
    const listJson = {
      value: [
        { id: 'AAMkAD', conversationId: 'conv-1', subject: 'Invoice' },
      ],
    };
    const attachmentList = {
      value: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'att-1',
          name: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 128,
        },
      ],
    };
    // PDF bytes — buffer returned
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const refreshJson = { access_token: 'fresh', expires_in: 3600 };

    const fetchMock = jest.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify(refreshJson), { status: 200 });
      }
      if (urlStr.includes('/me/messages?') || urlStr.includes('/me/messages&')) {
        return new Response(JSON.stringify(listJson), { status: 200 });
      }
      if (urlStr.endsWith('/AAMkAD/attachments')) {
        return new Response(JSON.stringify(attachmentList), { status: 200 });
      }
      if (urlStr.endsWith('/AAMkAD/attachments/att-1/$value')) {
        return new Response(pdfBytes, { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    (globalThis as any).fetch = fetchMock;

    const { prisma, ingestCalls, inbound } = makeFixture();
    const oauthStates = { put: jest.fn() } as any;
    const service = new OutlookService(prisma, oauthStates, inbound);
    const out = await service.pollTenant(TENANT);
    expect(out.processed).toBe(1);
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0][2]).toBe(DocumentOrigin.OUTLOOK);
    expect((ingestCalls[0][3] as any).source).toBe('outlook-poller');
  });
});
