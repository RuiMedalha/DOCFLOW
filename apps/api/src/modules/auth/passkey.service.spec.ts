import { PasskeyService } from './passkey.service';

/**
 * C-05 — passkey skeleton must NEVER return `verified: true` until real
 * cryptography is wired. Pre-fix: a caller with a valid challengeId got
 * `{ verified: true, credentialId }` and could walk into any downstream
 * flow that consumed that result. Post-fix: verify() always returns
 * `{ verified: false, reason: 'not_implemented' }` — the test pins this.
 */

describe('PasskeyService.verify (C-05 hard-disabled)', () => {
  let svc: PasskeyService;

  beforeEach(() => {
    svc = new PasskeyService();
  });

  it('returns verified:false with reason:not_implemented for a fresh challenge', () => {
    const c = svc.issueChallenge();
    const out = svc.verify({
      challengeId: c.challengeId,
      credential: 'any-credential-blob',
      expectedType: 'authentication',
    });
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('not_implemented');
  });

  it('returns verified:false even after the challenge was actually issued', () => {
    const c = svc.issueChallenge('alice@example.com');
    // Two verify calls with the SAME valid challengeId — both must still refuse.
    for (let i = 0; i < 2; i++) {
      const out = svc.verify({
        challengeId: c.challengeId,
        credential: 'pretend-clientDataJSON',
        expectedType: 'authentication',
      });
      expect(out.verified).toBe(false);
      expect(out.reason).toBe('not_implemented');
    }
  });

  it('returns verified:false for an unknown challengeId', () => {
    const out = svc.verify({
      challengeId: 'never-issued-challengeId',
      credential: 'whatever',
      expectedType: 'authentication',
    });
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('not_implemented');
  });

  it('returns verified:false for `registration` expectedType too', () => {
    const out = svc.verify({
      challengeId: 'does-not-matter',
      credential: 'does-not-matter',
      expectedType: 'registration',
    });
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('not_implemented');
  });

  it('REGRESSION: NEVER returns verified:true under any input shape', () => {
    const c1 = svc.issueChallenge();
    const c2 = svc.issueChallenge();
    const inputs = [
      { challengeId: c1.challengeId, credential: 'a'.repeat(64), expectedType: 'authentication' as const },
      { challengeId: c2.challengeId, credential: 'a'.repeat(200), expectedType: 'registration' as const },
      { challengeId: 'unknown', credential: 'foo', expectedType: 'authentication' as const },
      { challengeId: '', credential: '', expectedType: 'authentication' as const },
    ];
    for (const input of inputs) {
      const out = svc.verify(input);
      // The pin statement: the previous skeleton returned verified:true
      // for the first two of these. Anything that flips verified:true
      // in this test FAILS the regression check.
      expect(out.verified).not.toBe(true);
      expect(out.reason).toBe('not_implemented');
    }
  });
});

describe('PasskeyService.issueChallenge', () => {
  it('still issues 60s challenges (challenge path unchanged)', () => {
    const svc = new PasskeyService();
    const c = svc.issueChallenge('alice@example.com');
    expect(c.challengeId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(svc.listActiveChallenges()).toHaveLength(1);
  });
});