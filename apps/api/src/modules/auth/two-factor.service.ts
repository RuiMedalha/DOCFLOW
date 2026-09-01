import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as qrcode from 'qrcode';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../../prisma/prisma.service';

export interface TwoFactorSecretBundle {
  /** Base32 secret — user adds this manually to their authenticator app */
  secret: string;
  /** otpauth:// URI, also embedded in the QR code */
  otpauthUrl: string;
  /** Pre-rendered data-URL PNG for the QR (frontend can show this directly) */
  qrCodeDataUrl: string;
}

/**
 * RFC 6238 TOTP (Google Authenticator compatible). Secrets are persisted in
 * plaintext on the User row because that is what authenticators need to render
 * the same code; if you need at-rest encryption here, encrypt the column with
 * pgcrypto + a KMS-managed key.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issue a fresh secret + QR. Does NOT enable 2FA — caller must confirm with
   * a valid TOTP via `enable()`.
   */
  async generateSecret(userId: string): Promise<TwoFactorSecretBundle> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const issuer = this.config.get<string>('TWO_FACTOR_ISSUER') ?? 'DocFlow';

    const secret = speakeasy.generateSecret({
      name: `${issuer}:${user.email}`,
      issuer,
      length: 20,
    });

    if (!secret.otpauth_url || !secret.base32) {
      throw new Error('Failed to generate TOTP secret');
    }

    const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCodeDataUrl,
    };
  }

  /** Confirm the first code from the authenticator and persist the secret. */
  async enable(userId: string, token: string): Promise<{ enabled: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });
    if (!user || !user.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor setup not started');
    }
    if (!this.verifyToken(user.twoFactorSecret, token)) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    return { enabled: true };
  }

  /** Verify a code against a stored secret (called by login flow). */
  verifyToken(secret: string, token: string): boolean {
    if (!secret || !token) return false;
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1, // accept current +/- 1 step (30s each)
    });
  }

  /**
   * Verification-without-secret: load the user's stored secret and verify.
   * Returns false for users without 2FA enabled so the caller never has to
   * branch on enablement. Used by the public `/auth/2fa/verify` endpoint.
   */
  async verifyForUser(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) return false;
    return this.verifyToken(user.twoFactorSecret, token);
  }

  /**
   * User-initiated disable: requires the current password AND a fresh TOTP code.
   * Both are mandatory so a stolen device alone cannot disable 2FA.
   *
   * Security order (C-04 fix):
   *   1. Verify password with bcrypt.compare FIRST. Wrong password = 401
   *      immediately, the TOTP code is never even consulted. This prevents
   *      an attacker who has a single TOTP value from disabling 2FA.
   *   2. Only after password matches do we consume / verify the TOTP code.
   */
  async disable(userId: string, password: string, token: string): Promise<{ disabled: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        twoFactorSecret: true,
        twoFactorEnabled: true,
      },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor not enabled');
    }

    // Gate 1: must know the current password. This is what changed in C-04.
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      // Identical message to a bad TOTP — do not reveal whether the
      // password is wrong vs. the TOTP is wrong (mild probing defence).
      throw new UnauthorizedException('Invalid credentials');
    }

    // Gate 2: fresh TOTP code.
    if (!this.verifyToken(user.twoFactorSecret, token)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: null, twoFactorEnabled: false },
    });
    this.logger.log(`2FA disabled for user ${userId}`);
    return { disabled: true };
  }
}