/**
 * READ-ONLY parity check for plan access by ticks (Codex-2hxff.91; data design
 * §6.3, §6.5). Makes NO writes: every query runs in ONE `READ ONLY`,
 * `REPEATABLE READ` transaction, so the three checks read one snapshot.
 *
 * Migration 0120 turned the legacy single tier (`content.included_in_tier_id`,
 * "this tier and every tier above it") into the subscribers-only switch
 * (`is_tier_gated`) plus explicit ticks (`content_tier_access`), and backfilled
 * both ONCE, when it ran. The old content-api keeps serving writes between the
 * migration and its own redeploy, and it writes ONLY the legacy column.
 *
 * ── CHECK A · the deploy-window shape (fails the run) ─────────────────────
 *
 * A legacy tier with the switch OFF: the old studio saved "Subscribers" after
 * 0120 ran, so the switch kept its default and the row got no ticks. The new
 * decision keys its tier branch on the switch alone, so the row reads FREE to
 * anyone signed in, and a later publish skips both new publish guards. New
 * code never writes this shape (`syncLegacyIncludedInTierId` NULLs the legacy
 * column whenever the switch is off), so every hit is real. The fix is 0120's
 * own backfill, scoped to the hits: {@link CHECK_A_FIX_STATEMENTS}.
 *
 * ── CHECK B · ticks that differ from 0120's ladder (reported) ─────────────
 *
 * Live gated rows whose ticks are not what 0120 would give their legacy value
 * (every live tier of the content's org at or above it):
 * - `ladder_not_ticked`: the ladder opens a tier the ticks do not. A new-Studio
 *   bundle ("Basic, Premium") and a tier delete with "keep" (the legacy value
 *   is the deleted tier) land here by design.
 * - `ticked_not_ladder`: a tick the ladder does not open. Straight after the
 *   deploy, that is an old-studio edit in the window that narrowed or cleared
 *   the tier, while the ticks still open the old set.
 * A tier reorder can put a row on either side: `reorderTiers` does not re-sync
 * the legacy column. Straight after the deploy, before anyone saves in the new
 * Studio, B should be 0. Once the new Studio is in use, parity no longer holds
 * by design (§6.4 step 5), so B never fails the run.
 *
 * ── CHECK C · what a workers ROLLBACK would open (fails with --pre-rollback) ─
 *
 * The old workers read only the legacy column. Two shapes read looser there:
 * - closed with no legacy value (gated, `included_in_tier_id` NULL) and nothing
 *   else gating it: the old decision falls through to `grant('free')`. A priced
 *   one reads as paid under both, so it is not counted;
 * - every `ladder_not_ticked` row of check B: the old ladder opens tiers the
 *   creator did not tick.
 *
 * Usage. DB_METHOD is REQUIRED, and this script loads NO env file, so the
 * target is whatever the shell says (see {@link targetProblem}):
 *   DB_METHOD=PRODUCTION DATABASE_URL=<url> pnpm --filter @codex/database audit:plan-access
 *   … audit:plan-access --pre-rollback      (before any workers rollback)
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = could not run.
 * Prints counts and content ids only: never a title, a slug or an email.
 */

import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { DatabaseWs } from '../src';

/** The one thing the checks need: `tx.execute`, so a test can pass its own transaction. */
export type ParityReader = Pick<DatabaseWs, 'execute'>;

/** CHECK A. Every row, soft-deleted included, exactly as 0120 step 5. */
const CHECK_A_SQL = `
SELECT c.id::text AS content_id
  FROM content c
 WHERE c.included_in_tier_id IS NOT NULL
   AND NOT c.is_tier_gated
 ORDER BY c.id`;

/**
 * CHECK B, as (side, content id) pairs. The ladder is 0120 step 6 verbatim: no
 * filter on the gating tier's `deleted_at` (the old decision has none), the
 * CONTENT's org, inactive tiers included.
 */
const CHECK_B_SQL = `
WITH gated AS (
  SELECT c.id, c.organization_id, c.included_in_tier_id AS legacy
    FROM content c
   WHERE c.is_tier_gated
     AND c.deleted_at IS NULL
     AND c.organization_id IS NOT NULL
), ladder AS (
  SELECT g.id AS content_id, t.id AS tier_id
    FROM gated g
    JOIN subscription_tiers x ON x.id = g.legacy
    JOIN subscription_tiers t ON t.organization_id = g.organization_id
                             AND t.deleted_at IS NULL
                             AND t.sort_order >= x.sort_order
), ticked AS (
  SELECT cta.content_id, cta.tier_id
    FROM content_tier_access cta
    JOIN gated g ON g.id = cta.content_id
    JOIN subscription_tiers t ON t.id = cta.tier_id AND t.deleted_at IS NULL
)
SELECT 'ladder_not_ticked' AS side, d.content_id::text AS content_id
  FROM (SELECT * FROM ladder EXCEPT SELECT * FROM ticked) d
 GROUP BY d.content_id
UNION ALL
SELECT 'ticked_not_ladder', d.content_id::text
  FROM (SELECT * FROM ticked EXCEPT SELECT * FROM ladder) d
 GROUP BY d.content_id
 ORDER BY 1, 2`;

/**
 * CHECK C's first shape. Mirrors the OLD decision's order: course-only, team
 * and followers each answer before the tier arm, and a price > 0 takes the
 * paid arm, so only a row with none of them reaches `grant('free')`.
 */
const CHECK_C_CLOSED_SQL = `
SELECT c.id::text AS content_id
  FROM content c
 WHERE c.is_tier_gated
   AND c.included_in_tier_id IS NULL
   AND c.deleted_at IS NULL
   AND NOT c.course_only
   AND NOT c.is_team_only
   AND NOT c.is_follower_gated
   AND COALESCE(c.price_cents, 0) <= 0
 ORDER BY c.id`;

/**
 * The fix for check A: 0120's steps 6 and 5, each scoped to `NOT
 * is_tier_gated`, so they touch ONLY the check-A rows. Unscoped, step 6 would
 * add the whole ladder to every new-Studio bundle. Run them in THIS order and
 * in one transaction: the INSERT finds its rows by the switch still being
 * off. Both are idempotent; a second run changes nothing.
 */
export const CHECK_A_FIX_STATEMENTS = [
  `INSERT INTO content_tier_access (content_id, tier_id, organization_id)
SELECT c.id, t.id, c.organization_id
  FROM content c
  JOIN subscription_tiers x ON x.id = c.included_in_tier_id
  JOIN subscription_tiers t ON t.organization_id = c.organization_id
                           AND t.deleted_at IS NULL
                           AND t.sort_order >= x.sort_order
 WHERE c.organization_id IS NOT NULL
   AND NOT c.is_tier_gated
ON CONFLICT DO NOTHING`,
  `UPDATE content SET is_tier_gated = true
 WHERE included_in_tier_id IS NOT NULL
   AND NOT is_tier_gated`,
] as const;

export interface ParityFindings {
  /** CHECK A: legacy tier set, switch off. Reads FREE. */
  switchOffWithLegacyTier: string[];
  /** CHECK B: the ladder opens a tier the ticks do not. */
  ladderNotTicked: string[];
  /** CHECK B: a tick the ladder does not open. */
  tickedNotLadder: string[];
  /** CHECK C: gated, no legacy value, nothing else gating it. */
  closedWithNoLegacyTier: string[];
}

async function contentIds(db: ParityReader, query: string): Promise<string[]> {
  const result = await db.execute(sql.raw(query));
  return (result.rows as Array<{ content_id: string }>).map(
    (r) => r.content_id
  );
}

/** Run the three checks. Call it inside one read-only transaction. */
export async function readParity(db: ParityReader): Promise<ParityFindings> {
  const switchOffWithLegacyTier = await contentIds(db, CHECK_A_SQL);
  const sides = (await db.execute(sql.raw(CHECK_B_SQL))).rows as Array<{
    side: 'ladder_not_ticked' | 'ticked_not_ladder';
    content_id: string;
  }>;
  const closedWithNoLegacyTier = await contentIds(db, CHECK_C_CLOSED_SQL);
  return {
    switchOffWithLegacyTier,
    ladderNotTicked: sides
      .filter((r) => r.side === 'ladder_not_ticked')
      .map((r) => r.content_id),
    tickedNotLadder: sides
      .filter((r) => r.side === 'ticked_not_ladder')
      .map((r) => r.content_id),
    closedWithNoLegacyTier,
  };
}

/** CHECK C: every live row the OLD workers would open wider than now. */
export function looserUnderRollback(findings: ParityFindings): string[] {
  return [
    ...new Set([
      ...findings.closedWithNoLegacyTier,
      ...findings.ladderNotTicked,
    ]),
  ].sort();
}

/** 1 when check A has a row, or check C does and the run is `--pre-rollback`. */
export function exitCodeFor(
  findings: ParityFindings,
  { preRollback }: { preRollback: boolean }
): 0 | 1 {
  if (findings.switchOffWithLegacyTier.length > 0) return 1;
  if (preRollback && looserUnderRollback(findings).length > 0) return 1;
  return 0;
}

export function printReport(
  findings: ParityFindings,
  { preRollback }: { preRollback: boolean },
  print: (line: string) => void
): void {
  const list = (ids: string[]) => {
    for (const id of ids) print(`    ${id}`);
  };

  const a = findings.switchOffWithLegacyTier;
  print(`── CHECK A · legacy tier set, switch off (reads FREE): ${a.length}`);
  list(a);
  if (a.length > 0) {
    print(
      '  FIX: run 0120’s backfill scoped to these rows, in ONE transaction, in this order:'
    );
    print('    BEGIN;');
    for (const statement of CHECK_A_FIX_STATEMENTS) {
      for (const line of `${statement};`.split('\n')) print(`    ${line}`);
    }
    print('    COMMIT;');
    print('  then run this check again: A must be 0.');
  }

  print(
    `\n── CHECK B · ticks differ from 0120’s ladder: ${findings.ladderNotTicked.length} ladder_not_ticked, ${findings.tickedNotLadder.length} ticked_not_ladder`
  );
  if (findings.ladderNotTicked.length > 0) {
    print('  ladder_not_ticked (a bundle, a "keep" delete or a reorder):');
    list(findings.ladderNotTicked);
  }
  if (findings.tickedNotLadder.length > 0) {
    print(
      '  ticked_not_ladder (after the deploy: an old-studio edit in the window, or a reorder):'
    );
    list(findings.tickedNotLadder);
  }

  const looser = looserUnderRollback(findings);
  print(
    `\n── CHECK C · rows a workers rollback would open wider: ${looser.length} (${findings.closedWithNoLegacyTier.length} closed with no legacy tier, read FREE by old code)`
  );
  if (preRollback) list(looser);
  else if (looser.length > 0)
    print('  (ids listed with --pre-rollback; it also makes C fail the run)');
}

/**
 * Refuse to run unless the shell named the database. The client routes on
 * DB_METHOD, not DATABASE_URL: under LOCAL_PROXY it reads
 * DATABASE_URL_LOCAL_PROXY and IGNORES DATABASE_URL, so a production URL beside
 * LOCAL_PROXY would quietly check the local database
 * (`audit-content-access-flags.ts` `assertTargetIsExplicit` has the history).
 * Equal URLs are allowed: that is how the throwaway-database wrapper calls it.
 */
export function targetProblem(env: NodeJS.ProcessEnv): string | null {
  const method = env.DB_METHOD;
  if (!method) {
    return (
      'DB_METHOD is not set, and this script will NOT guess:\n' +
      '  production: DB_METHOD=PRODUCTION DATABASE_URL=<url> pnpm --filter @codex/database audit:plan-access'
    );
  }
  if (method === 'LOCAL_PROXY') {
    if (!env.DATABASE_URL_LOCAL_PROXY) {
      return 'DB_METHOD=LOCAL_PROXY requires DATABASE_URL_LOCAL_PROXY, which is not set.';
    }
    if (env.DATABASE_URL && env.DATABASE_URL !== env.DATABASE_URL_LOCAL_PROXY) {
      return (
        'CONTRADICTION: DATABASE_URL is set but DB_METHOD=LOCAL_PROXY, so the client would\n' +
        'IGNORE it and read DATABASE_URL_LOCAL_PROXY. Meant production? Use DB_METHOD=PRODUCTION.'
      );
    }
    return null;
  }
  return env.DATABASE_URL
    ? null
    : `DB_METHOD=${method} requires DATABASE_URL, which is not set.`;
}

/** Host of the URL the client will use: reported, never the credentials. */
function resolvedHost(env: NodeJS.ProcessEnv): string {
  const url =
    env.DB_METHOD === 'LOCAL_PROXY'
      ? env.DATABASE_URL_LOCAL_PROXY
      : env.DATABASE_URL;
  if (!url) return '(unresolved)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<number> {
  const problem = targetProblem(process.env);
  if (problem) {
    console.error(problem);
    return 2;
  }
  const preRollback = process.argv.includes('--pre-rollback');
  console.log(
    `Plan-access parity: DB_METHOD=${process.env.DB_METHOD} host=${resolvedHost(process.env)}${preRollback ? ' (pre-rollback)' : ''}\n`
  );

  const { dbWs, closeDbPool } = await import('../src');
  try {
    const findings = await dbWs.transaction((tx) => readParity(tx), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    printReport(findings, { preRollback }, (line) => console.log(line));
    return exitCodeFor(findings, { preRollback });
  } finally {
    await closeDbPool();
  }
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error('Parity check failed:', error);
      process.exit(2);
    });
}
