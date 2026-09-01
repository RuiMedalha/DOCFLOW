import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface PasskeyChallenge {
  challengeId: string;
  challenge: string; // base64url
  expiresAt: Date;
}

export interface PasskeyVerifyResult {
  verified: boolean;
  credentialId?: string;
  /**
   * When `verified` is false, the reason lets the caller decide whether to
   * surface a user-visible error or silently fall through. The current
   * skeleton returns `not_implemented` for ALL inputs — see C-05.
   */
  reason?:
    | 'not_implemented'
    | 'challenge_missing'
    | 'challenge_expired'
    | 'signature_invalid'
    | 'credential_unknown';
}

/**
 * WebAuthn / passkeys skeleton — HARD-DISABLED for C-05.
 *
 * The previous implementation returned `{ verified: true, credentialId }` as
 * long as a `challengeId` was still in the in-memory store. That meant anyone
 * who could hit `/auth/passkey/verify` with a valid challengeId (issued by
 * the also-public `/auth/passkey/challenge`) bypassed authentication. Today
 * the controllers are `@Public()` and nothing downstream accepts the result,
 * so the bypass is dormant — but if the skeleton is naively wired into a
 * session later, full auth bypass.
 *
 * Until `@simplewebauthn/server` is wired with REAL signature verification,
 * `verify()` ALWAYS returns `{ verified: false, reason: 'not_implemented' }`.
 * AuthController additionally rejects any flow that would treat a
 * passkey-verified result as an authenticated session.
 *
 * TODO for production:
 *   - Replace the in-memory store with Redis (TTL = 60s) so challenges survive
 *     process restarts and are shared across worker pods.
 *   - Persist registered credentials (credentialId + publicKey + counter + transports)
 *     on a new `PasskeyCredential` model linked to User.
 *   - Verify the clientDataJSON + authenticatorData + signature with
 *     @simplewebauthn/server. The shapes below match the library's types.
 *   - THEN flip the hard-disabled branch off, and have AuthController promote
 *     a verified passkey into a session only after the cryptographic check.
 */
@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);
  /** challengeId -> { challenge, expiresAt }. GC'd lazily on read. */
  private readonly store = new Map<string, PasskeyChallenge>();

  issueChallenge(email?: string): PasskeyChallenge {
    const challengeId = randomBytes(16).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60_000); // 60s
    this.store.set(challengeId, { challengeId, challenge, expiresAt });
    this.logger.debug?.(`issued passkey challenge for ${email ?? 'anonymous'}`);
    return this.store.get(challengeId)!;
  }

  /**
   * C-05: verify() is HARD-DISABLED until `@simplewebauthn/server` is wired.
   * Returns `{ verified: false, reason: 'not_implemented' }` for EVERY input.
   *
   * A correctly-implemented verifier would call
   * `verifyAuthenticationResponse(...)` / `verifyRegistrationResponse(...)`
   * from @simplewebauthn/server with the persisted public key for
   * `credentialId`, and only then set `verified: true`.
   */
  verify(_opts: { challengeId: string; credential: string; expectedType: 'registration' | 'authentication' }): PasskeyVerifyResult {
    // Intentionally do NOT inspect the challenge / credential. The skeleton
    // must be safe by default, not by reachability. Even if the caller
    // provides a real challengeId, real credential, and a real signature,
    // this method still returns not_implemented.
    return { verified: false, reason: 'not_implemented' };
  }

  /** Exposed for tests + scheduled GC if you wire one. */
  listActiveChallenges(): PasskeyChallenge[] {
    const now = new Date();
    const live: PasskeyChallenge[] = [];
    for (const [id, c] of this.store.entries()) {
      if (c.expiresAt < now) {
        this.store.delete(id);
      } else {
        live.push(c);
      }
    }
    return live;
  }
}