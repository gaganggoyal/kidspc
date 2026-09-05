import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Config } from '../config.js';
import * as schema from './schema.js';

/**
 * The surface both backends share. Naming it explicitly -- rather than
 * inferring it from whichever driver we happened to construct -- is what keeps
 * every repository honest about using portable Postgres, and stops a
 * PGlite-only convenience from reaching production by accident.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
  /** Raw executor, used by the migrator and by health checks. */
  exec: (query: string) => Promise<void>;
}

/**
 * One schema, two runtimes.
 *
 * Development uses PGlite -- genuine Postgres compiled to WebAssembly, running
 * in-process -- so a contributor needs no daemon and no container to get a
 * working stack. Production uses a real server. Because both are Postgres, the
 * SQL, the partial unique index and the jsonb columns behave identically; this
 * is the whole reason not to reach for SQLite in dev.
 */
export async function createDatabase(config: Config): Promise<DatabaseHandle> {
  if (config.DATABASE_URL) {
    const [{ drizzle }, postgresModule] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    const client = postgresModule.default(config.DATABASE_URL, { max: 10, onnotice: () => {} });
    return {
      db: drizzle(client, { schema }) as unknown as Database,
      close: () => client.end({ timeout: 5 }),
      exec: async (query) => {
        await client.unsafe(query);
      },
    };
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);
  // `:memory:` keeps tests hermetic; a directory keeps dev data across restarts.
  const location = config.NODE_ENV === 'test' ? 'memory://' : config.PGLITE_DIR;
  if (location !== 'memory://') await mkdir(location, { recursive: true });
  const client = new PGlite(location);
  await client.waitReady;
  return {
    db: drizzle(client, { schema }) as unknown as Database,
    close: () => client.close(),
    exec: async (query) => {
      await client.exec(query);
    },
  };
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Apply pending migrations in filename order.
 *
 * Hand-written SQL rather than generated diffs: the schema carries constraints
 * (the partial unique index, the CHECKs on age and budget) that express product
 * rules, and those deserve to be reviewed as SQL rather than inferred.
 */
export async function migrate(handle: DatabaseHandle, log: (msg: string) => void = () => {}): Promise<number> {
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (
      (await handle.db.execute(sql`SELECT name FROM _migrations`)) as unknown as {
        rows: Array<{ name: string }>;
      }
    ).rows.map((r) => r.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    log(`applying migration ${file}`);
    await handle.exec(contents);
    await handle.db.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
    count++;
  }
  return count;
}
