import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Configuration, validated once at boot.
 *
 * The rules at the bottom matter more than the schema: several settings are
 * fine in development and dangerous in production (a fake consent verifier, a
 * pretend desktop driver, a generated signing key). Rather than trusting a
 * deployment checklist, the process refuses to start.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres URL. When absent we fall back to an in-process PGlite database. */
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),

  /** HS256 key for access tokens. Must be supplied in production. */
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),

  /** Where the browser/TV client is served from, for CORS. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /**
   * Where self-hosted app bundles (Scratch, Blockly, the research shell) are
   * served from. Desktops reach it through the egress proxy, and it is the
   * origin the allow-list is built from -- so it must match what the desktop
   * can actually resolve, or every web app silently fails to load.
   */
  APPS_ORIGIN: z.string().url().default('https://apps.kidspc.online'),
  /** Public base URL of the service, used to build absolute links. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  SESSION_DRIVER: z.enum(['loopback', 'docker']).default('loopback'),
  DESKTOP_IMAGE: z.string().default('kidpc/desktop:dev'),
  DESKTOP_NETWORK: z.string().default('kidpc-sessions'),
  EGRESS_PROXY: z.string().default('kidpc-egress:3128'),
  /**
   * 'network' when the API runs as a container on the session network (no host
   * ports published); 'published' when it runs on the host in development.
   */
  DESKTOP_CONNECT: z.enum(['network', 'published']).default('network'),

  CONSENT_VERIFIER: z.enum(['mock', 'digilocker']).default('mock'),
  DIGILOCKER_CLIENT_ID: z.string().optional(),
  DIGILOCKER_CLIENT_SECRET: z.string().optional(),
  /** Pepper mixed into consent proof digests. Rotating it invalidates re-checks. */
  CONSENT_PEPPER: z.string().min(16).optional(),

  REAP_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),

  /**
   * Rate limiting. Off only for test suites that hammer the auth routes from a
   * single address; production is not allowed to turn it off.
   */
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
});

export type Config = z.infer<typeof schema> & {
  jwtSecret: Uint8Array;
  consentPepper: string;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  const isProduction = cfg.NODE_ENV === 'production';

  const problems: string[] = [];
  if (isProduction) {
    if (!cfg.JWT_SECRET) problems.push('JWT_SECRET is required in production');
    if (!cfg.DATABASE_URL) problems.push('DATABASE_URL is required in production (PGlite is a dev database)');
    if (!cfg.CONSENT_PEPPER) problems.push('CONSENT_PEPPER is required in production');
    if (cfg.CONSENT_VERIFIER === 'mock') {
      // Handing a real child account to a fake consent check is the one failure
      // in this system with a regulator attached to it.
      problems.push('CONSENT_VERIFIER=mock cannot be used in production');
    }
    if (cfg.SESSION_DRIVER === 'loopback') {
      problems.push('SESSION_DRIVER=loopback cannot be used in production');
    }
    if (cfg.RATE_LIMITS === 'off') {
      problems.push('RATE_LIMITS=off cannot be used in production');
    }
    if (cfg.CONSENT_VERIFIER === 'digilocker' && !cfg.DIGILOCKER_CLIENT_ID) {
      problems.push('DIGILOCKER_CLIENT_ID is required when CONSENT_VERIFIER=digilocker');
    }
    // Cookies are marked Secure in production, so a plaintext origin would
    // silently break every sign-in rather than failing visibly.
    for (const [name, value] of [
      ['WEB_ORIGIN', cfg.WEB_ORIGIN],
      ['PUBLIC_URL', cfg.PUBLIC_URL],
      ['APPS_ORIGIN', cfg.APPS_ORIGIN],
    ] as const) {
      if (!value.startsWith('https://')) {
        problems.push(`${name} must be https in production (got ${value})`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return {
    ...cfg,
    isProduction,
    // A generated key means every restart signs out every dev session, which is
    // the correct amount of annoying: it is obvious this is not a real key.
    jwtSecret: new TextEncoder().encode(cfg.JWT_SECRET ?? randomBytes(32).toString('hex')),
    consentPepper: cfg.CONSENT_PEPPER ?? 'dev-consent-pepper-not-for-production',
  };
}
