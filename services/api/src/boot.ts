import { DockerDriver, LoopbackDriver, SessionManager, type SessionDriver } from '@kidpc/broker';
import { type Config, loadConfig } from './config.js';
import { createDatabase, migrate } from './db/client.js';
import { createRepos } from './repos.js';
import { createConsentVerifier } from './consent/verifier.js';
import type { AppContext } from './context.js';

export async function createDriver(
  config: Config,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<SessionDriver> {
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
  const manager = new SessionManager({ driver, store: repos.sessions, now, log });

  const ctx: AppContext = { config, database, repos, manager, consent: createConsentVerifier(config), now };

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
