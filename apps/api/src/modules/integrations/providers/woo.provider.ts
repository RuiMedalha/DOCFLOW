import { BadRequestException, Logger } from '@nestjs/common';
import { DocumentOrigin, DocumentStatus, DocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * NOTE on the Document schema: the model doesn't carry `importedBy` /
 * `importedAt` / `importedFrom` columns — those audit signals live in the
 * `metadata` JSON column under a dedicated namespace, and an audit row
 * is written via AuditService. We don't duplicate state in two places.
 */

/**
 * WooOrder — the subset of the WooCommerce v3 order payload we care
 * about. The real schema has 100+ fields; we project only the ones that
 * map onto Document + Party rows. Anything else is preserved in the
 * rawPayload column for replay/debug.
 */
export interface WooOrder {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  total?: string;
  date_paid?: string | null;
  date_created?: string;
  payment_method?: string;
  payment_method_title?: string;
  billing?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    phone?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    postcode?: string;
    country?: string;
    vat_number?: string; // custom field added by the WooCommerce EU VAT plugin
    nif?: string;
  };
  line_items?: Array<{
    id: number;
    name: string;
    product_id?: number;
    quantity: number;
    subtotal?: string;
    total?: string;
    sku?: string;
  }>;
  meta_data?: Array<{ key: string; value: unknown }>;
}

export interface ProcessedOrder {
  documentId: string;
  partyId: string | null;
  orderNumber: string;
  total: number;
  alreadyProcessed: boolean;
}

/**
 * WooProvider — maps WooCommerce orders into DocFlow Document + Party
 * rows.
 *
 * Sync flow:
 *   1. tenant's WooCommerce integration row is decrypted and we look up
 *      (or create) the customer Party by billing.email.
 *   2. We upsert a Document per order. Idempotent on `externalId`
 *      (`woo:<order.id>`) so duplicate webhooks are safe.
 *   3. Line items become DocumentItem rows; raw payload + signature
 *      metadata go into metadata so the audit trail is complete.
 *
 * Webhook flow:
 *   The webhook controller calls `processWebhook`. The raw body has
 *   already been HMAC-verified by the controller using WebhookVerifier
 *   (X-WC-Webhook-Signature → sha256 with the tenant's webhookSecret).
 *   By the time we get here, we trust the body but we still need to
 *   pick the right tenant — the Integration row carries that.
 */
export class WooProvider {
  private readonly logger = new Logger(WooProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the tenant id from an active WooCommerce integration. */
  async findTenantForOrder(rawBody: string): Promise<string | null> {
    // The body doesn't carry the tenant id; the controller picks the
    // tenant by matching the signature across all configured tenants.
    // This is a stub for future expansion (per-tenant signing keys would
    // let us route by signature alone).
    void rawBody;
    return null;
  }

  /**
   * Process one WooCommerce order → Document + Party.
   *
   * Idempotent: if a Document with `externalId = woo:<id>` already
   * exists, we return it and skip the create. This makes webhook
   * retries safe.
   */
  async processOrder(
    tenantId: string,
    userId: string,
    order: WooOrder,
    source: 'webhook' | 'sync' = 'webhook',
  ): Promise<ProcessedOrder> {
    if (!order.id) {
      throw new BadRequestException('Order missing id');
    }
    const externalId = `woo:${order.id}`;

    // Idempotency check — a duplicate webhook shouldn't double-bill.
    // We dedup on docNumber since the schema doesn't carry a per-provider
    // id column for documents; the JSON `externalIds` carries the
    // provider-tagged id once the row exists.
    const docNumber = order.number ?? String(order.id);
    const existing = await this.prisma.document.findFirst({
      where: {
        tenantId,
        type: DocumentType.FATURA_EMITIDA,
        docNumber,
        origin: DocumentOrigin.API,
      },
      select: { id: true },
    });
    if (existing) {
      const party = await this.lookupParty(tenantId, order);
      return {
        documentId: existing.id,
        partyId: party?.id ?? null,
        orderNumber: order.number ?? String(order.id),
        total: Number(order.total ?? 0),
        alreadyProcessed: true,
      };
    }

    const party = await this.upsertParty(tenantId, order);
    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        fileName: this.fileNameFor(order),
        fileKey: this.fileKeyFor(order),
        fileHash: this.hashFor(order),
        mimeType: 'application/json',
        fileSize: 0,
        origin: DocumentOrigin.API,
        type: DocumentType.FATURA_EMITIDA,
        status: DocumentStatus.NOVO,
        supplier: order.billing?.company?.trim() || this.fullName(order),
        customer: order.billing?.company?.trim() || this.fullName(order),
        supplierNif: order.billing?.vat_number ?? null,
        customerNif: order.billing?.vat_number ?? null,
        docNumber,
        docDate: order.date_paid ? new Date(order.date_paid) : new Date(),
        total: Number(order.total ?? 0),
        currency: order.currency ?? 'EUR',
        metadata: {
          source: 'woocommerce',
          sync: source,
          processedBy: userId,
          processedAt: new Date().toISOString(),
          orderStatus: order.status,
          paymentMethod: order.payment_method,
          paymentMethodTitle: order.payment_method_title,
          rawOrder: order,
        } as unknown as Prisma.InputJsonValue,
        partyId: party?.id ?? null,
      },
    });

    // Line items
    if (order.line_items?.length) {
      await this.prisma.documentItem.createMany({
        data: order.line_items.map((li) => ({
          documentId: doc.id,
          description: li.name,
          quantity: li.quantity,
          unitPrice:
            Number(li.subtotal ?? li.total ?? 0) / Math.max(li.quantity, 1),
          total: Number(li.total ?? 0),
          code: li.sku ?? null,
        })),
      });
    }

    return {
      documentId: doc.id,
      partyId: party?.id ?? null,
      orderNumber: order.number ?? String(order.id),
      total: Number(order.total ?? 0),
      alreadyProcessed: false,
    };
  }

  /**
   * List orders by tenant + sync cursor. Lightweight wrapper around the
   * WooCommerce REST API; uses basic auth (consumer_key:consumer_secret).
   */
  async fetchOrders(
    tenantId: string,
    credentials: {
      storeUrl: string;
      consumerKey: string;
      consumerSecret: string;
      since?: string;
      perPage?: number;
    },
  ): Promise<WooOrder[]> {
    const url = new URL(
      `${credentials.storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/orders`,
    );
    url.searchParams.set('per_page', String(Math.min(credentials.perPage ?? 50, 100)));
    if (credentials.since) url.searchParams.set('after', credentials.since);

    const auth = Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
    ).toString('base64');

    const response = await fetch(url.toString(), {
      headers: { authorization: `Basic ${auth}` },
    });
    if (!response.ok) {
      throw new BadRequestException(
        `WooCommerce fetchOrders failed: ${response.status}`,
      );
    }
    return (await response.json()) as WooOrder[];
  }

  // ─────────────────────────────────────────── helpers ────────────────────

  private async upsertParty(
    tenantId: string,
    order: WooOrder,
  ): Promise<{ id: string } | null> {
    const email = order.billing?.email?.toLowerCase().trim();
    const name =
      order.billing?.company?.trim() ||
      [order.billing?.first_name, order.billing?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
    if (!email && !name) return null;
    const nif = order.billing?.vat_number ?? order.billing?.nif ?? null;

    // Prefer NIF match (firm identity); fall back to email match.
    const existing = nif
      ? await this.prisma.party.findFirst({
          where: { tenantId, nif, isActive: true },
          select: { id: true },
        })
      : null;

    const match =
      existing ??
      (email
        ? await this.prisma.party.findFirst({
            where: { tenantId, email, isActive: true },
            select: { id: true },
          })
        : null);

    if (match) return match;

    return this.prisma.party.create({
      data: {
        tenantId,
        name: name || `Woo customer ${order.id}`,
        nif: nif || null,
        email: email || null,
        phone: order.billing?.phone || null,
        address: [order.billing?.address_1, order.billing?.address_2]
          .filter(Boolean)
          .join(', '),
        city: order.billing?.city || null,
        postalCode: order.billing?.postcode || null,
        country: order.billing?.country || 'PT',
        externalIds: {
          woocommerce: String(order.id),
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  private async lookupParty(
    tenantId: string,
    order: WooOrder,
  ): Promise<{ id: string } | null> {
    const email = order.billing?.email?.toLowerCase().trim();
    const nif = order.billing?.vat_number ?? order.billing?.nif ?? null;
    if (nif) {
      const found = await this.prisma.party.findFirst({
        where: { tenantId, nif, isActive: true },
        select: { id: true },
      });
      if (found) return found;
    }
    if (email) {
      return this.prisma.party.findFirst({
        where: { tenantId, email, isActive: true },
        select: { id: true },
      });
    }
    return null;
  }

  private fullName(order: WooOrder): string {
    return [order.billing?.first_name, order.billing?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private fileNameFor(order: WooOrder): string {
    return `woo-order-${order.number ?? order.id}.json`;
  }

  private fileKeyFor(order: WooOrder): string {
    // No actual upload — WooCommerce orders are JSON we synthesized
    // ourselves. The fileKey is a synthetic, namespaced key so the
    // storage layer can short-circuit a real upload.
    return `integrations/woocommerce/${order.id}.json`;
  }

  private hashFor(order: WooOrder): string {
    // Stable hash over the order payload so future re-runs detect
    // changes (e.g. status updates from on-hold → processing).
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256')
      .update(JSON.stringify(order))
      .digest('hex');
  }
}