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
 *
 * Not handled: an SQL-standard function body (`BEGIN ATOMIC ... END`, PG14+)
 * is read as statements, so its `END` is flagged. drizzle never writes one;
 * a hand-written file that needs it should dollar-quote the body instead.
 */

import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../src/migrations/', import.meta.url);

/** End of a `--` comment (drizzle's `--> statement-breakpoint` among them). */
function lineCommentEnd(sql: string, start: number): number {
  const end = sql.indexOf('\n', start);
  return end === -1 ? sql.length : end;
}

/** End of a block comment, which Postgres nests. */
function blockCommentEnd(sql: string, start: number): number {
  let depth = 0;
  let i = start;
  do {
    if (sql.startsWith('/*', i)) depth++;
    else if (sql.startsWith('*/', i)) depth--;
    else {
      i++;
      continue;
    }
    i += 2;
  } while (i < sql.length && depth > 0);
  return i;
}

/** End of a `$$ ... $$` or `$tag$ ... $tag$` body opened by `tag`. */
function dollarBodyEnd(sql: string, start: number, tag: string): number {
  const close = sql.indexOf(tag, start + tag.length);
  return close === -1 ? sql.length : close + tag.length;
}

/** Whether the quote at `start` opens an E'string', where `\` escapes. */
function opensEscapeString(sql: string, start: number): boolean {
  const before = sql.slice(Math.max(0, start - 2), start);
  return sql[start] === "'" && /(^|[^A-Za-z0-9_])[Ee]$/.test(before);
}

/** End of a 'string' ('' escapes), E'string' (backslash escapes) or "name". */
function quotedEnd(sql: string, start: number): number {
  const quote = sql[start];
  const escapes = opensEscapeString(sql, start);
  let i = start + 1;
  while (i < sql.length) {
    if (escapes && sql[i] === '\\') {
      i += 2;
    } else if (sql[i] !== quote) {
      i++;
    } else if (sql[i + 1] === quote) {
      i += 2;
    } else {
      return i + 1;
    }
  }
  return i;
}

/** Where the span that isn't code, starting at `i`, ends; -1 when `i` is code. */
function spanEnd(sql: string, i: number): number {
  if (sql.startsWith('--', i)) return lineCommentEnd(sql, i);
  if (sql.startsWith('/*', i)) return blockCommentEnd(sql, i);
  // A `$` inside a name (`a$b$c`) is part of the name, not a body's opening.
  const inName = i > 0 && /[A-Za-z0-9_$]/.test(sql[i - 1] ?? '');
  const dollar = inName
    ? null
    : /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
  if (dollar) return dollarBodyEnd(sql, i, dollar[0]);
  if (sql[i] === "'" || sql[i] === '"') return quotedEnd(sql, i);
  return -1;
}

/** `sql` with every span Postgres doesn't parse as statements blanked out. */
function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const end = spanEnd(sql, i);
    out += end === -1 ? sql[i] : ' ';
    i = end === -1 ? i + 1 : end;
  }
  return out;
}

const TRANSACTION_CONTROL =
  /^(BEGIN|COMMIT|ROLLBACK|END|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;

/**
 * The CONCURRENTLY forms that refuse to run in a transaction block.
 * REFRESH MATERIALIZED VIEW CONCURRENTLY is not one of them.
 */
const CONCURRENTLY_OUTSIDE_TRANSACTION =
  /^(CREATE (UNIQUE )?INDEX|DROP INDEX|REINDEX)\b.*\bCONCURRENTLY\b|\bDETACH PARTITION\b.*\bCONCURRENTLY\b/i;

/** The top-level statements in `sql` that the runner's transaction can't hold. */
function forbiddenStatements(sql: string): string[] {
  return codeOnly(sql)
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter(
      (statement) =>
        TRANSACTION_CONTROL.test(statement) ||
        /^VACUUM\b/i.test(statement) ||
        CONCURRENTLY_OUTSIDE_TRANSACTION.test(statement)
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
    [
      'a unique CONCURRENTLY index',
      'CREATE UNIQUE INDEX CONCURRENTLY "i" ON "t" ("c");',
      'CREATE UNIQUE INDEX CONCURRENTLY',
    ],
    ['a CONCURRENTLY drop', 'DROP INDEX CONCURRENTLY "i";', 'DROP INDEX'],
    ['a CONCURRENTLY reindex', 'REINDEX INDEX CONCURRENTLY "i";', 'REINDEX'],
    [
      'a CONCURRENTLY detach',
      'ALTER TABLE "t" DETACH PARTITION "p" CONCURRENTLY;',
      'DETACH PARTITION',
    ],
    [
      'a COMMIT after a name holding `$`',
      'ALTER TABLE t ADD a$b$c int;\nCOMMIT;\nSELECT 1 AS x$b$;',
      'COMMIT',
    ],
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
    ['a CONCURRENTLY refresh', 'REFRESH MATERIALIZED VIEW CONCURRENTLY "mv";'],
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
