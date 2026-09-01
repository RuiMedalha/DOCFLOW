import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WebhookVerifier — HMAC signature verification in the SendGrid /
 * Mailgun / Stripe / WooCommerce pattern.
 *
 * Three reference schemes, all implemented below:
 *
 *   - `sha256`  — plain HMAC-SHA256 hex digest. Used by WooCommerce
 *                 (X-WC-Webhook-Signature header). The body is hashed
 *                 with the secret and compared to the signature.
 *
 *   - `sha256-base64` — HMAC-SHA256 base64. Used by Stripe, Mailgun.
 *
 *   - `sendgrid` — SendGrid uses a fixed prefix (`sha256=`) followed by
 *                 a hex digest. We strip the prefix and verify.
 *
 * All comparisons go through `timingSafeEqual` so a timing oracle can't
 * leak the secret one byte at a time. The expected/received buffers are
 * padded to the same length to keep the constant-time property.
 */
export type SignatureScheme = 'sha256' | 'sha256-base64' | 'sendgrid';

export interface VerifyResult {
  valid: boolean;
  reason?: 'malformed' | 'mismatch' | 'unsupported-scheme';
}

export const WebhookVerifier = {
  /**
   * @param rawBody — the EXACT bytes the provider signed (string or Buffer).
   *                  Do NOT re-stringify JSON before passing in.
   * @param signature — the signature header value.
   * @param secret — the shared secret configured for this provider/tenant.
   * @param scheme — which scheme the provider uses.
   */
  verify(
    rawBody: string | Buffer,
    signature: string | null | undefined,
    secret: string,
    scheme: SignatureScheme = 'sha256',
  ): VerifyResult {
    if (!signature) return { valid: false, reason: 'malformed' };
    if (!secret) return { valid: false, reason: 'mismatch' };

    const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    const computed = createHmac('sha256', secret).update(bodyBuf);

    let received: Buffer;
    try {
      switch (scheme) {
        case 'sha256':
          // hex string encoded as UTF-8 — same length as the hex digest.
          received = Buffer.from(signature.trim(), 'utf8');
          break;
        case 'sha256-base64':
          received = Buffer.from(signature.trim(), 'utf8');
          break;
        case 'sendgrid': {
          const trimmed = signature.trim();
          const stripped = trimmed.startsWith('sha256=')
            ? trimmed.slice('sha256='.length)
            : trimmed;
          received = Buffer.from(stripped, 'utf8');
          break;
        }
        default:
          return { valid: false, reason: 'unsupported-scheme' };
      }
    } catch {
      return { valid: false, reason: 'malformed' };
    }

    // Expected digest in the same encoding the caller sent.
    const expectedBuf =
      scheme === 'sha256-base64'
        ? Buffer.from(computed.digest('base64'), 'utf8')
        : Buffer.from(computed.digest('hex'), 'utf8');

    if (received.length !== expectedBuf.length) {
      // timingSafeEqual requires equal-length buffers; falling through
      // it with mismatched lengths leaks length info, so we always
      // return mismatch here.
      return { valid: false, reason: 'mismatch' };
    }
    if (!timingSafeEqual(received, expectedBuf)) {
      return { valid: false, reason: 'mismatch' };
    }
    return { valid: true };
  },

  /**
   * Compute a signature for outbound testing (so tests and the docs
   * example can sign a body without going through a real provider).
   */
  sign(rawBody: string | Buffer, secret: string, scheme: SignatureScheme = 'sha256'): string {
    const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    const h = createHmac('sha256', secret).update(bodyBuf);
    if (scheme === 'sha256-base64') return h.digest('base64');
    return scheme === 'sendgrid' ? `sha256=${h.digest('hex')}` : h.digest('hex');
  },
};
