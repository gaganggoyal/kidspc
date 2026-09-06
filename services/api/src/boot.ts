import {
  DisabledDriver,
  DockerDriver,
  LoopbackDriver,
  SessionManager,
  type SessionDriver,
} from '@kidpc/broker';
import { type Config, loadConfig } from './config.js';
import { createDatabase, migrate } from './db/client.js';
import { createRepos } from './repos.js';
import { createConsentVerifier } from './consent/verifier.js';
import { createMailer } from './email/mailer.js';
import { Outbox, sendPending } from './email/outbox.js';
import type { AppContext } from './context.js';

export async function createDriver(
  config: Config,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<SessionDriver> {
  if (config.DEPLOYMENT_MODE === 'lite') {
    // Nothing should ever ask this for a desktop. Wiring in a driver that
    // throws makes that a loud failure rather than a silent provision.
    log('driver.disabled', {
      mode: 'lite',
      note: 'Local activities only. Streamed desktops are not offered.',
    });
    return new DisabledDriver();
  }
  if (config.SESSION_DRIVER === 'docker') {
    const driver = new DockerDriver({
      image: config.DESKTOP_IMAGE,
      network: config.DESKTOP_NETWORK,
      egressProxy: config.EGRESS_PROXY,
      connectVia: config.DESKTOP_CONNECT,
    });
    // Better to fail at boot than to discover a missing image when a child
    // presses Start.
    await driver.preflight();
    return driver;
  }
  log('driver.loopback', {
    warning: 'Sessions are simulated. No real desktop will be provisioned.',
  });
  return new LoopbackDriver();
}

export interface Runtime {
  ctx: AppContext;
  shutdown: () => Promise<void>;
}

/**
 * Assemble the running system. Split out from `index.ts` so integration tests
 * boot exactly the same object graph the server does, minus the listener.
 */
export async function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: () => Date } = {},
): Promise<Runtime> {
  const config = loadConfig(env);
  const database = await createDatabase(config);
  await migrate(database, (msg) => console.log(`[db] ${msg}`));

  const repos = createRepos(database.db);
  const log = (event: string, fields: Record<string, unknown>) =>
    console.log(`[broker] ${event}`, JSON.stringify(fields));

  const driver = await createDriver(config, log);
  const now = options.now ?? (() => new Date());
  const manager = new SessionManager({
    driver,
    store: repos.sessions,
    now,
    log,
    appsOrigin: config.APPS_ORIGIN,
    allowHostedSessions: config.DEPLOYMENT_MODE === 'full',
  });

  const mailer = createMailer(config);
  const outbox = new Outbox(database.db, now);
  if (mailer.name === 'log') {
    // Loud, because a deployment that queues mail into the log looks identical
    // to one that sends it until somebody waits for an email that never came.
    console.log(
      '[mail] transport.log',
      JSON.stringify({
        warning: 'SMTP is not configured. Mail is queued and logged, not delivered.',
        fix: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.',
      }),
    );
  }

  const ctx: AppContext = {
    config,
    database,
    repos,
    manager,
    consent: createConsentVerifier(config),
    mailer,
    outbox,
    now,
  };

  return {
    ctx,
    shutdown: async () => {
      await database.close();
    },
  };
}

/**
 * Periodic reclamation.
 *
 * Runs in-process for now, which is fine while there is one API instance. With
 * several, this must move to a single leader (an advisory lock on the sessions
 * table is the cheapest way) or every instance will race to reap the same
 * desktops. Noted here because it is the first thing that breaks on scale-out.
 */
export function startReaper(ctx: AppContext): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await ctx.manager.reap();
      if (result.ended || result.orphansRemoved) {
        console.log('[reaper]', JSON.stringify(result));
      }
    } catch (error) {
      console.error('[reaper] sweep failed', error);
    } finally {
      if (!stopped) timer = setTimeout(tick, ctx.config.REAP_INTERVAL_MS);
    }
  };

  timer = setTimeout(tick, ctx.config.REAP_INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * Drains the email outbox.
 *
 * A separate loop from the reaper rather than a step inside it: they fail
 * independently and for unrelated reasons, and a mail provider being down must
 * never stop expired sessions from being reclaimed.
 *
 * Same single-instance caveat as the reaper. Two of these would each pick up
 * the same due rows and send some messages twice; `SELECT ... FOR UPDATE SKIP
 * LOCKED` is the fix when it matters, and it does not yet.
 */
/**
 * Whether to hold the queue instead of draining it.
 *
 * The log transport marks a message sent, which is right in development --
 * seeing it is the point. In production it would quietly consume the queue into
 * the log, and the backlog a deployment is holding until its mailbox exists
 * would be gone the moment anyone looked for it. Holding is what makes "fill in
 * the credentials and restart" actually deliver the waiting mail.
 *
 * Extracted so it can be tested: the decision belongs to production, and the
 * test harness deliberately never runs as production.
 */
export function shouldHoldMail(isProduction: boolean, transport: 'smtp' | 'log'): boolean {
  return isProduction && transport === 'log';
}

export function startMailSender(ctx: AppContext): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout;

  const holding = shouldHoldMail(ctx.config.isProduction, ctx.mailer.name);

  const tick = async () => {
    if (stopped) return;
    try {
      if (holding) {
        const pending = await ctx.outbox.pendingCount();
        if (pending > 0) {
          console.log(
            '[mail] holding',
            JSON.stringify({ pending, reason: 'SMTP not configured; nothing is being delivered' }),
          );
        }
      } else {
        const result = await sendPending(ctx.database.db, ctx.mailer, ctx.now);
        if (result.sent || result.failed) {
          console.log('[mail]', JSON.stringify({ ...result, transport: ctx.mailer.name }));
        }
      }
    } catch (error) {
      console.error('[mail] sweep failed', error);
    } finally {
      // Nothing is going out while holding, so check far less often.
      const interval = holding ? Math.max(ctx.config.MAIL_INTERVAL_MS, 300_000) : ctx.config.MAIL_INTERVAL_MS;
      if (!stopped) timer = setTimeout(tick, interval);
    }
  };

  // Runs shortly after boot rather than after a full interval, so a restart
  // clears anything that queued up while the process was down.
  timer = setTimeout(tick, 2_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
