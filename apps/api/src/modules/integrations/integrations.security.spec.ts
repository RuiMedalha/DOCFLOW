import { UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createHash } from 'node:crypto';
import { IntegrationsService } from './integrations.service';

// ──────────────────────────────────────────────── test doubles
function buildPrismaStub() {
  return {
    integration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildAuditStub() {
  return { log: jest.fn(async () => undefined), logInTx: jest.fn(async () => undefined) };
}

/** Mirror IntegrationsService.encrypt — produce valid AES-256-GCM envelope. */
function encryptCredentials(plaintext: Record<string, unknown>): string {
  const key = createHash('sha256').update(process.env.INTEGRATION_ENC_KEY!).digest();
  const iv = Buffer.alloc(12, 1);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

function buildIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    tenantId: 'tenant-1',
    provider: 'ifthenpay',
    credentials: encryptCredentials({
      antiPhishingKey: 'apk-secret',
      entidade: '12345',
    }),
    config: null,
    isActive: true,
    ...overrides,
  };
}

describe('IntegrationsService — security mitigations', () => {
  let prisma: ReturnType<typeof buildPrismaStub>;
  let audit: ReturnType<typeof buildAuditStub>;
  let svc: IntegrationsService;

  beforeEach(() => {
    process.env.INTEGRATION_ENC_KEY = 'integration-encryption-key-for-tests-please';
    prisma = buildPrismaStub();
    audit = buildAuditStub();
    const oauthStates = {} as any;
    const woo = {} as any;
    svc = new IntegrationsService(prisma as any, audit as any, oauthStates, woo);
  });

  // ──────────────────────────────────────────────── M2 — ifthenpay amount
  describe('ifthenpay — amount validation (M2)', () => {
    it('rejects a partial callback (0.01 EUR against a 100 EUR invoice)', async () => {
      prisma.integration.findMany.mockResolvedValue([buildIntegration()]);
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        tenantId: 'tenant-1',
        reference: 'REF-1',
        amount: 100,
        status: 'pending',
      });

      await svc.ifthenpay({
        chave: 'apk-secret',
        entidade: '12345',
        referencia: 'REF-1',
        valor: '0.01',
      });

      // No update — partial payment must NOT mark invoice paid.
      expect(prisma.payment.update).not.toHaveBeenCalled();
      // No audit row either (no state transition happened).
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('marks paid + writes audit when callback amount matches invoice within rounding', async () => {
      prisma.integration.findMany.mockResolvedValue([buildIntegration()]);
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-2',
        tenantId: 'tenant-1',
        reference: 'REF-2',
        amount: 100.0,
        status: 'pending',
      });
      prisma.payment.update.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        status: 'paid',
      }));

      const out = await svc.ifthenpay({
        chave: 'apk-secret',
        entidade: '12345',
        referencia: 'REF-2',
        valor: '100.00',
      });

      expect(out).toBe('OK');
      expect(prisma.payment.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.payment.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('paid');
      expect(updateArgs.data.provider).toBe('ifthenpay');

      // Audit row written for the state transition.
      expect(audit.log).toHaveBeenCalledTimes(1);
      const calls = (audit.log as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const auditArgs = calls[0]?.[0] as Record<string, unknown>;
      expect(auditArgs).toBeDefined();
      expect(auditArgs!.tenantId).toBe('tenant-1');
      expect(auditArgs!.entityType).toBe('Payment');
      expect(auditArgs!.entityId).toBe('pay-2');
      expect(auditArgs!.metadata).toMatchObject({
        provider: 'ifthenpay',
        reference: 'REF-2',
        amount: 100,
      });
    });

    it('still rejects callbacks with NaN/zero amounts', async () => {
      prisma.integration.findMany.mockResolvedValue([buildIntegration()]);
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-3',
        tenantId: 'tenant-1',
        reference: 'REF-3',
        amount: 50,
        status: 'pending',
      });

      await svc.ifthenpay({
        chave: 'apk-secret',
        entidade: '12345',
        referencia: 'REF-3',
        valor: '0',
      });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────── L3 — credential whitelist
  describe('test — credential whitelist (L3)', () => {
    it('returns ONLY the whitelisted non-secret fields for toconline', async () => {
      prisma.integration.findUnique.mockResolvedValue({
        id: 'int-tc',
        tenantId: 'tenant-1',
        provider: 'toconline',
        // Decrypt returns the WHOLE credentials object — service must filter.
        credentials: encryptCredentials({
          client_id: 'public-id',
          client_secret: 'VERY-SECRET-SECRET',
          access_token: 'eyJhbGciOi...',
          refresh_token: 'refresh-token-value',
          apiUrl: 'https://api.toconline.pt',
          oauthUrl: 'https://identity.toconline.pt/oauth/authorize',
          redirectUri: 'https://app/cb',
          // A future field the whitelist has not been updated for:
          brand_new_signing_key: 'leak-candidate',
        }),
        config: null,
        isActive: true,
      });

      const out = await svc.test('tenant-1', 'toconline');
      // The whitelisted keys come through…
      expect(out.credentials).toMatchObject({
        client_id: 'public-id',
        apiUrl: 'https://api.toconline.pt',
        oauthUrl: 'https://identity.toconline.pt/oauth/authorize',
        redirectUri: 'https://app/cb',
      });
      // …and nothing else.
      expect(out.credentials).not.toHaveProperty('client_secret');
      expect(out.credentials).not.toHaveProperty('access_token');
      expect(out.credentials).not.toHaveProperty('refresh_token');
      expect(out.credentials).not.toHaveProperty('brand_new_signing_key');
    });

    it('returns an empty credentials object for an unknown provider (fail-closed)', async () => {
      prisma.integration.findUnique.mockResolvedValue({
        id: 'int-xx',
        tenantId: 'tenant-1',
        provider: 'some-future-provider',
        credentials: encryptCredentials({ apiKey: 'leak' }),
        config: null,
        isActive: true,
      });
      const out = await svc.test('tenant-1', 'some-future-provider');
      expect(out.credentials).toEqual({});
    });

    it('ifthenpay test endpoint never exposes antiPhishingKey', async () => {
      prisma.integration.findUnique.mockResolvedValue({
        id: 'int-it',
        tenantId: 'tenant-1',
        provider: 'ifthenpay',
        credentials: encryptCredentials({
          antiPhishingKey: 'apk-leak-candidate',
          entidade: '12345',
          subentidade: '002',
          secret: 'another-leak-candidate',
        }),
        config: null,
        isActive: true,
      });
      const out = await svc.test('tenant-1', 'ifthenpay');
      expect(out.credentials).toEqual({ entidade: '12345', subentidade: '002' });
      expect(out.credentials).not.toHaveProperty('antiPhishingKey');
      expect(out.credentials).not.toHaveProperty('secret');
    });
  });

  // ──────────────────────────────────────────────── crypto hardening
  describe('key() — refuses to boot in degraded mode', () => {
    it('throws when INTEGRATION_ENC_KEY is missing', () => {
      delete process.env.INTEGRATION_ENC_KEY;
      expect(() => (svc as any).key()).toThrow(/INTEGRATION_ENC_KEY/);
    });
  });

  // ──────────────────────────────────────────────── HMAC webhook baseline
  describe('woocommerce — HMAC signature baseline', () => {
    it('rejects a callback with no signature', async () => {
      prisma.integration.findMany.mockResolvedValue([]);
      await expect(svc.woocommerce('{}', '', {} as any)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a callback signed with the stored webhookSecret', async () => {
      prisma.integration.findMany.mockResolvedValue([
        {
          id: 'int-wc',
          tenantId: 'tenant-1',
          credentials: encryptCredentials({ webhookSecret: 'wc-secret' }),
          config: null,
          isActive: true,
        },
      ]);
      const rawBody = '{"id":1}';
      const { createHmac } = require('node:crypto');
      const sig = createHmac('sha256', 'wc-secret').update(rawBody).digest('base64');
      const out = await svc.woocommerce(rawBody, sig, { id: 1 } as any);
      expect(out).toMatchObject({ accepted: true, orderId: 1, tenantId: 'tenant-1' });
    });
  });
});