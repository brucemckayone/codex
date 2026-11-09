/**
 * The rule `migrate-direct.ts` states but cannot check while it runs: no
 * migration file may control its own transaction (Codex-vliwn). The runner
 * applies each file inside BEGIN ... COMMIT together with the row recording
 * it. A COMMIT in the file ends that transaction early, without an error, so
 * the file and its record no longer commit together; CONCURRENTLY and VACUUM
 * refuse to run inside a transaction at all.
 *
 * Only code counts: dollar-quoted bodies (the plpgsql BEGIN/END of 0004, 0113
 * and 0120, the `$tpl$` email copy), comments, string literals and quoted
 * identifiers are blanked first.
 */

import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../src/migrations/', import.meta.url);

/** `sql` with every span Postgres doesn't parse as statements blanked out. */
function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    // `--` comments, drizzle's `--> statement-breakpoint` among them.
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }
    // Block comments, which Postgres nests.
    if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) depth++;
        else if (sql.startsWith('*/', i)) depth--;
        else {
          i++;
          continue;
        }
        i += 2;
      }
      out += ' ';
      continue;
    }
    // `$$ ... $$` and `$tag$ ... $tag$` bodies.
    const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (dollar) {
      const close = sql.indexOf(dollar[0], i + dollar[0].length);
      i = close === -1 ? sql.length : close + dollar[0].length;
      out += ' ';
      continue;
    }
    // 'strings' ('' escapes), E'strings' (backslash escapes), "identifiers".
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      const escapes =
        quote === "'" &&
        /[Ee]/.test(sql[i - 1] ?? '') &&
        !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') i += 2;
        else if (sql[i] === quote && sql[i + 1] === quote) i += 2;
        else if (sql[i++] === quote) break;
      }
      out += ' ';
      continue;
    }
    out += quote;
    i++;
  }
  return out;
}

const TRANSACTION_CONTROL =
  /^(BEGIN|COMMIT|ROLLBACK|END|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;

/** The top-level statements in `sql` that the runner's transaction can't hold. */
function forbiddenStatements(sql: string): string[] {
  return codeOnly(sql)
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter(
      (statement) =>
        TRANSACTION_CONTROL.test(statement) ||
        /^VACUUM\b/i.test(statement) ||
        /\bCONCURRENTLY\b/i.test(statement)
    );
}

describe('the migration-file scanner', () => {
  it.each([
    ['a COMMIT', 'ALTER TABLE t ADD c int;\nCOMMIT;', 'COMMIT'],
    ['a BEGIN', 'BEGIN;\nALTER TABLE t ADD c int;', 'BEGIN'],
    ['a ROLLBACK', 'ALTER TABLE t ADD c int;\nROLLBACK;', 'ROLLBACK'],
    ['an END', 'ALTER TABLE t ADD c int;\nEND;', 'END'],
    [
      'CONCURRENTLY',
      'CREATE INDEX CONCURRENTLY "i" ON "t" ("c");',
      'CREATE INDEX CONCURRENTLY',
    ],
    ['a VACUUM', 'VACUUM "t";', 'VACUUM'],
  ])('flags %s at the top level', (_name, sql, statement) => {
    expect(forbiddenStatements(sql)).toEqual([
      expect.stringContaining(statement),
    ]);
  });

  it.each([
    [
      'a plpgsql body',
      'CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;',
    ],
    ['a tagged body', "SELECT $tpl$COMMIT; BEGIN;$tpl$, 'x';"],
    ['CASE ... END', 'UPDATE t SET a = CASE\n  WHEN b THEN 1\n  ELSE 2\nEND;'],
    ['a string', "UPDATE t SET body = 'Done; COMMIT; then BEGIN again';"],
    ['an E string', "UPDATE t SET body = E'it\\'s; COMMIT;\\n';"],
    ['a comment', '-- COMMIT; then VACUUM;\nALTER TABLE t ADD c int;'],
    ['a block comment', '/* COMMIT; /* nested */ END; */ SELECT 1;'],
    ['a quoted name', 'ALTER TABLE "t" ADD "concurrently" int;'],
  ])('leaves %s alone', (_name, sql) => {
    expect(forbiddenStatements(sql)).toEqual([]);
  });
});

describe('every migration file', () => {
  it('holds no BEGIN, COMMIT, ROLLBACK, END, CONCURRENTLY or VACUUM of its own', async () => {
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql'));
    const found: Record<string, string[]> = {};
    for (const file of files) {
      const statements = forbiddenStatements(
        await readFile(new URL(file, MIGRATIONS), 'utf8')
      );
      if (statements.length > 0) found[file] = statements;
    }

    expect(files.length).toBeGreaterThanOrEqual(129);
    expect(found).toEqual({});
  });

  // The files whose plpgsql bodies hold BEGIN and END: proof the scanner
  // reads past a body, not that the file has no BEGIN.
  it.each([
    '0004_add_org_deletion_trigger.sql',
    '0113_refunds_charge_index_and_connect_history.sql',
    '0120_plan_access_ticks.sql',
  ])('%s: its plpgsql BEGIN/END are not counted', async (file) => {
    const sql = await readFile(new URL(file, MIGRATIONS), 'utf8');

    expect(sql).toMatch(/^\s*BEGIN\s*$/m);
    expect(sql).toMatch(/^\s*END;/m);
    expect(forbiddenStatements(sql)).toEqual([]);
  });
});
