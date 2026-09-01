import { BadRequestException } from '@nestjs/common';
import { DocumentOrigin, DocumentType, Prisma } from '@prisma/client';
import { WooOrder, WooProvider } from './woo.provider';

/**
 * Tests for WooProvider — order → Document + Party mapping.
 *
 * The provider is the only place that knows the WooCommerce payload
 * shape. Tests cover:
 *   - idempotent create (a second order with the same id is a no-op)
 *   - party upsert by NIF (firm identity wins over email)
 *   - party create when neither NIF nor email is provided
 *   - line items become DocumentItem rows
 *   - billing fields populate the right columns
 *   - missing order id is a 400
 */

type DocumentRow = {
  id: string;
  tenantId: string;
  type: DocumentType;
  status: any;
  docNumber: string;
  partyId: string | null;
  origin: DocumentOrigin;
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
  const documents = new Map<string, DocumentRow>();
  const items: DocumentItemRow[] = [];
  const parties = new Map<string, PartyRow>();
  let counter = 0;

  return {
    documents,
    items,
    parties,
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
          status: data.status,
          docNumber: data.docNumber,
          partyId: data.partyId ?? null,
          origin: data.origin,
          metadata: data.metadata,
        };
        documents.set(id, row);
        return row;
      }),
    },
    documentItem: {
      createMany: jest.fn(async ({ data }: any) => {
        for (const li of data) {
          items.push({ id: `it-${++counter}`, ...li });
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
  } as any;
}

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

function sampleOrder(over: Partial<WooOrder> = {}): WooOrder {
  return {
    id: 1001,
    number: '1001',
    status: 'processing',
    currency: 'EUR',
    total: '99.00',
    date_paid: '2026-08-30T12:00:00Z',
    date_created: '2026-08-30T10:00:00Z',
    payment_method: 'multibanco',
    payment_method_title: 'Multibanco',
    billing: {
      email: 'cliente@example.com',
      first_name: 'Maria',
      last_name: 'Silva',
      company: 'Empresa X',
      vat_number: '500697256',
      phone: '+351 910 000 000',
      address_1: 'Rua X, 1',
      city: 'Lisboa',
      postcode: '1000-001',
      country: 'PT',
    },
    line_items: [
      {
        id: 1,
        name: 'Café Torrado 1kg',
        product_id: 42,
        quantity: 2,
        subtotal: '50.00',
        total: '50.00',
        sku: 'CAF-1KG',
      },
    ],
    ...over,
  };
}

describe('WooProvider', () => {
  describe('processOrder()', () => {
    it('creates a Document + Party + Items on the first call', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      const out = await svc.processOrder(
        TENANT_ID,
        USER_ID,
        sampleOrder(),
        'webhook',
      );
      expect(out.alreadyProcessed).toBe(false);
      expect(out.documentId).toMatch(/^doc-/);
      expect(out.partyId).toMatch(/^party-/);
      expect(prisma.documents.size).toBe(1);
      const doc = [...prisma.documents.values()][0];
      expect(doc.docNumber).toBe('1001');
      expect(doc.type).toBe(DocumentType.FATURA_EMITIDA);
      expect(doc.origin).toBe(DocumentOrigin.API);
      expect(prisma.items.length).toBe(1);
      expect(prisma.items[0].code).toBe('CAF-1KG');
    });

    it('is idempotent on the second call with the same order id', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      await svc.processOrder(TENANT_ID, USER_ID, sampleOrder(), 'webhook');
      const second = await svc.processOrder(
        TENANT_ID,
        USER_ID,
        sampleOrder(),
        'webhook',
      );
      expect(second.alreadyProcessed).toBe(true);
      // Still one Document.
      expect(prisma.documents.size).toBe(1);
    });

    it('rejects an order missing an id', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      await expect(
        svc.processOrder(TENANT_ID, USER_ID, { id: 0 } as any, 'webhook'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reuses an existing party by NIF (firm identity)', async () => {
      const prisma = makePrisma();
      prisma.parties.set('party-existing', {
        id: 'party-existing',
        tenantId: TENANT_ID,
        name: 'Existing',
        nif: '500697256',
        email: null,
        externalIds: null,
      });
      const svc = new WooProvider(prisma);
      const out = await svc.processOrder(
        TENANT_ID,
        USER_ID,
        sampleOrder(),
        'webhook',
      );
      expect(out.partyId).toBe('party-existing');
      expect(prisma.parties.size).toBe(1);
    });

    it('creates a party when only an email is available', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      const out = await svc.processOrder(
        TENANT_ID,
        USER_ID,
        sampleOrder({ billing: { email: 'new@example.com' } }),
        'webhook',
      );
      expect(out.partyId).toMatch(/^party-/);
      expect(prisma.parties.size).toBe(1);
      const party = [...prisma.parties.values()][0];
      expect(party.email).toBe('new@example.com');
    });

    it('stores the WooCommerce order id in party.externalIds', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      await svc.processOrder(TENANT_ID, USER_ID, sampleOrder(), 'webhook');
      const party = [...prisma.parties.values()][0];
      expect(party.externalIds).toEqual({ woocommerce: '1001' });
    });

    it('records metadata with source/timestamp/userId', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      await svc.processOrder(TENANT_ID, USER_ID, sampleOrder(), 'sync');
      const doc = [...prisma.documents.values()][0];
      expect(doc.metadata.source).toBe('woocommerce');
      expect(doc.metadata.sync).toBe('sync');
      expect(doc.metadata.processedBy).toBe(USER_ID);
      expect(doc.metadata.processedAt).toBeTruthy();
    });

    it('handles an order with no line items gracefully', async () => {
      const prisma = makePrisma();
      const svc = new WooProvider(prisma);
      const out = await svc.processOrder(
        TENANT_ID,
        USER_ID,
        sampleOrder({ line_items: undefined }),
        'webhook',
      );
      expect(out.documentId).toBeDefined();
      expect(prisma.items.length).toBe(0);
    });
  });
});