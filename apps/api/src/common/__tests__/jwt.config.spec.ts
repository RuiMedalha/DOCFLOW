import { ConfigService } from '@nestjs/config';
import { assertStrongSecret, buildJwtConfig } from '../jwt.config';

/**
 * Boot-time secret-validation tests. These exist to pin the invariant: the
 * server refuses to start with a placeholder or short JWT secret.
 *
 * If someone deletes this file thinking "it's just a config", production
 * will eventually boot with `dev-secret-key-12345` and they will only find
 * out when an attacker forges tokens.
 */

describe('assertStrongSecret', () => {
  it('throws when secret is undefined', () => {
    expect(() => assertStrongSecret(undefined, 'TEST_SECRET')).toThrow(
      /TEST_SECRET is required/,
    );
  });

  it('throws when secret is empty string', () => {
    expect(() => assertStrongSecret('', 'TEST_SECRET')).toThrow(
      /TEST_SECRET is required/,
    );
  });

  it('throws when secret is shorter than 32 chars', () => {
    expect(() => assertStrongSecret('too-short', 'TEST_SECRET')).toThrow(
      /at least 32 characters/,
    );
  });

  it('throws when secret starts with a known dev prefix', () => {
    const dev = 'dev-secret-key-12345-and-some-padding-to-hit-32-chars';
    expect(() => assertStrongSecret(dev, 'TEST_SECRET')).toThrow(
      /starts with "dev-"/,
    );
  });

  it('rejects case-insensitive prefixes', () => {
    const test = 'TEST-secret-key-12345-and-some-padding-to-hit-32-chars';
    expect(() => assertStrongSecret(test, 'TEST_SECRET')).toThrow(
      /starts with "test-"/,
    );
  });

  it('accepts a 32+ char random string with no forbidden prefix', () => {
    const ok = '9ORvzVV77WCV7D1FqyBZSJ_aEafJlrh5gEaTYEb1wKU';
    expect(() => assertStrongSecret(ok, 'TEST_SECRET')).not.toThrow();
  });
});

describe('buildJwtConfig', () => {
  function cfg(values: Record<string, string>): ConfigService {
    return {
      get: <T = string>(key: string): T | undefined => values[key] as T | undefined,
    } as unknown as ConfigService;
  }

  it('rejects the dev-* placeholder value that previously shipped in .env', () => {
    // Long enough to pass the length check so the prefix check is the one that fires.
    const config = cfg({
      JWT_ACCESS_SECRET: 'dev-secret-key-12345-padded-to-pass-length',
    });
    expect(() => buildJwtConfig(config)).toThrow(/starts with "dev-"/);
  });

  it('returns a valid config when given a strong secret', () => {
    const config = cfg({
      JWT_ACCESS_SECRET: '9ORvzVV77WCV7D1FqyBZSJ_aEafJlrh5gEaTYEb1wKU',
      JWT_ISSUER: 'docflow-test',
      JWT_AUDIENCE: 'docflow-api-test',
      JWT_ACCESS_TTL: '10m',
    });
    const out = buildJwtConfig(config);
    expect(out.secret).toBe('9ORvzVV77WCV7D1FqyBZSJ_aEafJlrh5gEaTYEb1wKU');
    expect(out.signOptions?.algorithm).toBe('HS256');
    expect(out.signOptions?.issuer).toBe('docflow-test');
    expect(out.signOptions?.audience).toBe('docflow-api-test');
    expect(out.signOptions?.expiresIn).toBe('10m');
  });

  it('falls back to JWT_SECRET when JWT_ACCESS_SECRET is absent (legacy aliases)', () => {
    const config = cfg({
      JWT_SECRET: 'aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5',
    });
    const out = buildJwtConfig(config);
    expect(out.secret).toBe('aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5');
  });

  it('throws when neither JWT_ACCESS_SECRET nor JWT_SECRET is set', () => {
    const config = cfg({});
    expect(() => buildJwtConfig(config)).toThrow(/JWT_ACCESS_SECRET/);
  });
});