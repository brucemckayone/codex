/**
 * Move production's Stripe references onto the account its key is on now
 * (2026-11-06). Production's STRIPE_SECRET_KEY moved from the "Codex"
 * account to "Codex sandbox", where its webhooks already were (since
 * 2026-10-13, owner: "Codex sandbox … is what should be in production"). The
 * Stripe ids production stored before the move name objects on "Codex",
 * which the sandbox key cannot see.
 *
 * Each row is decided by Stripe's own answer, never by a list of names: a
 * row changes only when the current key is told its object does not exist
 * (`resource_missing`; `account_invalid` for a Connect account). Then the
 * row is changed the way the app itself would change it:
 *   - a tier or course plan gets a new Product and monthly + annual Prices,
 *     built as TierService.createTier and CourseSubscriptionService's plan
 *     create build them, and its three ids are swapped;
 *   - a live course subscription is ended as handleCourseSubscriptionDeleted
 *     ends it (cancelled, under the course lock, its grant revoked), without
 *     the cancellation email;
 *   - a creator's Connect account is replaced by a new Express account made
 *     as createAccountForUser makes it, in `onboarding`. The database trigger
 *     records the old one in stripe_connect_account_history (migration 0113);
 *   - a user's Stripe customer id is cleared; the next checkout makes one.
 * Payments and payouts already made are history: counted, never changed.
 *
 * DRY RUN (the default). Its database reads run in a READ ONLY transaction;
 * Stripe is only read:
 *
 *   pnpm --filter @codex/database exec tsx scripts/rehome-stripe-objects.ts --env production --test-keys
 *
 *   One line per row (our id, its Stripe id, the action), then the checksum
 *   of the changes.
 *
 * APPLY:
 *
 *   … --apply --confirm <checksum>
 *
 *   The checksum covers every planned change, so an apply does only what the
 *   dry run showed, and refuses if anything moved since.
 *
 * Idempotent: every Stripe create carries a key per row, and every database
 * write checks the row still holds the old id. Run in production only with
 * the owner's OK.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENCY,
  SUBSCRIPTION_STATUS,
  stripeEnvMetadata,
} from '@codex/constants';
import Stripe from 'stripe';
import {
  assertKeyMatchesEnv,
  keyMode,
  parseArgs,
} from './backfill-payout-schedule';

const STRIPE_API_VERSION = '2025-10-29.clover' as const;

/** Each Stripe call gives up after 20 s. */
const STRIPE_REQUEST = {
  timeout: 20_000,
  maxNetworkRetries: 2,
} as const satisfies Stripe.RequestOptions;

/** CourseSubscriptionService's COURSE_SUBSCRIPTION_METADATA_TYPE. */
const COURSE_PLAN_TYPE = 'course_subscription';

// ─── The rows ──────────────────────────────────────────────────────────────

/** A tier or course plan with its Stripe Product and Prices. */
export interface PricedRow {
  kind: 'tier' | 'course plan';
  id: string;
  organizationId: string;
  /** The course, for a course plan. */
  courseId: string | null;
  /** The tier's name, or the plan's course title. */
  name: string;
  description: string | null;
  priceMonthly: number;
  priceAnnual: number;
  stripeProductId: string;
}

export interface LiveCourseSubscriptionRow {
  id: string;
  userId: string;
  courseId: string;
  stripeSubscriptionId: string;
}

export interface ConnectRow {
  id: string;
  userId: string;
  stripeAccountId: string;
}

export interface CustomerRow {
  userId: string;
  stripeCustomerId: string;
}

export interface Rows {
  priced: PricedRow[];
  courseSubscriptions: LiveCourseSubscriptionRow[];
  connect: ConnectRow[];
  customers: CustomerRow[];
  /** Payments and payouts already made, for the report only. */
  history: { purchases: number; payouts: number };
}

// ─── The plan ──────────────────────────────────────────────────────────────

export type RowKind =
  | 'tier'
  | 'course plan'
  | 'course subscription'
  | 'connect account'
  | 'customer';

export type PlanAction =
  | 'keep'
  | 'move'
  | 'end'
  | 'replace'
  | 'clear'
  | `skip: Stripe error ${string}`;

export interface PlanLine {
  kind: RowKind;
  /** Our row id (the user id, for a customer). Never an email. */
  rowId: string;
  stripeId: string;
  action: PlanAction;
}

const CHANGES: ReadonlySet<PlanAction> = new Set([
  'move',
  'end',
  'replace',
  'clear',
]);

/** The action that changes a row whose Stripe object is gone. */
const CHANGE_FOR: Record<RowKind, PlanAction> = {
  tier: 'move',
  'course plan': 'move',
  'course subscription': 'end',
  'connect account': 'replace',
  customer: 'clear',
};

/**
 * Stripe's answer for an object this key cannot see, by kind. Calibrated
 * 2026-11-06 against the sandbox: an unknown Product, Subscription or
 * Customer is `resource_missing`; an unknown or foreign Connect account is
 * `account_invalid`.
 */
const GONE_CODE: Record<RowKind, string> = {
  tier: 'resource_missing',
  'course plan': 'resource_missing',
  'course subscription': 'resource_missing',
  'connect account': 'account_invalid',
  customer: 'resource_missing',
};

function errorCode(error: unknown): string {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

/** A hash of the sorted changes: what `--confirm` must repeat. */
export function planChecksum(lines: readonly PlanLine[]): string {
  const changes = lines
    .filter((line) => CHANGES.has(line.action))
    .map((line) => `${line.kind}|${line.rowId}|${line.stripeId}|${line.action}`)
    .sort();
  return createHash('sha256')
    .update(changes.join('\n'))
    .digest('hex')
    .slice(0, 16);
}

// ─── Stripe ────────────────────────────────────────────────────────────────

export type RehomeStripe = {
  products: Pick<Stripe['products'], 'retrieve' | 'create'>;
  prices: Pick<Stripe['prices'], 'create'>;
  subscriptions: Pick<Stripe['subscriptions'], 'retrieve'>;
  accounts: Pick<Stripe['accounts'], 'retrieve' | 'create'>;
  customers: Pick<Stripe['customers'], 'retrieve'>;
};

/** Read the object; a deleted Customer counts as gone. */
async function lookUp(
  stripe: RehomeStripe,
  kind: RowKind,
  stripeId: string
): Promise<void> {
  switch (kind) {
    case 'tier':
    case 'course plan':
      await stripe.products.retrieve(stripeId, {}, STRIPE_REQUEST);
      return;
    case 'course subscription':
      await stripe.subscriptions.retrieve(stripeId, {}, STRIPE_REQUEST);
      return;
    case 'connect account':
      await stripe.accounts.retrieve(stripeId, {}, STRIPE_REQUEST);
      return;
    case 'customer': {
      const customer = await stripe.customers.retrieve(
        stripeId,
        {},
        STRIPE_REQUEST
      );
      if ('deleted' in customer && customer.deleted) {
        throw Object.assign(new Error('Customer deleted'), {
          code: GONE_CODE.customer,
        });
      }
      return;
    }
  }
}

async function decide(
  stripe: RehomeStripe,
  kind: RowKind,
  rowId: string,
  stripeId: string
): Promise<PlanLine> {
  let action: PlanAction;
  try {
    await lookUp(stripe, kind, stripeId);
    action = 'keep';
  } catch (error) {
    const code = errorCode(error);
    action =
      code === GONE_CODE[kind]
        ? CHANGE_FOR[kind]
        : `skip: Stripe error ${code}`;
  }
  return { kind, rowId, stripeId, action };
}

/** Ask Stripe about every row. Reads only. */
export async function survey(
  stripe: RehomeStripe,
  rows: Rows
): Promise<PlanLine[]> {
  const lines: PlanLine[] = [];
  for (const row of rows.priced) {
    lines.push(await decide(stripe, row.kind, row.id, row.stripeProductId));
  }
  for (const row of rows.courseSubscriptions) {
    lines.push(
      await decide(
        stripe,
        'course subscription',
        row.id,
        row.stripeSubscriptionId
      )
    );
  }
  for (const row of rows.connect) {
    lines.push(
      await decide(stripe, 'connect account', row.id, row.stripeAccountId)
    );
  }
  for (const row of rows.customers) {
    lines.push(
      await decide(stripe, 'customer', row.userId, row.stripeCustomerId)
    );
  }
  return lines;
}

/** Product and Prices built as the tier and course plan creates build them. */
export function productParams(
  row: PricedRow,
  environment: string
): Stripe.ProductCreateParams {
  if (row.kind === 'tier') {
    return {
      name: row.name,
      description: row.description ?? undefined,
      metadata: {
        codex_organization_id: row.organizationId,
        codex_type: 'subscription_tier',
        ...stripeEnvMetadata(environment),
      },
    };
  }
  return {
    name: `${row.name} — Subscription`,
    metadata: {
      codex_organization_id: row.organizationId,
      codex_course_id: row.courseId ?? '',
      codex_type: COURSE_PLAN_TYPE,
      ...stripeEnvMetadata(environment),
    },
  };
}

export function priceParams(
  row: PricedRow,
  productId: string,
  interval: 'month' | 'year',
  environment: string
): Stripe.PriceCreateParams {
  const owner: Record<string, string> =
    row.kind === 'tier'
      ? { codex_organization_id: row.organizationId }
      : { codex_course_id: row.courseId ?? '' };
  return {
    product: productId,
    unit_amount: interval === 'month' ? row.priceMonthly : row.priceAnnual,
    currency: CURRENCY.GBP,
    recurring: { interval },
    metadata: { ...owner, interval, ...stripeEnvMetadata(environment) },
  };
}

/** A new Express account built as createAccountForUser builds one. */
export function accountParams(
  userId: string,
  environment: string
): Stripe.AccountCreateParams {
  return {
    controller: {
      stripe_dashboard: { type: 'express' },
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'stripe',
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        schedule: { interval: 'manual' },
        debit_negative_balances: false,
      },
    },
    country: 'GB',
    metadata: { codex_user_id: userId, ...stripeEnvMetadata(environment) },
  };
}

// ─── The writes ────────────────────────────────────────────────────────────

export interface RehomeWrites {
  /** Swap the three ids; false if the row no longer holds `oldProductId`. */
  swapPricedIds(
    row: PricedRow,
    ids: { productId: string; monthlyId: string; annualId: string }
  ): Promise<boolean>;
  /** End the row and revoke its grant, under the course lock. */
  endCourseSubscription(row: LiveCourseSubscriptionRow): Promise<boolean>;
  /** Point the row at the new account, in `onboarding`. */
  replaceConnectAccount(
    row: ConnectRow,
    newAccountId: string
  ): Promise<boolean>;
  /** Clear the user's customer id. */
  clearCustomer(row: CustomerRow): Promise<boolean>;
}

export interface ApplyResult {
  done: number;
  /** Rows that changed under us: their write found the old id gone. */
  unchanged: number;
}

export async function apply(
  deps: {
    stripe: RehomeStripe;
    writes: RehomeWrites;
    print(line: string): void;
  },
  rows: Rows,
  lines: readonly PlanLine[],
  environment: string
): Promise<ApplyResult> {
  const result: ApplyResult = { done: 0, unchanged: 0 };
  const count = (wrote: boolean) => {
    if (wrote) result.done += 1;
    else result.unchanged += 1;
  };
  const planned = (kind: RowKind, rowId: string) =>
    lines.find(
      (l) => l.kind === kind && l.rowId === rowId && CHANGES.has(l.action)
    );

  for (const row of rows.priced) {
    if (!planned(row.kind, row.id)) continue;
    const key = `rehome-${environment}-${row.kind === 'tier' ? 'tier' : 'plan'}-${row.id}`;
    const product = await deps.stripe.products.create(
      productParams(row, environment),
      { ...STRIPE_REQUEST, idempotencyKey: `${key}-product` }
    );
    const [monthly, annual] = await Promise.all([
      deps.stripe.prices.create(
        priceParams(row, product.id, 'month', environment),
        {
          ...STRIPE_REQUEST,
          idempotencyKey: `${key}-monthly-${row.priceMonthly}`,
        }
      ),
      deps.stripe.prices.create(
        priceParams(row, product.id, 'year', environment),
        {
          ...STRIPE_REQUEST,
          idempotencyKey: `${key}-annual-${row.priceAnnual}`,
        }
      ),
    ]);
    const wrote = await deps.writes.swapPricedIds(row, {
      productId: product.id,
      monthlyId: monthly.id,
      annualId: annual.id,
    });
    deps.print(
      `${row.kind} ${row.id}: ${row.stripeProductId} → ${product.id}${wrote ? '' : ' (row changed; not written)'}`
    );
    count(wrote);
  }

  for (const row of rows.courseSubscriptions) {
    if (!planned('course subscription', row.id)) continue;
    const wrote = await deps.writes.endCourseSubscription(row);
    deps.print(
      `course subscription ${row.id}: ended${wrote ? '' : ' (already ended)'}`
    );
    count(wrote);
  }

  for (const row of rows.connect) {
    if (!planned('connect account', row.id)) continue;
    const account = await deps.stripe.accounts.create(
      accountParams(row.userId, environment),
      {
        ...STRIPE_REQUEST,
        idempotencyKey: `rehome-${environment}-connect-${row.userId}`,
      }
    );
    const wrote = await deps.writes.replaceConnectAccount(row, account.id);
    deps.print(
      `connect account ${row.id}: ${row.stripeAccountId} → ${account.id}${wrote ? '' : ' (row changed; not written)'}`
    );
    count(wrote);
  }

  for (const row of rows.customers) {
    if (!planned('customer', row.userId)) continue;
    const wrote = await deps.writes.clearCustomer(row);
    deps.print(
      `customer of user ${row.userId}: cleared${wrote ? '' : ' (row changed; not written)'}`
    );
    count(wrote);
  }

  return result;
}

// ─── The database ──────────────────────────────────────────────────────────

type Db = typeof import('../src').dbWs;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Every row that holds a Stripe id the rehome looks at. */
export async function readRows(db: Db | Tx): Promise<Rows> {
  const s = await import('../src/schema');
  const { and, count, eq, isNotNull, isNull } = await import('drizzle-orm');

  const tiers = await db
    .select({
      id: s.subscriptionTiers.id,
      organizationId: s.subscriptionTiers.organizationId,
      name: s.subscriptionTiers.name,
      description: s.subscriptionTiers.description,
      priceMonthly: s.subscriptionTiers.priceMonthly,
      priceAnnual: s.subscriptionTiers.priceAnnual,
      stripeProductId: s.subscriptionTiers.stripeProductId,
    })
    .from(s.subscriptionTiers)
    .where(
      and(
        isNull(s.subscriptionTiers.deletedAt),
        isNotNull(s.subscriptionTiers.stripeProductId)
      )
    );
  const plans = await db
    .select({
      id: s.courseSubscriptionPlans.id,
      organizationId: s.courses.organizationId,
      courseId: s.courseSubscriptionPlans.courseId,
      name: s.courses.title,
      priceMonthly: s.courseSubscriptionPlans.priceMonthly,
      priceAnnual: s.courseSubscriptionPlans.priceAnnual,
      stripeProductId: s.courseSubscriptionPlans.stripeProductId,
    })
    .from(s.courseSubscriptionPlans)
    .innerJoin(s.courses, eq(s.courses.id, s.courseSubscriptionPlans.courseId))
    .where(
      and(
        isNull(s.courseSubscriptionPlans.deletedAt),
        isNotNull(s.courseSubscriptionPlans.stripeProductId)
      )
    );
  const courseSubscriptions = await db
    .select({
      id: s.courseSubscriptions.id,
      userId: s.courseSubscriptions.userId,
      courseId: s.courseSubscriptions.courseId,
      stripeSubscriptionId: s.courseSubscriptions.stripeSubscriptionId,
    })
    .from(s.courseSubscriptions)
    .where(
      and(
        isNull(s.courseSubscriptions.endedAt),
        isNull(s.courseSubscriptions.duplicateOfCourseSubscriptionId),
        isNotNull(s.courseSubscriptions.stripeSubscriptionId)
      )
    );
  const connect = await db
    .select({
      id: s.stripeConnectAccounts.id,
      userId: s.stripeConnectAccounts.userId,
      stripeAccountId: s.stripeConnectAccounts.stripeAccountId,
    })
    .from(s.stripeConnectAccounts);
  const customers = await db
    .select({ userId: s.users.id, stripeCustomerId: s.users.stripeCustomerId })
    .from(s.users)
    .where(isNotNull(s.users.stripeCustomerId));
  const [purchases] = await db.select({ n: count() }).from(s.purchases);
  const [payouts] = await db.select({ n: count() }).from(s.payouts);

  const priced: PricedRow[] = [];
  for (const t of tiers) {
    if (!t.stripeProductId) continue;
    priced.push({
      ...t,
      kind: 'tier',
      courseId: null,
      stripeProductId: t.stripeProductId,
    });
  }
  for (const p of plans) {
    if (!p.stripeProductId) continue;
    priced.push({
      ...p,
      kind: 'course plan',
      description: null,
      stripeProductId: p.stripeProductId,
    });
  }
  return {
    priced,
    courseSubscriptions: courseSubscriptions.flatMap((r) =>
      r.stripeSubscriptionId
        ? [{ ...r, stripeSubscriptionId: r.stripeSubscriptionId }]
        : []
    ),
    connect,
    customers: customers.flatMap((r) =>
      r.stripeCustomerId
        ? [{ userId: r.userId, stripeCustomerId: r.stripeCustomerId }]
        : []
    ),
    history: { purchases: purchases?.n ?? 0, payouts: payouts?.n ?? 0 },
  };
}

/** The writes, each checking the row still holds what the survey saw. */
export async function databaseWrites(db: Db): Promise<RehomeWrites> {
  const s = await import('../src/schema');
  const { and, eq, isNull, sql } = await import('drizzle-orm');
  return {
    async swapPricedIds(row, ids) {
      const set = {
        stripeProductId: ids.productId,
        stripePriceMonthlyId: ids.monthlyId,
        stripePriceAnnualId: ids.annualId,
        updatedAt: new Date(),
      };
      const written =
        row.kind === 'tier'
          ? await db
              .update(s.subscriptionTiers)
              .set(set)
              .where(
                and(
                  eq(s.subscriptionTiers.id, row.id),
                  eq(s.subscriptionTiers.stripeProductId, row.stripeProductId)
                )
              )
              .returning({ id: s.subscriptionTiers.id })
          : await db
              .update(s.courseSubscriptionPlans)
              .set(set)
              .where(
                and(
                  eq(s.courseSubscriptionPlans.id, row.id),
                  eq(
                    s.courseSubscriptionPlans.stripeProductId,
                    row.stripeProductId
                  )
                )
              )
              .returning({ id: s.courseSubscriptionPlans.id });
      return written.length > 0;
    },

    // handleCourseSubscriptionDeleted → endCourseSubscription, minus the
    // email: the same lock key, the same status and dates, the same revoke
    // (revokeCourseSubscriptionEntitlement in @codex/purchase). Guarded on
    // `ended_at IS NULL` instead of COALESCE, so a re-run writes nothing.
    async endCourseSubscription(row) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`course-subscription:${row.userId}:${row.courseId}`}))`
        );
        const at = new Date();
        const ended = await tx
          .update(s.courseSubscriptions)
          .set({
            status: SUBSCRIPTION_STATUS.CANCELLED,
            cancelledAt: sql`COALESCE(${s.courseSubscriptions.cancelledAt}, ${at})`,
            endedAt: at,
            updatedAt: at,
          })
          .where(
            and(
              eq(s.courseSubscriptions.id, row.id),
              isNull(s.courseSubscriptions.endedAt)
            )
          )
          .returning({ id: s.courseSubscriptions.id });
        await tx
          .update(s.entitlements)
          .set({ revokedAt: at })
          .where(
            and(
              eq(s.entitlements.source, 'course_subscription'),
              eq(s.entitlements.sourceRef, row.id),
              isNull(s.entitlements.revokedAt)
            )
          );
        return ended.length > 0;
      });
    },

    async replaceConnectAccount(row, newAccountId) {
      const written = await db
        .update(s.stripeConnectAccounts)
        .set({
          stripeAccountId: newAccountId,
          status: 'onboarding',
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingCompletedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.stripeConnectAccounts.id, row.id),
            eq(s.stripeConnectAccounts.stripeAccountId, row.stripeAccountId)
          )
        )
        .returning({ id: s.stripeConnectAccounts.id });
      return written.length > 0;
    },

    async clearCustomer(row) {
      const written = await db
        .update(s.users)
        .set({ stripeCustomerId: null })
        .where(
          and(
            eq(s.users.id, row.userId),
            eq(s.users.stripeCustomerId, row.stripeCustomerId)
          )
        )
        .returning({ id: s.users.id });
      return written.length > 0;
    },
  };
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

export function printPlan(
  lines: readonly PlanLine[],
  rows: Rows,
  print: (line: string) => void
): string {
  print('kind | our id | stripe id | action');
  for (const line of lines) {
    print(`${line.kind} | ${line.rowId} | ${line.stripeId} | ${line.action}`);
  }
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.action, (counts.get(line.action) ?? 0) + 1);
  }
  for (const [action, n] of counts) print(`${action}: ${n}`);
  print(
    `history, not changed: ${rows.history.purchases} purchases, ${rows.history.payouts} payouts`
  );
  const checksum = planChecksum(lines);
  print(`checksum: ${checksum}`);
  return checksum;
}

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
  assertKeyMatchesEnv(key, args);
  const stripe = new Stripe(key as string, { apiVersion: STRIPE_API_VERSION });
  const { dbWs } = await import('../src');

  console.log(
    `\n  Rehome Stripe objects: ${args.apply ? 'APPLY' : 'DRY RUN (no writes)'}, env ${args.env}, ${keyMode(key)} key\n`
  );
  const print = (line: string) => console.log(line);

  const rows = await dbWs.transaction((tx) => readRows(tx), {
    accessMode: 'read only',
  });
  const lines = await survey(stripe, rows);
  const checksum = printPlan(lines, rows, print);

  if (!args.apply) {
    console.log(
      `\n  Nothing was changed. To write: --apply --confirm ${checksum}`
    );
    return;
  }
  if (args.confirm !== checksum) {
    throw new Error(
      `--confirm ${args.confirm} does not match this run's checksum ${checksum}: something changed since the dry run. Run it again and read it.`
    );
  }
  const result = await apply(
    { stripe, writes: await databaseWrites(dbWs), print },
    rows,
    lines,
    args.env
  );
  console.log(
    `\n  Done: ${result.done} written, ${result.unchanged} changed under us and left.`
  );
}

const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(
        `Rehome aborted: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
