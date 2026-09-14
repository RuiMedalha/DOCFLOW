import { BadRequestException } from '@nestjs/common';
import { DocumentOrigin } from '@prisma/client';
import { OutlookService } from '../outlook.service';

/**
 * Tests for OutlookService — Microsoft Graph Inbound with Client Credentials
 * and ApplicationAccessPolicy targeting financeiro@hotelequip.pt.
 */
describe('OutlookService — Client Credentials & Single Channel Policy', () => {
  let service: OutlookService;
  let prismaMock: any;
  let inboundMock: any;
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = (globalThis as any).fetch;
    process.env.MS_TENANT_ID = 'f27c295b-2490-4101-9ae3-6db45ffd9489';
    process.env.MS_CLIENT_ID = '0dcb16b8-3214-49c2-ab13-80c7e07fa332';
    process.env.MS_CLIENT_SECRET = 'test-client-secret';
    process.env.MS_MAILBOX = 'financeiro@hotelequip.pt';
    process.env.MS_MAIL_FOLDER = 'Faturas';

    prismaMock = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-123', nif: '515208566' }),
      },
    };

    inboundMock = {
      ingestFiles: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
    };

    service = new OutlookService(prismaMock, inboundMock);
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  describe('Single-Channel Policy: Delegated OAuth Deactivated', () => {
    it('generateAuthUrl throws BadRequestException', async () => {
      await expect(service.generateAuthUrl('tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('handleCallback throws BadRequestException', async () => {
      await expect(service.handleCallback('code', 'state', 'tenant-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Client Credentials Token', () => {
    it('obtains and caches an application bearer token', async () => {
      (globalThis as any).fetch = jest.fn().mockImplementation(async (url: any) => {
        if (String(url).includes('/oauth2/v2.0/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'test-app-token',
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      });

      const token1 = await service.getAccessToken();
      expect(token1).toBe('test-app-token');

      // Second call uses memory cache
      const token2 = await service.getAccessToken();
      expect(token2).toBe('test-app-token');
      expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mailbox Polling & Attachment Ingestion (Faturas -> Faturas/Processado)', () => {
    it('reads messages in Faturas, extracts attachments, marks as read and moves to Processado', async () => {
      const calls: string[] = [];

      (globalThis as any).fetch = jest.fn().mockImplementation(async (url: any, init: any) => {
        const u = String(url);
        calls.push(`${init?.method || 'GET'} ${u}`);

        if (u.includes('/oauth2/v2.0/token')) {
          return new Response(JSON.stringify({ access_token: 'token-xyz', expires_in: 3600 }), {
            status: 200,
          });
        }
        if (u.endsWith('/users/financeiro%40hotelequip.pt')) {
          return new Response(JSON.stringify({ id: 'user-id-1' }), { status: 200 });
        }
        // Faturas folder resolution
        if (u.includes('/mailFolders') && !u.includes('/messages') && !u.includes('/childFolders')) {
          return new Response(
            JSON.stringify({
              value: [
                { id: 'inbox-id', displayName: 'Inbox' },
                { id: 'faturas-id', displayName: 'Faturas' },
              ],
            }),
            { status: 200 },
          );
        }
        // Child folders in Faturas (Processado)
        if (u.includes('/faturas-id/childFolders')) {
          return new Response(
            JSON.stringify({
              value: [{ id: 'processado-id', displayName: 'Processado' }],
            }),
            { status: 200 },
          );
        }
        // Unread messages in Faturas folder
        if (u.includes('/faturas-id/messages')) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: 'msg-1',
                  subject: 'Fatura Fornecedor XYZ',
                  receivedDateTime: '2026-09-14T09:00:00Z',
                  from: { emailAddress: { address: 'fornecedor@xyz.com' } },
                  attachments: [
                    {
                      '@odata.type': '#microsoft.graph.fileAttachment',
                      id: 'att-1',
                      name: 'FT2026_001.pdf',
                      contentType: 'application/pdf',
                      size: 1024,
                      contentBytes: Buffer.from('dummy-pdf-content').toString('base64'),
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        }
        // Mark as read PATCH
        if (u.includes('/messages/msg-1') && init?.method === 'PATCH') {
          return new Response(JSON.stringify({ isRead: true }), { status: 200 });
        }
        // Move message POST
        if (u.includes('/messages/msg-1/move') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'msg-1-moved' }), { status: 200 });
        }

        return new Response('{}', { status: 200 });
      });

      const res = await service.pollMailbox('tenant-123');
      expect(res.processed).toBe(1);
      expect(inboundMock.ingestFiles).toHaveBeenCalledWith(
        'tenant-123',
        expect.arrayContaining([
          expect.objectContaining({
            originalname: 'FT2026_001.pdf',
            mimetype: 'application/pdf',
          }),
        ]),
        DocumentOrigin.EMAIL,
        expect.objectContaining({
          originalSender: 'fornecedor@xyz.com',
          originalSubject: 'Fatura Fornecedor XYZ',
        }),
      );

      // Verify move to Processado folder was called
      expect(calls.some((c) => c.includes('POST') && c.includes('/messages/msg-1/move'))).toBe(true);
    });
  });
});
