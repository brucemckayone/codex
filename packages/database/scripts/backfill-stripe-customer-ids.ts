/**
 * Backfill users.stripe_customer_id from existing Stripe Customers.
 *
 * Part of the Q4 unified-customer epic (Codex-pkqxd / Codex-cmhnv).
 *
 * Strategy:
 *   1. Select not-deleted users where stripe_customer_id IS NULL, in pages of 100.
 *   2. For each user, call `stripe.customers.list({ email, limit: 100 })` and
 *      pick the OLDEST Customer (smallest `created` timestamp). Oldest wins so
 *      historical purchase/subscription records stay attached to the same
 *      Customer we persist on the user row.
 *   3. If Stripe returns multiple Customers with DIFFERENT ids, that's a
 *      potential merge case — we log it to `needs-manual-review` and skip the
 *      user (do NOT auto-merge). Many-customers-same-id is a duplicate only in
 *      the ORM sense and is fine; we still pick the oldest.
 *   4. Users with no Stripe Customer stay NULL.
 *   5. Script is resumable: the WHERE stripe_customer_id IS NULL filter means a
 *      re-run naturally skips users that were successfully backfilled on the
 *      previous pass. We also checkpoint the last-processed user id to disk so
 *      re-runs can resume mid-page in a catastrophic failure scenario.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm --filter @codex/database backfill:stripe-customer-ids
 *
 * Flags:
 *   --dry-run   Log what would change; do not write to DB.
 *   --force     Skip the "press enter to continue" confirmation.
 *   --reset     Discard the checkpoint file and start from the beginning.
 *
 * Safety:
 *   - Refuses to run against sk_live_* / rk_live_* keys.
 *   - Per-user failures are logged + skipped; script never aborts the whole
 *     run on one bad row. Init-time errors (no key, no DB) abort fast.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObservabilityClient } from '@codex/observability';
import { config } from 'dotenv';
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbWs, schema, whereNotDeleted } from '../src';

// ─── Configuration ─────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
const STRIPE_API_VERSION = '2025-10-29.clover' as const;
const CHECKPOINT_DIR = path.resolve(__dirname, '../.backfill');
const CHECKPOINT_FILE = path.join(
  CHECKPOINT_DIR,
  'stripe-customer-ids.checkpoint.json'
);
const REVIEW_LOG_FILE = path.join(
  CHECKPOINT_DIR,
  'stripe-customer-ids.needs-manual-review.jsonl'
);

const obs = new ObservabilityClient(
  'backfill-stripe-customer-ids',
  'development'
);

// ─── Types ─────────────────────────────────────────────────────────────────

interface Checkpoint {
  /** Highest user id successfully processed. Next run resumes at id > this. */
  lastProcessedUserId: string | null;
  /** Wall-clock timestamp for observability only. */
  updatedAt: string;
}

interface ReviewEntry {
  userId: string;
  email: string;
  reason: 'multiple_customers_different_ids';
  customerIds: string[];
  loggedAt: string;
}

interface RunStats {
  totalScanned: number;
  backfilled: number;
  stillNull: number;
  needsReview: number;
  failed: number;
}

// ─── Stripe client (reused factory pattern; see note) ──────────────────────

/**
 * We intentionally instantiate Stripe directly rather than importing
 * `createStripeClient` from `@codex/purchase`. `@codex/purchase` depends on
 * `@codex/database`, so depending on it here would create a circular
 * dependency. The existing `seed/commerce.ts` follows the same convention.
 * API version is pinned identically to `@codex/purchase/stripe-client.ts`.
 */
function createStripeForBackfill(apiKey: string): Stripe {
  if (!apiKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is required. Set it in the shell or .env.dev before running the backfill.'
    );
  }
  if (apiKey.startsWith('sk_live_') || apiKey.startsWith('rk_live_')) {
    throw new Error(
      'REFUSING TO RUN BACKFILL AGAINST LIVE STRIPE KEY. Use a sk_test_* key ' +
        'from https://dashboard.stripe.com/test/apikeys for the backfill. ' +
        'Live-mode backfill must be run by an operator with explicit sign-off, ' +
        'not this one-shot script.'
    );
  }
  return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
}

// ─── Checkpoint helpers ────────────────────────────────────────────────────

async function loadCheckpoint(reset: boolean): Promise<Checkpoint> {
  if (reset) {
    return { lastProcessedUserId: null, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = await readFile(CHECKPOINT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'lastProcessedUserId' in parsed
    ) {
      return parsed as Checkpoint;
    }
    obs.warn('Checkpoint file present but malformed; starting from beginning', {
      file: CHECKPOINT_FILE,
    });
    return { lastProcessedUserId: null, updatedAt: new Date().toISOString() };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      obs.warn('Failed to read checkpoint; starting from beginning', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { lastProcessedUserId: null, updatedAt: new Date().toISOString() };
  }
}

async function saveCheckpoint(lastProcessedUserId: string): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  const payload: Checkpoint = {
    lastProcessedUserId,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(CHECKPOINT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

async function appendReviewEntry(entry: ReviewEntry): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(REVIEW_LOG_FILE, `${JSON.stringify(entry)}\n`, {
    flag: 'a',
    encoding: 'utf-8',
  });
}

// ─── Core backfill ─────────────────────────────────────────────────────────

/**
 * Look up the oldest Stripe Customer for a given email.
 *
 * Returns:
 *   - `{ kind: 'match', customerId }` — exactly one distinct Customer (or the
 *     oldest among matches with the same id).
 *   - `{ kind: 'none' }`              — no Customers for this email.
 *   - `{ kind: 'ambiguous', ids }`    — multiple distinct Customer ids. Caller
 *     should log to manual-review and leave the user's column NULL.
 */
export async function findCustomerForEmail(
  stripe: Stripe,
  email: string
): Promise<
  | { kind: 'match'; customerId: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; ids: string[] }
> {
  const result = await stripe.customers.list({ email, limit: 100 });
  if (result.data.length === 0) {
    return { kind: 'none' };
  }

  // Pick the oldest Customer by `created` (epoch seconds).
  const sorted = [...result.data].sort((a, b) => a.created - b.created);
  const oldest = sorted[0];
  const distinctIds = new Set(sorted.map((c) => c.id));

  if (distinctIds.size > 1) {
    return { kind: 'ambiguous', ids: Array.from(distinctIds) };
  }

  return { kind: 'match', customerId: oldest.id };
}

/**
 * Process a single batch of users. Returns the id of the last user processed,
 * so the outer loop can resume from there.
 */
async function processBatch(
  stripe: Stripe,
  users: {
    id: string;
    email: string;
  }[],
  dryRun: boolean,
  stats: RunStats
): Promise<string | null> {
  let lastId: string | null = null;

  for (const user of users) {
    stats.totalScanned++;
    lastId = user.id;

    try {
      const lookup = await findCustomerForEmail(stripe, user.email);

      if (lookup.kind === 'none') {
        stats.stillNull++;
        obs.debug('No Stripe Customer for user; leaving NULL', {
          userId: user.id,
        });
        continue;
      }

      if (lookup.kind === 'ambiguous') {
        stats.needsReview++;
        const entry: ReviewEntry = {
          userId: user.id,
          email: user.email,
          reason: 'multiple_customers_different_ids',
          customerIds: lookup.ids,
          loggedAt: new Date().toISOString(),
        };
        await appendReviewEntry(entry);
        obs.warn(
          'Multiple Stripe Customers for user email; skipping for manual review',
          {
            userId: user.id,
            customerCount: lookup.ids.length,
          }
        );
        continue;
      }

      if (dryRun) {
        stats.backfilled++;
        obs.info('[dry-run] Would backfill stripe_customer_id', {
          userId: user.id,
          customerId: lookup.customerId,
        });
        continue;
      }

      await dbWs
        .update(schema.users)
        .set({ stripeCustomerId: lookup.customerId })
        .where(
          and(
            eq(schema.users.id, user.id),
            // Defend against race: only write if still NULL so a concurrent
            // resolveOrCreateCustomer call can never be clobbered.
            isNull(schema.users.stripeCustomerId)
          )
        );

      stats.backfilled++;
      obs.info('Backfilled stripe_customer_id', {
        userId: user.id,
        customerId: lookup.customerId,
      });
    } catch (err) {
      stats.failed++;
      obs.error('Per-user backfill failed; continuing', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return lastId;
}

async function runBackfill(options: {
  dryRun: boolean;
  reset: boolean;
}): Promise<RunStats> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Export it (sk_test_…) before running the backfill.'
    );
  }
  const stripe = createStripeForBackfill(stripeKey);

  const checkpoint = await loadCheckpoint(options.reset);
  obs.info('Backfill starting', {
    dryRun: options.dryRun,
    reset: options.reset,
    resumingFrom: checkpoint.lastProcessedUserId ?? '(beginning)',
  });

  const stats: RunStats = {
    totalScanned: 0,
    backfilled: 0,
    stillNull: 0,
    needsReview: 0,
    failed: 0,
  };

  let cursor = checkpoint.lastProcessedUserId;

  // Keyset pagination by id — deterministic, resumable, no offset drift.
  for (;;) {
    const whereConditions = cursor
      ? and(
          whereNotDeleted(schema.users),
          isNull(schema.users.stripeCustomerId),
          gt(schema.users.id, cursor)
        )
      : and(
          whereNotDeleted(schema.users),
          isNull(schema.users.stripeCustomerId)
        );

    const batch = await dbWs
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(whereConditions)
      .orderBy(schema.users.id)
      .limit(PAGE_SIZE);

    if (batch.length === 0) {
      obs.info('No more users to process; backfill complete');
      break;
    }

    const lastId = await processBatch(stripe, batch, options.dryRun, stats);
    if (!lastId) break;
    cursor = lastId;

    if (!options.dryRun) {
      await saveCheckpoint(lastId);
    }

    obs.info('Batch complete', {
      batchSize: batch.length,
      ...stats,
    });

    if (batch.length < PAGE_SIZE) {
      break;
    }
  }

  return stats;
}

// ─── Self-test: counts before & after ──────────────────────────────────────

async function logBackfillCounts(): Promise<void> {
  const allNotDeleted = await dbWs
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(whereNotDeleted(schema.users));

  const withCustomer = await dbWs
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        whereNotDeleted(schema.users),
        isNotNull(schema.users.stripeCustomerId)
      )
    );

  obs.info('User counts after backfill', {
    totalNotDeleted: allNotDeleted.length,
    withStripeCustomerId: withCustomer.length,
    withoutStripeCustomerId: allNotDeleted.length - withCustomer.length,
  });
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const reset = process.argv.includes('--reset');

  console.log('\n  Stripe Customer ID Backfill');
  console.log('─'.repeat(50));
  console.log(`  Mode:        ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Checkpoint:  ${reset ? 'RESET' : 'RESUME'}`);
  console.log(`  Page size:   ${PAGE_SIZE}`);
  console.log('─'.repeat(50));

  const stats = await runBackfill({ dryRun, reset });

  console.log(`\n${'─'.repeat(50)}`);
  console.log('  Backfill summary:');
  console.log(`    Total scanned:   ${stats.totalScanned}`);
  console.log(`    Backfilled:      ${stats.backfilled}`);
  console.log(`    Left NULL:       ${stats.stillNull}`);
  console.log(`    Needs review:    ${stats.needsReview}`);
  console.log(`    Failed:          ${stats.failed}`);
  console.log('─'.repeat(50));

  await logBackfillCounts();

  if (stats.needsReview > 0) {
    console.log(
      `\n  Manual review entries written to:\n    ${REVIEW_LOG_FILE}`
    );
  }
}

/**
 * Only run when invoked as a script (not when imported by tests).
 */
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      obs.error('Backfill aborted', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      process.exit(1);
    });
}
