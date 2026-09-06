import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * These are written from how the process is actually launched, not from how the
 * schema reads. Docker Compose writes `FOO: ${FOO:-}` as an empty string, so
 * every optional setting arrives as `''` rather than absent -- which took the
 * API down on deploy over a variable nobody had set.
 */
const base = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
} as unknown as NodeJS.ProcessEnv;

describe('environment variables that were never set', () => {
  it('treats an empty optional variable as absent, not as invalid', () => {
    const config = loadConfig({
      ...base,
      ORDERS_EMAIL: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: '',
      DIGILOCKER_CLIENT_ID: '',
      DATABASE_URL: '',
    } as NodeJS.ProcessEnv);

    expect(config.ORDERS_EMAIL).toBeUndefined();
    expect(config.SMTP_HOST).toBeUndefined();
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('still rejects a value that is present and wrong', () => {
    // The empty-string allowance must not become "accept anything".
    expect(() => loadConfig({ ...base, ORDERS_EMAIL: 'not-an-email' } as NodeJS.ProcessEnv)).toThrow(
      /ORDERS_EMAIL/,
    );
    expect(() => loadConfig({ ...base, JWT_SECRET: 'too-short' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET/,
    );
  });
});

describe('boolean environment variables', () => {
  it('reads the values an operator actually writes for false', () => {
    // z.coerce.boolean() is JavaScript truthiness: every one of these would
    // have come back true, quietly leaving implicit TLS on against a server
    // that does not speak it.
    for (const written of ['0', 'false', 'no', 'off', 'FALSE', ' no ']) {
      expect(loadConfig({ ...base, SMTP_SECURE: written } as NodeJS.ProcessEnv).SMTP_SECURE).toBe(
        false,
      );
    }
  });

  it('reads the values an operator writes for true', () => {
    for (const written of ['1', 'true', 'yes', 'on']) {
      expect(loadConfig({ ...base, SMTP_SECURE: written } as NodeJS.ProcessEnv).SMTP_SECURE).toBe(
        true,
      );
    }
  });

  it('keeps its default when unset or empty', () => {
    expect(loadConfig(base).SMTP_SECURE).toBe(true);
    expect(loadConfig({ ...base, SMTP_SECURE: '' } as NodeJS.ProcessEnv).SMTP_SECURE).toBe(true);
  });
});

describe('what production refuses to start without', () => {
  const production = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-secret-that-is-long-enough-to-pass',
    CONSENT_PEPPER: 'a-production-pepper',
    DATABASE_URL: 'postgres://user:pass@db:5432/kidpc',
    WEB_ORIGIN: 'https://kidspc.online',
    PUBLIC_URL: 'https://kidspc.online',
    APPS_ORIGIN: 'https://apps.kidspc.online',
    CONSENT_VERIFIER: 'unavailable',
    DEPLOYMENT_MODE: 'lite',
  } as unknown as NodeJS.ProcessEnv;

  it('starts with mail unconfigured, because queueing is a valid state', () => {
    // Mail is deliberately not a boot requirement: a service that cannot send
    // email should still run and keep the messages, not refuse to start.
    const config = loadConfig(production);
    expect(config.SMTP_HOST).toBeUndefined();
    expect(config.isProduction).toBe(true);
  });

  it('refuses a blank secret as loudly as a missing one', () => {
    expect(() => loadConfig({ ...production, JWT_SECRET: '' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET is required in production/,
    );
  });
});
