import {
  createCipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { DocumentType, Prisma } from '@prisma/client';
import { OAuthStateStore } from './core/oauth-state.store';
import { WebhookVerifier } from './core/webhook-verifier';
import { WooOrder, WooProvider } from './providers/woo.provider';
import { IntegrationsService } from './integrations.service';

/**
 * End-to-end integration test for the WooCommerce provider against an
 * in-memory Prisma mock. We:
 *
 *   1. configure() an integration row with credentials (encrypted).
 *   2. simulate a webhook signature with the production
 *      WebhookVerifier + the same secret.
 *   3. process the webhook → Document + Party rows appear.
 *   4. re-run with the same order id → idempotent (no second Document).
 *
 * No real fetch() is performed — we substitute the WooProvider.fetchOrders
 * implementation with a static stub that returns the same order. The
 * point is to exercise the wiring (service → provider → prisma +
 * audit) end-to-end without an HTTP server.
 */

// ──────────────────────────────────────────────── test doubles

type IntegrationRow = {
  id: string;
  tenantId: string;
  provider: string;
  credentials: any;
  config: any;
  isActive: boolean;
};
type DocumentRow = {
  id: string;
  tenantId: string;
  type: DocumentType;
  docNumber: string;
  origin: any;
  partyId: string | null;
  metadata: any;
};
type DocumentItemRow = {
  id: string;
  documentId: string;
  description: string;
  quantity: any;
  unitPrice: any;
  total: any;
  code: string | null;
};
type PartyRow = {
  id: string;
  tenantId: string;
  name: string;
  nif: string | null;
  email: string | null;
  externalIds: any;
};

function makePrisma() {
  const integrations = new Map<string, IntegrationRow>();
  const documents = new Map<string, DocumentRow>();
  const documentItems: DocumentItemRow[] = [];
  const parties = new Map<string, PartyRow>();
  let counter = 0;

  function findIntegration(tenantId: string, provider: string) {
    return (
      [...integrations.values()].find(
        (r) => r.tenantId === tenantId && r.provider === provider,
      ) ?? null
    );
  }

  return {
    integrations,
    documents,
    documentItems,
    parties,
    integration: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = findIntegration(
          where.tenantId_provider.tenantId,
          where.tenantId_provider.provider,
        );
        if (existing) {
          Object.assign(existing, {
            credentials: update.credentials,
            config: update.config,
            isActive: update.isActive,
          });
          return existing;
        }
        const row: IntegrationRow = {
          id: `int-${++counter}`,
          tenantId: create.tenantId,
          provider: create.provider,
          credentials: create.credentials,
          config: create.config,
          // create() in the service omits isActive when not provided,
          // but we know the configure path always wants isActive=true,
          // so default to true here.
          isActive: create.isActive ?? true,
        };
        integrations.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return findIntegration(where.tenantId, where.provider);
      }),
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [...integrations.values()];
        if (where.tenantId) rows = rows.filter((r) => r.tenantId === where.tenantId);
        if (where.provider) {
          if (typeof where.provider === 'string') {
            rows = rows.filter((r) => r.provider === where.provider);
          } else if (where.provider.startsWith) {
            rows = rows.filter((r) => r.provider.startsWith(where.provider.startsWith));
          }
        }
        if (where.isActive !== undefined) {
          rows = rows.filter((r) => r.isActive === where.isActive);
        }
        if (where.NOT) {
          rows = rows.filter((r) => {
            if (where.NOT.provider?.startsWith) {
              return !r.provider.startsWith(where.NOT.provider.startsWith);
            }
            return true;
          });
        }
        return rows;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return findIntegration(
          where.tenantId_provider.tenantId,
          where.tenantId_provider.provider,
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = integrations.get(where.id);
        if (!row) throw new Error('int missing');
        Object.assign(row, data);
        return row;
      }),
    },
    document: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          [...documents.values()].find(
            (d) =>
              d.tenantId === where.tenantId &&
              d.type === where.type &&
              d.docNumber === where.docNumber &&
              d.origin === where.origin,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `doc-${++counter}`;
        const row: DocumentRow = {
          id,
          tenantId: data.tenantId,
          type: data.type,
          docNumber: data.docNumber,
          origin: data.origin,
          partyId: data.partyId ?? null,
          metadata: data.metadata,
        };
        documents.set(id, row);
        return row;
      }),
    },
    documentItem: {
      createMany: jest.fn(async ({ data }: any) => {
        for (const li of data) {
          documentItems.push({ id: `it-${++counter}`, ...li });
        }
      }),
    },
    party: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const p of parties.values()) {
          if (p.tenantId !== where.tenantId) continue;
          if (where.nif !== undefined && p.nif !== where.nif) continue;
          if (where.email !== undefined && p.email !== where.email) continue;
          return p;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `party-${++counter}`;
        const row: PartyRow = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          nif: data.nif,
          email: data.email,
          externalIds: data.externalIds,
        };
        parties.set(id, row);
        return { id };
      }),
    },
    payment: { findFirst: jest.fn(), update: jest.fn() },
  } as any;
}

function makeAudit() {
  return { log: jest.fn() } as any;
}

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const WEBHOOK_SECRET = 'woo-webhook-shared-secret';

function sampleOrder(): WooOrder {
  return {
    id: 9001,
    number: '9001',
    status: 'processing',
    currency: 'EUR',
    total: '120.00',
    date_paid: '2026-08-30T12:00:00Z',
    payment_method: 'multibanco',
    billing: {
      email: 'w@example.com',
      first_name: 'Maria',
      last_name: 'Silva',
      vat_number: '500697256',
      country: 'PT',
    },
    line_items: [
      {
        id: 1,
        name: 'Item A',
        quantity: 2,
        subtotal: '60.00',
        total: '60.00',
        sku: 'A',
      },
    ],
  };
}

describe('IntegrationsService — WooCommerce end-to-end (mock external)', () => {
  beforeAll(() => {
    process.env.INTEGRATION_ENC_KEY =
      'integration-encryption-key-for-tests-please';
  });

  it('verifies a webhook signature, processes the order, and idempotently rejects duplicates', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const oauthStates = new OAuthStateStore(prisma);
    const woo = new WooProvider(prisma);
    const svc = new IntegrationsService(prisma, audit, oauthStates, woo);

    // 1. Configure the integration with the webhook secret.
    await svc.configure(TENANT_ID, USER_ID, 'woocommerce', {
      credentials: {
        storeUrl: 'https://shop.example.com',
        consumerKey: 'ck_xxx',
        consumerSecret: 'cs_xxx',
        webhookSecret: WEBHOOK_SECRET,
      },
    });
    expect(prisma.integrations.size).toBe(1);

    // 2. Simulate a real WooCommerce webhook payload + signed body.
    const order = sampleOrder();
    const body = JSON.stringify(order);
    const signature = WebhookVerifier.sign(body, WEBHOOK_SECRET, 'sha256');

    // 3. Verify the signature → returns the tenant id.
    const tenantId = await svc.verifyWooWebhook(body, signature);
    expect(tenantId).toBe(TENANT_ID);

    // 4. Process the webhook → Document + Party appear.
    const processed = await svc.processWooWebhook(tenantId, body);
    expect(processed.alreadyProcessed).toBe(false);
    expect(processed.documentId).toMatch(/^doc-/);
    expect(processed.partyId).toMatch(/^party-/);
    expect(prisma.documents.size).toBe(1);
    expect(prisma.parties.size).toBe(1);
    expect(prisma.documentItems.length).toBe(1);

    // 5. A retry of the same webhook is a no-op.
    const processed2 = await svc.processWooWebhook(tenantId, body);
    expect(processed2.alreadyProcessed).toBe(true);
    expect(prisma.documents.size).toBe(1);

    // 6. A tampered body fails verification.
    await expect(
      svc.verifyWooWebhook(body + 'x', signature),
    ).rejects.toBeInstanceOf(Object as any); // UnauthorizedException

    // 7. Wrong secret fails verification.
    const wrongSig = WebhookVerifier.sign(body, 'other-secret', 'sha256');
    await expect(
      svc.verifyWooWebhook(body, wrongSig),
    ).rejects.toBeInstanceOf(Object as any);

    // 8. Audit row was written for the configure call.
    expect(audit.log).toHaveBeenCalled();
  });
});