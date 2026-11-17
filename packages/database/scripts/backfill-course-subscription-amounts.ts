/**
 * Fill `course_subscriptions.amount_cents` for subscriptions made before it
 * was recorded (Codex-2hxff.52; data design §6.3, Migrate).
 *
 * The course webhooks write it from the item's price on created, updated and
 * paid. A subscription none of those has touched since the deploy has none,
 * and Account › Subscriptions then shows no price (never a guess from the
 * plan). This reads each such live subscription from Stripe once and writes
 * its item's `unit_amount`.
 *
 * DRY RUN (the default; writes nothing):
 *
 *   pnpm --filter @codex/database exec tsx scripts/backfill-course-subscription-amounts.ts --env production --test-keys
 *
 *   One line per row: our row id (never an email), its Stripe subscription,
 *   the amount Stripe has, and the action. Then the counts.
 *
 * APPLY:
 *
 *   … --apply (and, for production, --live, or --test-keys while it runs on
 *   test keys, as backfill-payout-schedule.ts)
 *
 * Bounded, resumable, idempotent:
 *   - At most `--limit` rows a run (default 200, at most 1000), oldest id
 *     first. When the limit is reached it prints the `--after <id>` to carry
 *     on from.
 *   - Only rows still without an amount are read, and the write is guarded
 *     the same way (`WHERE amount_cents IS NULL`): a webhook that wrote the
 *     amount meanwhile wins, and a re-run is a no-op.
 *   - Only live rows: not ended, not a duplicate. Ended ones are not listed.
 *   - Reads Stripe only; never writes to it.
 *
 * Safety: the key must match --env (assertKeyMatchesEnv, shared with
 * backfill-payout-schedule.ts). A subscription tagged for another
 * environment is skipped (production and dev share a sandbox). Per-row
 * failures are printed and skipped.
 *
 * Run in production only with the owner's OK, after the deploy.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isForeignStripeEnvironment } from '@codex/constants';
import type Stripe from 'stripe';
// The platform's Stripe client, with its pinned API version, by relative path:
// @codex/purchase depends on @codex/database, so a package dependency would be
// circular.
import { createStripeClient } from '../../purchase/src/stripe-client';
import { assertKeyMatchesEnv, keyMode } from './backfill-payout-schedule';

/** Each Stripe call gives up after 20 s. */
const STRIPE_REQUEST = {
  timeout: 20_000,
  maxNetworkRetries: 2,
} as const satisfies Stripe.RequestOptions;

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// ─── Arguments ─────────────────────────────────────────────────────────────

export interface AmountBackfillArgs {
  env: string;
  apply: boolean;
  live: boolean;
  testKeys: boolean;
  limit: number;
  /** Carry on after this row id (the last run's last one). */
  after: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: readonly string[]): AmountBackfillArgs {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    const next = at === -1 ? undefined : argv[at + 1];
    return next && !next.startsWith('--') ? next : null;
  };
  const env = value('--env');
  if (!env) {
    throw new Error('--env is required (production, or the test environment)');
  }
  const limitText = value('--limit');
  const limit = limitText === null ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }
  const after = value('--after');
  if (after !== null && !UUID.test(after)) {
    throw new Error('--after must be a course subscription id (a uuid)');
  }
  return {
    env,
    apply: argv.includes('--apply'),
    live: argv.includes('--live'),
    testKeys: argv.includes('--test-keys'),
    limit,
    after,
  };
}

// ─── The run ───────────────────────────────────────────────────────────────

/** A live course subscription with no amount recorded. */
export interface MissingAmountRow {
  id: string;
  stripeSubscriptionId: string;
}

type AmountAction =
  | 'write'
  | 'written'
  | 'already set'
  | 'skip: no unit amount'
  | 'skip: env tag differs'
  | `skip: Stripe error ${string}`;

export interface AmountBackfillDeps {
  stripe: Pick<Stripe, 'subscriptions'>;
  /** Up to `limit` rows still without an amount, by id, after `after`. */
  rowsMissingAmount(
    after: string | null,
    limit: number
  ): Promise<MissingAmountRow[]>;
  /** Write it unless the row has one by now; true if this wrote it. */
  writeAmount(id: string, amountCents: number): Promise<boolean>;
  print(line: string): void;
}

export interface AmountBackfillResult {
  read: number;
  counts: Record<string, number>;
  /** The id to pass as `--after` next, when the limit was reached. */
  next: string | null;
}

function errorCode(error: unknown): string {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

export async function run(
  deps: AmountBackfillDeps,
  args: Pick<AmountBackfillArgs, 'env' | 'apply' | 'limit' | 'after'>
): Promise<AmountBackfillResult> {
  const rows = await deps.rowsMissingAmount(args.after, args.limit);
  const counts: Record<string, number> = {};
  deps.print('course subscription id | stripe subscription | amount | action');
  for (const row of rows) {
    let action: AmountAction;
    let amount: number | null = null;
    try {
      const live = await deps.stripe.subscriptions.retrieve(
        row.stripeSubscriptionId,
        {},
        STRIPE_REQUEST
      );
      amount = live.items.data[0]?.price?.unit_amount ?? null;
      if (isForeignStripeEnvironment(live.metadata, args.env)) {
        action = 'skip: env tag differs';
      } else if (amount === null) {
        action = 'skip: no unit amount';
      } else if (!args.apply) {
        action = 'write';
      } else {
        action = (await deps.writeAmount(row.id, amount))
          ? 'written'
          : 'already set';
      }
    } catch (error) {
      action = `skip: Stripe error ${errorCode(error)}`;
    }
    counts[action] = (counts[action] ?? 0) + 1;
    deps.print(
      [
        row.id,
        row.stripeSubscriptionId,
        amount === null ? '?' : `£${(amount / 100).toFixed(2)}`,
        action,
      ].join(' | ')
    );
  }
  for (const [action, count] of Object.entries(counts)) {
    deps.print(`${action}: ${count}`);
  }
  const last = rows.at(-1);
  const next = rows.length === args.limit && last ? last.id : null;
  if (next) deps.print(`limit reached; carry on with --after ${next}`);
  return { read: rows.length, counts, next };
}

// ─── The database ──────────────────────────────────────────────────────────

/**
 * The database side of the run, on any of the package's clients. Live rows
 * only (not ended, not a duplicate), still without an amount, oldest id
 * first; the write keeps an amount a webhook wrote meanwhile.
 */
export async function databaseDeps(
  db: typeof import('../src').dbHttp
): Promise<Pick<AmountBackfillDeps, 'rowsMissingAmount' | 'writeAmount'>> {
  const { courseSubscriptions } = await import('../src/schema');
  const { and, asc, eq, gt, isNull } = await import('drizzle-orm');
  return {
    async rowsMissingAmount(after, limit) {
      const filters = [
        isNull(courseSubscriptions.amountCents),
        isNull(courseSubscriptions.endedAt),
        isNull(courseSubscriptions.duplicateOfCourseSubscriptionId),
      ];
      if (after !== null) filters.push(gt(courseSubscriptions.id, after));
      return db
        .select({
          id: courseSubscriptions.id,
          stripeSubscriptionId: courseSubscriptions.stripeSubscriptionId,
        })
        .from(courseSubscriptions)
        .where(and(...filters))
        .orderBy(asc(courseSubscriptions.id))
        .limit(limit);
    },
    async writeAmount(id, amountCents) {
      const written = await db
        .update(courseSubscriptions)
        .set({ amountCents, updatedAt: new Date() })
        .where(
          and(
            eq(courseSubscriptions.id, id),
            isNull(courseSubscriptions.amountCents)
          )
        )
        .returning({ id: courseSubscriptions.id });
      return written.length > 0;
    },
  };
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.env !== 'production') {
    // Local test-mode runs read the dev database and key, as the seeds do.
    // A production run takes them from the shell, never from a file.
    const { config } = await import('dotenv');
    const here = path.dirname(fileURLToPath(import.meta.url));
    config({ path: path.resolve(here, '../../../.env.dev') });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  // Reads Stripe only, but the key still has to be this environment's.
  assertKeyMatchesEnv(key, { ...args, confirm: null });
  const stripe = createStripeClient(key as string);
  const { dbHttp } = await import('../src');

  console.log(
    `\n  Course subscription amount backfill: ${args.apply ? 'APPLY' : 'DRY RUN (no writes)'}, env ${args.env}, ${keyMode(key)} key, at most ${args.limit} rows${args.after ? ` after ${args.after}` : ''}\n`
  );
  await run(
    {
      stripe,
      ...(await databaseDeps(dbHttp)),
      print: (line) => console.log(line),
    },
    args
  );
  if (!args.apply) {
    console.log('\n  Nothing was changed. To write: --apply.');
  }
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(
        `Backfill aborted: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
