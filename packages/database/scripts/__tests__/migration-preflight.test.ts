/**
 * The migration preflight gate (Codex-2hxff.11): a check runs only for a
 * migration about to be applied, only when its table exists, and any row it
 * returns fails the run before anything is applied.
 *
 * The duplicate-slice SQL itself was calibrated by hand (2026-10-18) on a
 * TEMP copy of payouts with no unique indexes: it returned the duplicated
 * org slice (two payees) and the duplicated creator slice, and not two
 * creators sharing one charge.
 */

import { readdir } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  MIGRATION_PREFLIGHTS,
  type MigrationPreflight,
  runMigrationPreflights,
} from '../migration-preflight';

const check: MigrationPreflight = {
  migration: '0200_example.sql',
  description: 'duplicate rows',
  sql: 'SELECT 1 FROM example',
  table: 'example',
};

function client(opts: { tableExists: boolean; rows: unknown[] }) {
  return {
    query: vi.fn(async (sql: string) =>
      sql.startsWith('SELECT to_regclass')
        ? { rows: [{ present: opts.tableExists ? 'example' : null }] }
        : { rows: opts.rows }
    ),
  };
}

describe('runMigrationPreflights', () => {
  it('fails a pending migration whose check returns rows', async () => {
    const db = client({ tableExists: true, rows: [{ id: 'a' }, { id: 'b' }] });

    const failures = await runMigrationPreflights(
      db,
      ['0200_example.sql'],
      [check]
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('0200_example.sql');
    expect(failures[0]).toContain('2 found');
  });

  it('passes a pending migration whose check returns nothing', async () => {
    const db = client({ tableExists: true, rows: [] });

    expect(
      await runMigrationPreflights(db, ['0200_example.sql'], [check])
    ).toEqual([]);
  });

  it('never runs the check of a migration already applied', async () => {
    const db = client({ tableExists: true, rows: [{ id: 'a' }] });

    expect(
      await runMigrationPreflights(db, ['0201_other.sql'], [check])
    ).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('skips the check on a fresh database, before its table exists', async () => {
    const db = client({ tableExists: false, rows: [{ id: 'a' }] });

    expect(
      await runMigrationPreflights(db, ['0200_example.sql'], [check])
    ).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('guards the payout uniqueness migration with the release-checklist query', () => {
    const guard = MIGRATION_PREFLIGHTS.find((p) => p.table === 'payouts');
    expect(guard?.sql).toContain('HAVING count(*) > 1');
  });

  // A renamed or regenerated migration would silently switch its guard off.
  it('names migrations that exist', async () => {
    const files = await readdir(
      new URL('../../src/migrations', import.meta.url)
    );
    for (const preflight of MIGRATION_PREFLIGHTS) {
      expect(files).toContain(preflight.migration);
    }
  });
});
