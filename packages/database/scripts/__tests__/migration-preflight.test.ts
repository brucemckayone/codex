/**
 * The migration preflight gate (Codex-2hxff.11): a check runs only for a
 * migration about to be applied, only when its table and the columns it
 * reads exist, and any row it returns fails the run before anything is
 * applied.
 *
 * The duplicate-slice SQL itself was calibrated by hand (2026-10-18) on a
 * TEMP copy of payouts with no unique indexes: it returned the duplicated
 * org slice (two payees) and the duplicated creator slice, and not two
 * creators sharing one charge.
 */

import { readdir, readFile } from 'node:fs/promises';
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

function client(opts: {
  tableExists: boolean;
  rows: unknown[];
  /** The columns the pg_attribute probe finds. */
  columnsPresent?: string[];
}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT to_regclass'))
        return { rows: [{ present: opts.tableExists ? 'example' : null }] };
      if (sql.includes('FROM pg_attribute'))
        return {
          rows: (opts.columnsPresent ?? []).map((attname) => ({ attname })),
        };
      return { rows: opts.rows };
    }),
  };
}

const MIGRATIONS = new URL('../../src/migrations/', import.meta.url);

/** Every migration's SQL with its `--` comments taken out, by file name. */
async function migrationStatements(): Promise<Array<[string, string]>> {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql'));
  return Promise.all(
    files.map(
      async (f): Promise<[string, string]> => [
        f,
        (await readFile(new URL(f, MIGRATIONS), 'utf8')).replace(
          /--[^\n]*/g,
          ''
        ),
      ]
    )
  );
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

  // The checks run before the run's FIRST pending migration: one that also
  // applies the migration adding the columns finds none yet (Codex-h301h).
  it('skips when a column its query reads is not there yet, and says so', async () => {
    const db = client({
      tableExists: true,
      rows: [{ id: 'a' }],
      columnsPresent: ['added_at'],
    });
    const log = vi.fn();

    expect(
      await runMigrationPreflights(
        db,
        ['0200_example.sql'],
        [{ ...check, columns: ['added_at', 'other_at'] }],
        log
      )
    ).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '  ⏭ Preflight skipped 0200_example.sql: columns not there yet (other_at)'
    );
  });

  it('runs the check once every column it reads is there', async () => {
    const db = client({
      tableExists: true,
      rows: [{ id: 'a' }],
      columnsPresent: ['added_at', 'other_at'],
    });
    const log = vi.fn();

    const failures = await runMigrationPreflights(
      db,
      ['0200_example.sql'],
      [{ ...check, columns: ['added_at', 'other_at'] }],
      log
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('1 found');
    expect(log).not.toHaveBeenCalled();
  });

  // The probe binds the table as to_regclass does and asks pg_attribute, which
  // a role's column privileges never hide (information_schema.columns does).
  it('probes pg_attribute for the columns, by the table to_regclass found', async () => {
    const db = client({
      tableExists: true,
      rows: [],
      columnsPresent: ['added_at', 'other_at'],
    });

    await runMigrationPreflights(
      db,
      ['0200_example.sql'],
      [{ ...check, columns: ['added_at', 'other_at'] }],
      vi.fn()
    );

    expect(db.query.mock.calls[1]?.[0]).toContain('FROM pg_attribute');
    expect(db.query.mock.calls[1]?.[0]).toContain('NOT attisdropped');
    expect(db.query.mock.calls[1]?.[1]).toEqual([
      'public.example',
      ['added_at', 'other_at'],
    ]);
  });

  it('guards the payout uniqueness migration with the release-checklist query', () => {
    const guard = MIGRATION_PREFLIGHTS.find((p) => p.table === 'payouts');
    expect(guard?.sql).toContain('HAVING count(*) > 1');
  });

  // Calibrated by hand on throwaway DBs (Codex-h301h): from 0125, production's
  // state, the run skipped it and applied 0126-0128 (this file was 0128 then,
  // and is 0129 since studio E2's 0128 landed first); at 0127, one dispute
  // with a told buyer and no late win made the migrate refuse, "1 found".
  it('guards the told-buyer CHECK with the rows that would break it', () => {
    const guard = MIGRATION_PREFLIGHTS.find((p) => p.table === 'disputes');
    expect(guard?.sql).toContain(
      'buyer_told_at IS NOT NULL AND late_won_at IS NULL'
    );
    expect(guard?.columns).toEqual(['buyer_told_at', 'late_won_at']);
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

  // Codex-2hxff.36 is two releases: the workers still running while a deploy
  // migrates name the pin column in every org query. Regenerating 0129 writes
  // its drop back. Step 2's PR, which drops it, flips this test.
  it('drops no payee pin column before step 2', async () => {
    const dropping = (await migrationStatements())
      .filter(([, sql]) =>
        /DROP COLUMN (IF EXISTS )?"primary_connect_account_user_id"/i.test(sql)
      )
      .map(([file]) => file);
    expect(dropping).toEqual([]);
  });

  // 0129's second hand edit: the pin's foreign key drop locks organizations
  // AND users, so it runs last and holds them only for the commit.
  it("drops the pin's foreign key as its file's last statement", async () => {
    const fk =
      'DROP CONSTRAINT "organizations_primary_connect_account_user_id_users_id_fk"';
    const [found] = (await migrationStatements()).filter(([, sql]) =>
      sql.includes(fk)
    );
    const statements = (found?.[1] ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.at(-1)).toContain(fk);
  });
});
