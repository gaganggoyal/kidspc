import { describe, expect, it } from 'vitest';
import { rowsOf } from './client.js';

/**
 * The migrator is the only code here that reads a raw driver result, and it is
 * therefore the only code exposed to the fact that Drizzle's two drivers return
 * different shapes. Every other query goes through the query builder, which
 * normalises them.
 *
 * These cases are written from the drivers' actual return values rather than
 * from their types, because the types were what let the bug through: an
 * `as unknown as { rows }` cast type-checked, passed the whole suite on PGlite,
 * and threw on the first query against a real Postgres server in production.
 */
describe('rowsOf', () => {
  it('reads the PGlite driver shape, which wraps rows in an object', () => {
    expect(rowsOf<{ name: string }>({ rows: [{ name: '001_init.sql' }] })).toEqual([
      { name: '001_init.sql' },
    ]);
  });

  it('reads the postgres-js driver shape, which is the row array itself', () => {
    expect(rowsOf<{ name: string }>([{ name: '001_init.sql' }])).toEqual([
      { name: '001_init.sql' },
    ]);
  });

  it('treats an empty result from either driver as no rows', () => {
    expect(rowsOf({ rows: [] })).toEqual([]);
    expect(rowsOf([])).toEqual([]);
  });

  it('returns no rows rather than throwing on a shape it does not recognise', () => {
    // A future driver, or a command with no result set. The migrations are not
    // idempotent, so this is not "recover and carry on": the migrator concludes
    // nothing is applied, re-runs 0001, and Postgres refuses with "relation
    // already exists". That is the point -- a clear SQL error naming the
    // problem, rather than a TypeError inside a `.map` that names only the
    // symptom.
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf({})).toEqual([]);
  });
});
