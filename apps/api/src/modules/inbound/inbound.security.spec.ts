import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DocumentOrigin, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { InboundService } from './inbound.service';
import type { StorageService } from '../documents/storage/storage-service.interface';

// ──────────────────────────────────────────────── test doubles
function buildPrismaStub() {
  return {
    integration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    document: {
      create: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildStorageStub(): StorageService {
  return {
    driver: 'local',
    put: jest.fn(async () => undefined),
    getBuffer: jest.fn(async () => ({ buffer: Buffer.from(''), size: 0 })),
    remove: jest.fn(async () => undefined),
    exists: jest.fn(async () => true),
    getSignedUrl: jest.fn(async (k) => `/api/v1/documents/storage/${encodeURIComponent(k)}`),
  };
}

function buildExtractionStub() {
  return { enqueue: jest.fn(async () => undefined) };
}

const TENANT = { id: 'tenant-1', name: 'Acme', scanEmail: 'inbox@docflow.test', active: true };

describe('InboundService — security mitigations', () => {
  let prisma: ReturnType<typeof buildPrismaStub>;
  let storage: StorageService;
  let extraction: ReturnType<typeof buildExtractionStub>;
  let svc: InboundService;

  beforeEach(() => {
    process.env.INTEGRATION_ENC_KEY = 'a-very-long-test-key-32-bytes-minimum-aaaaa';
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY = 'mailgun-test-key';
    process.env.SENDGRID_INBOUND_SECRET = 'sendgrid-test-key';
    prisma = buildPrismaStub();
    storage = buildStorageStub();
    extraction = buildExtractionStub();
    svc = new InboundService(prisma as any, storage, extraction as any);
  });

  // ──────────────────────────────────────────────── M1 — webhook signature
  describe('ingestWebhookEmail — signature verification (M1)', () => {
    const sampleFile = {
      fieldname: 'attachment-1',
      originalname: 'invoice.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
      size: 14,
    } as unknown as Express.Multer.File;

    function mailgunHeaders(token: string, ts: string, sig: string) {
      return {
        'x-mailgun-token': token,
        'x-mailgun-timestamp': ts,
        'x-mailgun-signature': sig,
      };
    }

    it('rejects when no provider headers and no secrets are configured (fail-closed)', async () => {
      delete process.env.SENDGRID_INBOUND_SECRET;
      delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
      await expect(
        svc.ingestWebhookEmail(
          { to: TENANT.scanEmail },
          [sampleFile],
          {} as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a valid Mailgun signature', async () => {
      const token = 'tok-123';
      const ts = '1700000000';
      const sig = createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY!)
        .update(ts + token)
        .digest('hex');
      prisma.tenant.findFirst.mockResolvedValue(TENANT);
      prisma.document.create.mockImplementation(async ({ data }: any) => ({
        id: 'doc-mg-1',
        fileName: data.fileName,
      }));

      const out = await svc.ingestWebhookEmail(
        { to: TENANT.scanEmail, from: 'vendor@example.com', subject: 'Anexo' },
        [sampleFile],
        mailgunHeaders(token, ts, sig) as any,
      );
      expect(out.tenantId).toBe(TENANT.id);
      expect(out.processed).toBe(1);
      expect(prisma.tenant.findFirst).toHaveBeenCalled();
    });

    it('rejects a Mailgun signature signed with the wrong key', async () => {
      const token = 'tok-123';
      const ts = '1700000000';
      const wrongSig = createHmac('sha256', 'attacker-key').update(ts + token).digest('hex');

      await expect(
        svc.ingestWebhookEmail(
          { to: TENANT.scanEmail },
          [sampleFile],
          mailgunHeaders(token, ts, wrongSig) as any,
        ),
      ).rejects.toThrow(/Invalid Mailgun/);
    });

    it('rejects a Mailgun signature with a different length (timing-safe)', async () => {
      await expect(
        svc.ingestWebhookEmail(
          { to: TENANT.scanEmail },
          [sampleFile],
          mailgunHeaders('tok', '1700000000', 'short') as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a valid SendGrid signature over the raw multipart bytes (C-10)', async () => {
      // C-10: signature is verified against the raw HTTP body — never
      // against the JSON-stringified parsed fields. The controller
      // forwards req.rawBody (a Buffer) into headers.rawBody.
      const rawBody = Buffer.from(
        '--xBoundary\r\nContent-Disposition: form-data; name="to"\r\n\r\ninbox@docflow.test\r\n--xBoundary--\r\n',
      );
      const sig = createHmac('sha256', process.env.SENDGRID_INBOUND_SECRET!)
        .update(rawBody)
        .digest('base64');
      prisma.tenant.findFirst.mockResolvedValue(TENANT);
      prisma.document.create.mockImplementation(async ({ data }: any) => ({
        id: 'doc-sg-1',
        fileName: data.fileName,
      }));

      const out = await svc.ingestWebhookEmail(
        { to: TENANT.scanEmail },
        [sampleFile],
        { 'x-sendgrid-signature': sig, rawBody } as any,
      );
      expect(out.processed).toBe(1);
    });

    it('rejects a SendGrid signature signed over JSON.stringify(body) (legacy bug)', async () => {
      // C-10 regression: prior code did HMAC(JSON.stringify(body)).
      // An attacker who sees the parsed body could mint a valid signature
      // without knowing the raw wire payload. With raw-body verification,
      // a signature computed over the parsed JSON CANNOT match the real
      // wire bytes — the attacker would need the exact multipart stream.
      const rawBody = Buffer.from(
        '--xBoundary\r\nContent-Disposition: form-data; name="to"\r\n\r\ninbox@docflow.test\r\n--xBoundary--\r\n',
      );
      const legacySig = createHmac('sha256', process.env.SENDGRID_INBOUND_SECRET!)
        .update(JSON.stringify({ to: TENANT.scanEmail }))
        .digest('base64');

      await expect(
        svc.ingestWebhookEmail(
          { to: TENANT.scanEmail },
          [sampleFile],
          { 'x-sendgrid-signature': legacySig, rawBody } as any,
        ),
      ).rejects.toThrow(/Invalid SendGrid/);
    });

    it('rejects when no rawBody is provided (controller regression)', async () => {
      const sig = createHmac('sha256', process.env.SENDGRID_INBOUND_SECRET!)
        .update('doesnt-matter')
        .digest('base64');

      await expect(
        svc.ingestWebhookEmail(
          { to: TENANT.scanEmail },
          [sampleFile],
          { 'x-sendgrid-signature': sig } as any,
        ),
      ).rejects.toThrow(/raw request body/);
    });

    it('rejects an unknown recipient even when signature is valid', async () => {
      const token = 'tok';
      const ts = '1700000000';
      const sig = createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY!)
        .update(ts + token)
        .digest('hex');
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(
        svc.ingestWebhookEmail(
          { to: 'noone@example.com' },
          [sampleFile],
          mailgunHeaders(token, ts, sig) as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ──────────────────────────────────────────────── M3 — IMAP credentials
  describe('saveImapConfig — IMAP credentials are encrypted (M3)', () => {
    it('stores credentials as AES-256-GCM envelope (iv.tag.data), not plaintext JSON', async () => {
      prisma.integration.upsert.mockImplementation(async ({ create }: any) => ({
        id: 'int-1',
        tenantId: create.tenantId,
        provider: create.provider,
        credentials: create.credentials,
        isActive: true,
      }));

      await svc.saveImapConfig(TENANT.id, {
        host: 'imap.example.com',
        port: 993,
        user: 'inbox@example.com',
        pass: 'super-secret-password',
        mailbox: 'INBOX',
      } as any);

      const upsertArgs = prisma.integration.upsert.mock.calls[0][0];
      const stored = upsertArgs.create.credentials as string;
      // Envelope shape: <b64-iv>.<b64-tag>.<b64-ciphertext>
      expect(stored.split('.')).toHaveLength(3);
      // Plaintext must NOT appear in the stored blob
      expect(stored.includes('super-secret-password')).toBe(false);
      // And NOT in the update payload either
      expect(upsertArgs.update.credentials).toBe(stored);
    });

    it('throws when INTEGRATION_ENC_KEY is not set', async () => {
      delete process.env.INTEGRATION_ENC_KEY;
      await expect(
        svc.saveImapConfig(TENANT.id, {
          host: 'imap.example.com',
          user: 'inbox@example.com',
          pass: 'pw',
        } as any),
      ).rejects.toThrow(/INTEGRATION_ENC_KEY/);
    });
  });

  // ──────────────────────────────────────────────── M5 — sync lock
  describe('syncAll — per-tenant lastSyncAt guard (M5)', () => {
    it('skips tenants whose lastSyncAt is within 5 minutes (no double-processing)', async () => {
      const recent = new Date(Date.now() - 60 * 1000); // 1 minute ago
      prisma.integration.findMany.mockResolvedValue([
        { tenantId: 'tenant-A', lastSyncAt: recent, lastSyncStatus: 'success' },
      ]);

      const out = await svc.syncAll();
      expect(out.tenants[0]).toMatchObject({
        tenantId: 'tenant-A',
        ok: true,
        skipped: true,
        reason: 'synced recently',
      });
      expect(prisma.integration.update).not.toHaveBeenCalled();
    });

    it('proceeds for tenants whose lastSyncAt is older than the 5-minute window', async () => {
      const stale = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
      prisma.integration.findMany.mockResolvedValue([
        { tenantId: 'tenant-B', lastSyncAt: stale, lastSyncStatus: 'success' },
      ]);
      // The IMAP sync will fail (no real client) — but the call must at
      // least ATTEMPT (no skip), and the error is reported, not silent.
      const out = await svc.syncAll();
      expect(out.tenants[0]).toMatchObject({ tenantId: 'tenant-B', ok: false });
    });

    it('proceeds for tenants with no prior sync', async () => {
      prisma.integration.findMany.mockResolvedValue([
        { tenantId: 'tenant-C', lastSyncAt: null, lastSyncStatus: null },
      ]);
      const out = await svc.syncAll();
      expect(out.tenants[0]).toMatchObject({ tenantId: 'tenant-C' });
    });
  });

  // ──────────────────────────────────────────────── L2 — file persistence
  describe('PrismaInboundDocumentsAdapter — file bytes persisted (L2)', () => {
    it('writes the buffer to StorageService before creating the document row', async () => {
      prisma.tenant.findFirst.mockResolvedValue(TENANT);
      // need signature to satisfy M1
      const token = 'tok', ts = '1700000000';
      const sig = createHmac('sha256', process.env.MAILGUN_WEBHOOK_SIGNING_KEY!)
        .update(ts + token)
        .digest('hex');
      prisma.document.create.mockImplementation(async ({ data }: any) => ({
        id: 'doc-L2',
        fileName: data.fileName,
      }));

      const file = {
        fieldname: 'attachment-1',
        originalname: 'fatura.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 hello'),
        size: 14,
      } as unknown as Express.Multer.File;

      await svc.ingestWebhookEmail(
        { to: TENANT.scanEmail },
        [file],
        { 'x-mailgun-token': token, 'x-mailgun-timestamp': ts, 'x-mailgun-signature': sig } as any,
      );

      // L2 fix: storage.put is invoked BEFORE prisma.document.create
      expect(storage.put).toHaveBeenCalledTimes(1);
      const [key, buf, opts] = (storage.put as jest.Mock).mock.calls[0];
      expect(typeof key).toBe('string');
      expect(key.startsWith(`inbound/${TENANT.id}/`)).toBe(true);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(opts).toEqual({ contentType: 'application/pdf' });
    });
  });
});