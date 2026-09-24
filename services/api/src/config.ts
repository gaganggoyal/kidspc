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
/**
 * An unset environment variable and an empty one are the same thing.
 *
 * Compose writes `FOO: ${FOO:-}` as `FOO=""`, so every optional setting arrives
 * as an empty string rather than as absent. Without this, `z.string().email()`
 * rejects the empty value and the process refuses to boot over a variable
 * nobody set -- which is exactly how this deploy failed.
 */
const optional = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), inner.optional());

/**
 * Boolean environment variables, read the way an operator writes them.
 *
 * `z.coerce.boolean()` is JavaScript truthiness: it turns "0", "false" and "no"
 * into `true`, so SMTP_SECURE=0 would have silently kept implicit TLS on.
 */
const envBoolean = (fallback: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return fallback;
    if (typeof v !== 'string') return v;
    return !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase());
  }, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres URL. When absent we fall back to an in-process PGlite database. */
  DATABASE_URL: optional(z.string().url()),
  PGLITE_DIR: z.string().default('.data/pglite'),

  /** HS256 key for access tokens. Must be supplied in production. */
  JWT_SECRET: optional(z.string().min(32)),
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

  /**
   * What this deployment can actually serve.
   *
   *   lite  Local activities only -- typing, drawing, blocks, code, writing.
   *         They run in the child's own browser, so concurrency is bounded by
   *         bandwidth rather than RAM and a small VPS serves thousands.
   *   full  The above plus streamed Linux desktops, which cost ~1.5 GiB each
   *         and need real hardware behind them.
   *
   * This is a capacity fact, not a feature flag, so it lives next to the
   * driver rather than in a route.
   */
  DEPLOYMENT_MODE: z.enum(['lite', 'full']).default('full'),
  SESSION_DRIVER: z.enum(['loopback', 'docker']).default('loopback'),
  DESKTOP_IMAGE: z.string().default('kidpc/desktop:dev'),
  DESKTOP_NETWORK: z.string().default('kidpc-sessions'),
  EGRESS_PROXY: z.string().default('kidpc-egress:3128'),
  /**
   * 'network' when the API runs as a container on the session network (no host
   * ports published); 'published' when it runs on the host in development.
   */
  DESKTOP_CONNECT: z.enum(['network', 'published']).default('network'),

  /**
   * `unavailable` is a deliberate production state, not a misconfiguration: the
   * service runs and refuses to onboard any child. See UnavailableConsentVerifier.
   */
  CONSENT_VERIFIER: z.enum(['mock', 'digilocker', 'unavailable']).default('mock'),
  DIGILOCKER_CLIENT_ID: optional(z.string()),
  DIGILOCKER_CLIENT_SECRET: optional(z.string()),
  /** Pepper mixed into consent proof digests. Rotating it invalidates re-checks. */
  CONSENT_PEPPER: optional(z.string().min(16)),

  /**
   * Outgoing mail.
   *
   * Resend is the transport -- the same one meravansh.lol sends through -- and
   * SMTP remains for a host that has a mailbox and no API key. Which one is
   * used is `EMAIL_DELIVERY` when it is set, and otherwise whichever has
   * credentials. See chooseTransport.
   *
   * All optional: without them the process queues mail and logs it instead of
   * sending, which is what keeps a deployment honest before its mailbox exists.
   */
  EMAIL_DELIVERY: optional(z.enum(['resend', 'smtp', 'log'])),
  /** A Resend API key, `re_…`. Sending access is enough. */
  RESEND_API_KEY: optional(z.string().startsWith('re_', 'A Resend API key starts with re_')),
  /**
   * The From line, e.g. "Online Kids PC <hello@kidspc.online>". Its domain is
   * the one the provider has to have verified. SMTP_FROM is still read when
   * this is unset, so an existing env file keeps working.
   */
  MAIL_FROM: optional(z.string()),
  /** Where replies go. A person reads it; a no-reply From should not be a dead end. */
  MAIL_REPLY_TO: optional(z.string().email()),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: envBoolean(true),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),
  /** The older name for MAIL_FROM. */
  SMTP_FROM: optional(z.string()),
  /** Where plan requests are announced. Falls back to MAIL_REPLY_TO, then SMTP_USER. */
  ORDERS_EMAIL: optional(z.string().email()),
  MAIL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(60_000),

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
  /** MAIL_FROM, or SMTP_FROM for an env file written before it existed. */
  mailFrom: string | null;
};

/**
 * Where messages for whoever runs the service go: plan requests, and what
 * people write on the contact page. ORDERS_EMAIL when it is set; otherwise the
 * reply-to address, which a person already reads; otherwise the SMTP login.
 */
export function deskAddress(config: Config): string | null {
  return config.ORDERS_EMAIL ?? config.MAIL_REPLY_TO ?? config.SMTP_USER ?? null;
}

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
    // A lite deployment never provisions a desktop, so the driver is moot --
    // the manager refuses hosted sessions before anything is asked of it.
    if (cfg.DEPLOYMENT_MODE === 'full' && cfg.SESSION_DRIVER === 'loopback') {
      problems.push(
        'SESSION_DRIVER=loopback cannot be used in production with DEPLOYMENT_MODE=full',
      );
    }
    if (cfg.RATE_LIMITS === 'off') {
      problems.push('RATE_LIMITS=off cannot be used in production');
    }
    /*
     * Asked for a transport by name and did not give it what it needs. Falling
     * back to the log here would look like a working deployment and deliver
     * nothing -- including every sign-up's confirmation code.
     */
    const from = cfg.MAIL_FROM ?? cfg.SMTP_FROM;
    if (cfg.EMAIL_DELIVERY === 'resend' && !(cfg.RESEND_API_KEY && from)) {
      problems.push('EMAIL_DELIVERY=resend needs RESEND_API_KEY and MAIL_FROM');
    }
    if (cfg.EMAIL_DELIVERY === 'smtp' && !(cfg.SMTP_HOST && cfg.SMTP_USER && cfg.SMTP_PASS && from)) {
      problems.push('EMAIL_DELIVERY=smtp needs SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM');
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
    mailFrom: cfg.MAIL_FROM ?? cfg.SMTP_FROM ?? null,
    // A generated key means every restart signs out every dev session, which is
    // the correct amount of annoying: it is obvious this is not a real key.
    jwtSecret: new TextEncoder().encode(cfg.JWT_SECRET ?? randomBytes(32).toString('hex')),
    consentPepper: cfg.CONSENT_PEPPER ?? 'dev-consent-pepper-not-for-production',
  };
}
