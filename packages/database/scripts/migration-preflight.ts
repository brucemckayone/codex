/**
 * Read-only checks a migration must pass before it is applied.
 *
 * `migrate-direct.ts` runs them before it applies ANY pending migration, so
 * a failing check leaves the database exactly as it was. Without them a
 * migration that cannot apply to live data fails mid-run: the earlier
 * migrations of the run have committed, and the deploy stops with the old
 * workers running against the new schema.
 *
 * A check is the release-checklist query that decides whether its
 * migration is safe (docs/payments/release-checklist.md). Any row it
 * returns is a problem a person must resolve first; the check never fixes
 * data itself, because which row to keep is a money decision.
 */

export interface MigrationPreflight {
  /** The migration file the check guards, as the journal names it. */
  migration: string;
  /** What a returned row means. */
  description: string;
  /** A read-only query: it must return no rows. */
  sql: string;
  /**
   * The table the query reads. On a fresh database it does not exist yet —
   * an earlier migration of the same run creates it — and there is no data
   * to violate anything, so the check is skipped.
   */
  table: string;
  /**
   * The columns of `table` the query reads, when an earlier migration adds
   * them. The checks see the database as it was before the run's FIRST
   * pending migration, so a run that also applies that migration has no such
   * column yet, and no row can break the guarded constraint: the check is
   * skipped unless every one exists.
   */
  columns?: string[];
}

/**
 * 0099 makes every payout slice unique per charge (Codex-2hxff.11). A
 * duplicate already in the table — the bug 0099 fixes — makes its CREATE
 * UNIQUE INDEX fail. Release checklist R5.
 */
const DUPLICATE_PAYOUT_SLICES = `
SELECT stripe_charge_id, payout_type, count(*) AS n,
       array_agg(user_id ORDER BY created_at) AS payees,
       array_agg(status ORDER BY created_at) AS statuses,
       array_agg(id ORDER BY created_at) AS ids
FROM payouts
WHERE stripe_charge_id IS NOT NULL
  AND payout_type IN ('organization_fee', 'creator_payout_to_owner')
GROUP BY stripe_charge_id, payout_type
HAVING count(*) > 1
UNION ALL
SELECT stripe_charge_id, payout_type, count(*),
       array_agg(user_id ORDER BY created_at),
       array_agg(status ORDER BY created_at),
       array_agg(id ORDER BY created_at)
FROM payouts
WHERE stripe_charge_id IS NOT NULL AND payout_type = 'creator_payout'
GROUP BY stripe_charge_id, payout_type, user_id
HAVING count(*) > 1`;

/**
 * 0128 adds `check_disputes_buyer_told` (Codex-h301h): only a late win has a
 * told buyer. A dispute that breaks it makes the ADD CONSTRAINT fail. None
 * should exist: `claimLateWinBuyerEmail`, the column's only writer, requires
 * a late win, and nothing clears `late_won_at`. Both columns arrive with
 * 0126, so a run from before 0126 skips it.
 */
const BUYER_TOLD_WITHOUT_LATE_WIN = `
SELECT id, stripe_dispute_id, status, buyer_told_at
FROM disputes
WHERE buyer_told_at IS NOT NULL AND late_won_at IS NULL`;

export const MIGRATION_PREFLIGHTS: ReadonlyArray<MigrationPreflight> = [
  {
    migration: '0099_wonderful_rage.sql',
    description:
      'duplicate payout slices: decide each one before deploying (release checklist R5)',
    sql: DUPLICATE_PAYOUT_SLICES,
    table: 'payouts',
  },
  {
    migration: '0128_email_log_index_and_buyer_told_check.sql',
    description:
      'disputes with a told buyer but no late win: resolve each one before deploying',
    sql: BUYER_TOLD_WITHOUT_LATE_WIN,
    table: 'disputes',
    columns: ['buyer_told_at', 'late_won_at'],
  },
];

interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Run the checks for the migrations about to be applied. Returns one line
 * per failed check; empty means every check passed.
 */
export async function runMigrationPreflights(
  client: QueryClient,
  pendingMigrations: ReadonlyArray<string>,
  preflights: ReadonlyArray<MigrationPreflight> = MIGRATION_PREFLIGHTS
): Promise<string[]> {
  const failures: string[] = [];
  for (const check of preflights) {
    if (!pendingMigrations.includes(check.migration)) continue;
    const { rows: tables } = await client.query(
      'SELECT to_regclass($1) AS present',
      [`public.${check.table}`]
    );
    if ((tables[0] as { present: unknown } | undefined)?.present == null) {
      continue;
    }
    if (check.columns && check.columns.length > 0) {
      const { rows: present } = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
            AND column_name = ANY($2)`,
        [check.table, check.columns]
      );
      if ((present[0] as { n: number } | undefined)?.n !== check.columns.length)
        continue;
    }
    const { rows } = await client.query(check.sql);
    if (rows.length > 0) {
      failures.push(
        `${check.migration}: ${check.description}. ${rows.length} found: ${JSON.stringify(rows.slice(0, 5))}`
      );
    }
  }
  return failures;
}
