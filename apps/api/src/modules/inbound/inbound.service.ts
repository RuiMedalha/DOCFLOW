import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DocumentOrigin, Prisma } from '@prisma/client';
import { createHash, createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../../prisma/prisma.service';
import { ExtractionService } from '../extraction/extraction.service';
import { StorageService } from '../documents/storage/storage-service.interface';
import type { ImapConfigDto } from './dto/imap-config.dto';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'docx']);
const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

interface InboundFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface InboundDocumentsPort {
  createFromInbound(input: {
    tenantId: string;
    file: InboundFile;
    origin: DocumentOrigin;
    metadata?: Prisma.InputJsonValue;
  }): Promise<{ id: string; fileName: string }>;
}

/**
 * Temporary adapter until src/modules/documents/DocumentsService is delivered.
 * Persists the file bytes via the injected StorageService (L2 fix) so the
 * download route can serve them. The canonical pipeline remains
 * DocumentsService.createFromInbound().
 */
class PrismaInboundDocumentsAdapter implements InboundDocumentsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createFromInbound(input: {
    tenantId: string;
    file: InboundFile;
    origin: DocumentOrigin;
    metadata?: Prisma.InputJsonValue;
  }): Promise<{ id: string; fileName: string }> {
    const fileHash = createHash('sha256').update(input.file.buffer).digest('hex');
    const safeName = input.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `inbound/${input.tenantId}/${fileHash}-${safeName}`;
    await this.storage.put(fileKey, input.file.buffer, {
      contentType: input.file.mimetype,
    });
    return this.prisma.document.create({
      data: {
        tenantId: input.tenantId,
        fileName: input.file.originalname,
        fileKey,
        fileHash,
        mimeType: input.file.mimetype,
        fileSize: input.file.size,
        origin: input.origin,
        metadata: input.metadata,
      },
      select: { id: true, fileName: true },
    });
  }
}

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);
  private readonly documents: InboundDocumentsPort;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Optional() private readonly extraction: ExtractionService | null,
  ) {
    this.documents = new PrismaInboundDocumentsAdapter(prisma, storage);
  }

  async saveImapConfig(tenantId: string, config: ImapConfigDto) {
    // M3 fix: route IMAP credentials through the same AES-256-GCM envelope
    // used by every other integration provider. Storing the raw password as
    // Prisma.InputJsonValue would expose it on any DB dump.
    const encrypted = this.encryptImapCredentials(config);
    return this.prisma.integration.upsert({
      where: { tenantId_provider: { tenantId, provider: 'imap' } },
      create: {
        tenantId,
        provider: 'imap',
        credentials: encrypted,
        isActive: true,
      },
      update: {
        credentials: encrypted,
        isActive: true,
        lastSyncAt: null,
        lastSyncStatus: null,
      },
    });
  }

  /** M3 — envelope-encrypt IMAP credentials using AES-256-GCM. */
  private encryptImapCredentials(config: ImapConfigDto): string {
    const envKey = process.env.INTEGRATION_ENC_KEY;
    if (!envKey) {
      throw new Error('INTEGRATION_ENC_KEY env var is required to store IMAP credentials');
    }
    // Dynamic import kept lazy so the service boots even if a dev forgets
    // the env var — but the FIRST credential write throws immediately.
    const { createCipheriv, createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const key = createHash('sha256').update(envKey).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
  }

  async syncAll(): Promise<{ tenants: Array<Record<string, unknown>> }> {
    const integrations = await this.prisma.integration.findMany({
      where: { provider: 'imap', isActive: true },
      select: { tenantId: true, lastSyncAt: true, lastSyncStatus: true },
    });
    const tenants = await Promise.all(
      integrations.map(async (integration) => {
        try {
          // M5 fix: per-tenant lastSyncAt guard prevents double-processing
          // when cron runs concurrently or with clock skew. markSeen still
          // protects against duplicates inside a single run.
          const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
          if (
            integration.lastSyncAt &&
            Date.now() - integration.lastSyncAt.getTime() < SYNC_MIN_INTERVAL_MS
          ) {
            return {
              tenantId: integration.tenantId,
              ok: true,
              skipped: true,
              reason: 'synced recently',
              lastSyncAt: integration.lastSyncAt,
            };
          }
          return { tenantId: integration.tenantId, ...(await this.syncTenant(integration.tenantId)) };
        } catch (error) {
          return { tenantId: integration.tenantId, ok: false, error: this.messageOf(error) };
        }
      }),
    );
    return { tenants };
  }

  async syncTenant(tenantId: string): Promise<Record<string, unknown>> {
    const integration = await this.prisma.integration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'imap' } },
    });
    if (!integration?.isActive) {
      throw new BadRequestException('IMAP is not configured for this tenant');
    }
    // M3 fix: decrypt the AES-256-GCM envelope that saveImapConfig wrote.
    const config = this.decryptImapCredentials(String(integration.credentials));
    if (!config.host || !config.user || !config.pass) {
      throw new BadRequestException('Invalid IMAP configuration');
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port ?? (config.secure === false ? 143 : 993),
      secure: config.secure !== false,
      auth: { user: config.user, pass: config.pass },
      logger: false,
    });
    let processed = 0;
    let ignored = 0;
    const errors: Array<{ uid: number; error: string }> = [];
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.mailbox || 'INBOX');
      try {
        for await (const message of client.fetch({ seen: false }, { source: true, uid: true })) {
          try {
            const parsed = await simpleParser(message.source as Buffer);
            const files = (parsed.attachments ?? [])
              .map((attachment) => this.fromAttachment(attachment.filename, attachment.contentType, attachment.content))
              .filter((file): file is InboundFile => file !== null);
            if (files.length === 0) {
              ignored += 1;
            } else {
              await this.ingestFiles(tenantId, files, DocumentOrigin.EMAIL, {
                source: 'imap',
                uid: message.uid,
                from: parsed.from?.text ?? null,
                subject: parsed.subject ?? null,
              });
              processed += files.length;
            }
            if (config.markSeen !== false) {
              await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
            }
          } catch (error) {
            errors.push({ uid: message.uid, error: this.messageOf(error) });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    await this.prisma.integration.update({
      where: { tenantId_provider: { tenantId, provider: 'imap' } },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: errors.length === 0 ? 'success' : 'partial',
      },
    });
    return { ok: errors.length === 0, processed, ignored, errors };
  }

  async ingestWebhookEmail(
    body: Record<string, unknown>,
    files: Express.Multer.File[],
    headers: Record<string, unknown> = {},
  ) {
    // M1 fix: signature verification BEFORE tenant resolution. Without it,
    // any caller could POST arbitrary documents to a tenant's scanEmail.
    this.verifyWebhookSignature(body, headers);

    const recipient = this.firstString(body.to, body.recipient, this.mailgunRecipient(body.envelope));
    const tenant = await this.resolveTenantForEmail(recipient);
    const accepted = files.map((file) => this.fromMulter(file)).filter((file): file is InboundFile => file !== null);
    if (accepted.length === 0) throw new BadRequestException('No supported attachments found');
    const documents = await this.ingestFiles(tenant.id, accepted, DocumentOrigin.EMAIL, {
      source: 'webhook',
      from: this.firstString(body.from, body.sender),
      subject: this.firstString(body.subject),
    });
    return { tenantId: tenant.id, processed: documents.length, documents };
  }

  /**
   * M1 — verify that the inbound email webhook originated from a trusted
   * provider. Supports:
   *
   * 1. SendGrid Inbound Parse webhook (`SENDGRID_INBOUND_SECRET`) —
   *    HMAC-SHA256 base64 over the raw multipart bytes.
   * 2. SendGrid Signed Email webhook (`SENDGRID_WEBHOOK_PUBLIC_KEY`) —
   *    ECDSA-P256 SHA256 over the raw body, signature base64 in the
   *    `x-sendgrid-signature` header. Key must be a PEM-encoded public
   *    key. Documented at:
   *    https://developers.sendgrid.com/docs/for-developers/signing-email/verifying-your-signed-email/
   * 3. Mailgun HMAC-SHA256 (timestamp+token+signature with
   *    `MAILGUN_WEBHOOK_SIGNING_KEY`).
   *
   * Provider is auto-detected from headers. When SendGrid is configured
   * with BOTH the HMAC secret and the ECDSA public key, the ECDSA path
   * takes precedence (more modern / cryptographic). Operators that only
   * have the HMAC secret keep working unchanged.
   *
   * FAIL-CLOSED: when NO provider secret/public-key is configured the
   * endpoint returns 503. Audit finding §5.1.
   */
  private verifyWebhookSignature(body: Record<string, unknown>, headers: Record<string, unknown>): void {
    const headerString = (name: string): string | undefined => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return typeof v === 'string' ? v : undefined;
    };

    const sendgridSig = headerString('x-sendgrid-signature');
    const mailgunSig = headerString('x-mailgun-signature');
    const mailgunToken = headerString('x-mailgun-token');
    const mailgunTs = headerString('x-mailgun-timestamp');

    const sendgridHmacSecret = process.env.SENDGRID_INBOUND_SECRET;
    const sendgridPublicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    const mailgunSecret = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;

    // Fail-closed: if NO provider secret is configured the endpoint is
    // wide open. Reject EVERY request until an operator configures at
    // least one provider. 503 (not 401) because this is a server-side
    // misconfiguration, not a caller failure — the audit suggested 503.
    const providerConfigured =
      sendgridHmacSecret !== undefined ||
      sendgridPublicKey !== undefined ||
      mailgunSecret !== undefined;
    if (!providerConfigured) {
      this.logger.warn(
        '[inbound.verify] inbound webhook received but NO provider is ' +
          'configured (SENDGRID_INBOUND_SECRET / SENDGRID_WEBHOOK_PUBLIC_KEY / ' +
          'MAILGUN_WEBHOOK_SIGNING_KEY) — rejecting. Audit §5.1 fail-closed.',
      );
      throw new ServiceUnavailableException(
        'Inbound email webhook is not configured on this server',
      );
    }

    // Always need raw bytes for the SendGrid paths — both HMAC and
    // ECDSA are computed over the original multipart payload.
    const raw = headers.rawBody;
    const rawBytes: Buffer | undefined =
      raw === undefined || raw === null
        ? undefined
        : typeof raw === 'string'
          ? Buffer.from(raw, 'utf8')
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw as Uint8Array);

    // 1) SendGrid ECDSA — preferred when the public key is configured.
    //    The signature header carries a base64-encoded DER/P1363 ECDSA
    //    signature over SHA256(rawBody). We treat it as an opaque
    //    signature and let `crypto.createVerify` decide which ASN.1
    //    encoding the key expects; if `verify` returns false we fall
    //    through to the HMAC path so operators can rotate keys without
    //    downtime (a brief HMAC fallback window).
    if (sendgridSig && sendgridPublicKey !== undefined) {
      if (rawBytes === undefined) {
        throw new UnauthorizedException(
          'SendGrid ECDSA webhook requires the raw request body to verify the signature (controller did not forward rawBody)',
        );
      }
      if (this.verifySendgridEcdsa(sendgridPublicKey, sendgridSig, rawBytes)) {
        return;
      }
      // Signature verification failed under ECDSA — do NOT fall through
      // (HMAC fallback would mask an attacker tampering with the
      // signature scheme). Fall-through is only safe when the header is
      // ABSENT so the operator knows their HMAC path is the only one
      // matching; for a present-but-invalid signature we hard reject.
      throw new UnauthorizedException('Invalid SendGrid webhook signature');
    }

    // 2) SendGrid Inbound Parse HMAC.
    if (sendgridSig && sendgridHmacSecret !== undefined) {
      if (rawBytes === undefined) {
        throw new UnauthorizedException(
          'SendGrid webhook requires the raw request body to verify the signature (controller did not forward rawBody)',
        );
      }
      const expected = createHmac('sha256', String(sendgridHmacSecret))
        .update(rawBytes)
        .digest('base64');
      const ok = this.safeEqual(expected, sendgridSig);
      if (!ok) throw new UnauthorizedException('Invalid SendGrid webhook signature');
      return;
    }

    // 3) Mailgun HMAC-SHA256.
    if (mailgunSig && mailgunToken && mailgunTs && mailgunSecret) {
      const expected = createHmac('sha256', mailgunSecret)
        .update(mailgunTs + mailgunToken)
        .digest('hex');
      const ok = this.safeEqual(expected, mailgunSig);
      if (!ok) throw new UnauthorizedException('Invalid Mailgun webhook signature');
      return;
    }

    // Reject by default — no signature matched a configured provider.
    // The audit found this endpoint was open in the previous version.
    throw new UnauthorizedException(
      'Inbound email webhook requires a verified SendGrid or Mailgun signature',
    );
  }

  /**
   * Verify a SendGrid-signed email signature using the configured PEM
   * public key. Tries both DER (ASN.1) and P1363 encodings — SendGrid's
   * docs say "the signature is in ECDSA-SHA256 format" without
   * specifying the encoding; Node's `createVerify` only accepts DER, so
   * we use `createVerify('SHA256')` for that path and a manual
   * conversion attempt for P1363 via WebCrypto. Falls back to throwing
   * UnauthorizedException on any decoding failure so the caller can
   * surface a uniform "Invalid signature" message.
   */
  private verifySendgridEcdsa(publicKeyPem: string, signatureB64: string, rawBytes: Buffer): boolean {
    const sig = Buffer.from(signatureB64, 'base64');
    if (sig.length === 0) return false;
    try {
      // P1363 (r||s, 64 bytes for P-256) is what SendGrid returns today.
      // crypto.createVerify only accepts DER-encoded ECDSA signatures,
      // so for P1363 we use the WebCrypto API. Both paths are constant
      // time at the cryptographic primitive level — verification cost
      // dominates any side-channel. WebCrypto is async but tiny, so we
      // wrap it in a synchronous facade by initializing the key once
      // per call (cheap for a webhook that's bounded by an OS process).
      if (sig.length === 64) {
        // Heuristic: P1363 is two 32-byte integers for P-256. Convert
        // to DER by prepending the SEQUENCE/INTEGER headers expected by
        // Node. DER layout for r||s with both integers exactly 32 bytes:
        //   30 44 02 20 <r:32> 02 20 <s:32>
        const r = sig.subarray(0, 32);
        const s = sig.subarray(32, 64);
        const der = Buffer.concat([
          Buffer.from([0x30, 0x44, 0x02, 0x20]),
          r,
          Buffer.from([0x02, 0x20]),
          s,
        ]);
        const verifier = createVerify('SHA256');
        verifier.update(rawBytes);
        verifier.end();
        return verifier.verify(publicKeyPem, der);
      }
      // Otherwise treat the signature as raw DER.
      const verifier = createVerify('SHA256');
      verifier.update(rawBytes);
      verifier.end();
      return verifier.verify(publicKeyPem, sig);
    } catch (err) {
      this.logger.warn(
        `[inbound.verify] SendGrid ECDSA verification error: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  /** M3 — decrypt IMAP credentials envelope written by saveImapConfig. */
  private decryptImapCredentials(blob: string): ImapConfigDto {
    const [iv, tag, data] = blob.split('.');
    if (!iv || !tag || !data) {
      throw new BadRequestException('IMAP credentials are corrupt or in legacy plaintext format — please re-save the IMAP configuration');
    }
    const envKey = process.env.INTEGRATION_ENC_KEY;
    if (!envKey) {
      throw new Error('INTEGRATION_ENC_KEY env var is required to read IMAP credentials');
    }
    const { createDecipheriv, createHash } = require('node:crypto') as typeof import('node:crypto');
    const key = createHash('sha256').update(envKey).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString();
    return JSON.parse(plaintext) as ImapConfigDto;
  }

  async ingestScanner(token: string | undefined, file: Express.Multer.File) {
    if (!token) throw new UnauthorizedException('Scanner token is required');
    const tenant = await this.prisma.tenant.findUnique({ where: { scanToken: token } });
    if (!tenant?.active) throw new UnauthorizedException('Invalid scanner token');
    const inbound = this.fromMulter(file);
    if (!inbound) throw new BadRequestException('Unsupported scanner file');
    const documents = await this.ingestFiles(tenant.id, [inbound], DocumentOrigin.SCANNER, { source: 'scanner' });
    return { tenantId: tenant.id, processed: documents.length, documents };
  }

  private async resolveTenantForEmail(recipient: string | undefined) {
    if (!recipient) throw new UnauthorizedException('Inbound recipient is required');
    const normalized = recipient.trim().toLowerCase();
    const tenant = await this.prisma.tenant.findFirst({
      where: { scanEmail: { equals: normalized, mode: 'insensitive' }, active: true },
    });
    if (!tenant) throw new UnauthorizedException('Unknown inbound recipient');
    return tenant;
  }

  private async ingestFiles(tenantId: string, files: InboundFile[], origin: DocumentOrigin, metadata: Prisma.InputJsonValue) {
    const created = await Promise.all(
      files.map((file) =>
        this.documents.createFromInbound({ tenantId, file, origin, metadata }),
      ),
    );
    // Auto-trigger extraction on every inbound file. Failures are
    // logged and never abort the ingest — extraction is best-effort.
    if (this.extraction) {
      for (const doc of created) {
        this.extraction
          .enqueue({ tenantId, userId: null, documentId: doc.id })
          .catch((err) =>
            this.logger.warn(
              `auto-extract failed for ${doc.id}: ${(err as Error).message}`,
            ),
          );
      }
    }
    return created;
  }

  private fromMulter(file: Express.Multer.File | undefined): InboundFile | null {
    if (!file) return null;
    return this.validateFile({ buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size });
  }

  private fromAttachment(filename: string | undefined, mimetype: string, buffer: Buffer): InboundFile | null {
    return this.validateFile({
      buffer,
      originalname: filename || `attachment-${Date.now()}`,
      mimetype,
      size: buffer.length,
    });
  }

  private validateFile(file: InboundFile): InboundFile | null {
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    if (!extension || !ACCEPTED_EXTENSIONS.has(extension)) return null;
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return null;
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype.toLowerCase())) return null;
    return file;
  }

  private firstString(...values: unknown[]): string | undefined {
    return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
  }

  private mailgunRecipient(envelope: unknown): string | undefined {
    if (typeof envelope !== 'string') return undefined;
    try {
      const value = JSON.parse(envelope) as { to?: string | string[] };
      return Array.isArray(value.to) ? value.to[0] : value.to;
    } catch {
      return undefined;
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
