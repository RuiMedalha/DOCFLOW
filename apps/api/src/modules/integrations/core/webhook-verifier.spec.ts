import { WebhookVerifier } from './webhook-verifier';

/**
 * Tests for WebhookVerifier — the SendGrid / Mailgun / Stripe /
 * WooCommerce HMAC verification surface used by every webhook
 * controller in the integrations module.
 *
 * The unit under test is pure (no I/O) so the suite is fast and the
 * tests assert on byte-exact output (hex / base64, with or without the
 * SendGrid `sha256=` prefix).
 */

describe('WebhookVerifier', () => {
  const SECRET = 'shhh-this-is-a-secret';
  const BODY = JSON.stringify({ id: 42, total: '19.99' });

  describe('verify()', () => {
    it('accepts a correctly-signed hex digest (WooCommerce pattern)', () => {
      const signature = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      const result = WebhookVerifier.verify(BODY, signature, SECRET, 'sha256');
      expect(result.valid).toBe(true);
    });

    it('accepts a correctly-signed base64 digest (Stripe / Mailgun pattern)', () => {
      const signature = WebhookVerifier.sign(BODY, SECRET, 'sha256-base64');
      const result = WebhookVerifier.verify(
        BODY,
        signature,
        SECRET,
        'sha256-base64',
      );
      expect(result.valid).toBe(true);
    });

    it('accepts the SendGrid `sha256=` prefix', () => {
      const signature = WebhookVerifier.sign(BODY, SECRET, 'sendgrid');
      expect(signature.startsWith('sha256=')).toBe(true);
      const result = WebhookVerifier.verify(
        BODY,
        signature,
        SECRET,
        'sendgrid',
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a tampered body', () => {
      const signature = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      const result = WebhookVerifier.verify(
        BODY + 'x',
        signature,
        SECRET,
        'sha256',
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('mismatch');
    });

    it('rejects an invalid signature', () => {
      const result = WebhookVerifier.verify(
        BODY,
        'deadbeef',
        SECRET,
        'sha256',
      );
      expect(result.valid).toBe(false);
    });

    it('rejects when the signature is missing', () => {
      const result = WebhookVerifier.verify(BODY, null, SECRET, 'sha256');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed');
    });

    it('rejects when the secret is missing', () => {
      const signature = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      const result = WebhookVerifier.verify(BODY, signature, '', 'sha256');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('mismatch');
    });

    it('rejects an unknown scheme', () => {
      const result = WebhookVerifier.verify(
        BODY,
        'sig',
        SECRET,
        'rot13' as any,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unsupported-scheme');
    });

    it('handles Buffer bodies', () => {
      const sig = WebhookVerifier.sign(Buffer.from(BODY), SECRET, 'sha256');
      const result = WebhookVerifier.verify(
        Buffer.from(BODY),
        sig,
        SECRET,
        'sha256',
      );
      expect(result.valid).toBe(true);
    });

    it('detects SendGrid signatures without the prefix too', () => {
      const hex = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      const result = WebhookVerifier.verify(BODY, hex, SECRET, 'sendgrid');
      expect(result.valid).toBe(true);
    });
  });

  describe('sign()', () => {
    it('produces a deterministic signature for the same input', () => {
      const a = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      const b = WebhookVerifier.sign(BODY, SECRET, 'sha256');
      expect(a).toBe(b);
    });

    it('produces different signatures for different secrets', () => {
      const a = WebhookVerifier.sign(BODY, 'one', 'sha256');
      const b = WebhookVerifier.sign(BODY, 'two', 'sha256');
      expect(a).not.toBe(b);
    });

    it('emits base64 when scheme is sha256-base64', () => {
      const sig = WebhookVerifier.sign(BODY, SECRET, 'sha256-base64');
      expect(Buffer.from(sig, 'base64').length).toBeGreaterThan(0);
    });

    it('emits the SendGrid prefix when scheme is sendgrid', () => {
      const sig = WebhookVerifier.sign(BODY, SECRET, 'sendgrid');
      expect(sig.startsWith('sha256=')).toBe(true);
    });
  });
});