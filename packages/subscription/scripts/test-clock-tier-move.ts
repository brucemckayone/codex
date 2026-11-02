/**
 * A Stripe test-clock proof of a waiting tier move through its renewal
 * (Codex-2hxff.16; data design §9, "a manual Stripe test-clock run of one
 * move through its renewal before release").
 *
 * It makes the Stripe calls SubscriptionService makes, with the same
 * metadata helpers (src/services/tier-move.ts), on throwaway objects in TEST
 * mode, and checks what Stripe does with them:
 *
 *   A. Move, then the renewal.
 *      1. Premium £20/month, paid.
 *      2. The move to Basic £5 (scheduleTierMove): one no-proration swap and
 *         the move + hold keys. Nothing is invoiced; codex_tier_id stays;
 *         the upcoming invoice is £5 with no proration lines.
 *      3. The clock passes the period end: the renewal bills £5, and a
 *         customer.subscription.updated arrives whose item period starts on
 *         or after codex_move_at (what applyDueTierMove waits for).
 *      4. The flip (applyDueTierMove's write): codex_tier_id is Basic, every
 *         move and hold key gone.
 *   B. Move, Keep current plan, then the renewal.
 *      The Keep (keepCurrentPlan) puts the exact held Price back with no
 *      proration: nothing is invoiced, and the renewal bills £20.
 *   C. Move, Premium repriced while it waits, then Keep (review C1, F2).
 *      The re-price archives the held Price (TierService.updateTier), and
 *      Stripe refuses an archived Price on an item: Keep's write is refused
 *      as it stands, and goes through once `ensurePriceActive` has made the
 *      Price active again. The renewal bills the held £20, not the new £22.
 *
 * Run from the repo root, with the dev TEST key in .env.dev:
 *
 *   pnpm exec tsx --env-file=.env.dev packages/subscription/scripts/test-clock-tier-move.ts
 *
 * It refuses any key that is not a test-mode one. Every object it makes is
 * tagged `codex_env: test-clock` and goes at the end: the clocks are deleted
 * (with their customers and subscriptions), the prices and product
 * archived. Waiting for a clock to advance is bounded (2 minutes, every 3 s);
 * this is a manual proof, never a cron or a page.
 *
 * It writes nothing to any database. Nothing imports it (it is run by
 * hand), so fallow's unused-file finding is suppressed below.
 */

// fallow-ignore-file unused-file

import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { ensurePriceActive } from '../src/services/pending-price-change';
import {
  flipMetadata,
  keepMetadata,
  moveMetadata,
  readWaitingMove,
} from '../src/services/tier-move';

const STRIPE_API_VERSION = '2025-10-29.clover' as const;
const TAG = { codex_env: 'test-clock' };
const PREMIUM_PENCE = 2000;
const BASIC_PENCE = 500;
const REPRICED_PENCE = 2200;
const ADVANCE_WAIT_MS = 120_000;
const ADVANCE_STEP_MS = 3_000;

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`
  );
  if (!ok) failures.push(label);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Advance a clock and wait, bounded, until Stripe has caught up. */
async function advance(
  stripe: Stripe,
  clockId: string,
  frozenTime: number
): Promise<void> {
  await stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: frozenTime,
  });
  const deadline = Date.now() + ADVANCE_WAIT_MS;
  while (Date.now() < deadline) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return;
    await sleep(ADVANCE_STEP_MS);
  }
  throw new Error(`test clock ${clockId} did not finish advancing in time`);
}

interface Fixture {
  clockId: string;
  subscription: Stripe.Subscription;
  premiumTierId: string;
  basicTierId: string;
  userId: string;
  organizationId: string;
}

/** A clock, a customer with a card, and Premium paid. */
async function subscribedToPremium(
  stripe: Stripe,
  prices: { premium: string },
  name: string
): Promise<Fixture> {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: now,
    name: `codex tier move: ${name}`,
  });
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
    metadata: TAG,
  });
  const ids = {
    premiumTierId: randomUUID(),
    basicTierId: randomUUID(),
    userId: `test-clock-${randomUUID().slice(0, 8)}`,
    organizationId: randomUUID(),
  };
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: prices.premium }],
    metadata: {
      ...TAG,
      codex_tier_id: ids.premiumTierId,
      codex_user_id: ids.userId,
      codex_organization_id: ids.organizationId,
    },
  });
  return { clockId: clock.id, subscription, ...ids };
}

/** scheduleTierMove's Stripe write, with its metadata. */
async function moveToBasic(
  stripe: Stripe,
  fixture: Fixture,
  basicPriceId: string
): Promise<Stripe.Subscription> {
  const live = await stripe.subscriptions.retrieve(fixture.subscription.id);
  const item = live.items.data[0];
  if (!item) throw new Error('subscription has no item');
  return stripe.subscriptions.update(
    live.id,
    {
      items: [{ id: item.id, price: basicPriceId }],
      proration_behavior: 'none',
      metadata: moveMetadata({
        currentTierId: fixture.premiumTierId,
        userId: fixture.userId,
        organizationId: fixture.organizationId,
        targetTierId: fixture.basicTierId,
        moveAt: item.current_period_end,
        hold: {
          priceId: item.price.id,
          amountCents: item.price.unit_amount ?? PREMIUM_PENCE,
          metadata: live.metadata,
        },
      }),
    },
    {
      idempotencyKey: `move_${live.id}_${basicPriceId}_${item.current_period_end}_${Math.floor(Date.now() / 1000)}`,
    }
  );
}

const invoiceCount = async (stripe: Stripe, subscriptionId: string) =>
  (await stripe.invoices.list({ subscription: subscriptionId, limit: 100 }))
    .data.length;

async function scenarioMoveLands(
  stripe: Stripe,
  prices: { premium: string; basic: string },
  clocks: string[]
): Promise<void> {
  console.log('\nA. Move to Basic, then the renewal');
  const fixture = await subscribedToPremium(stripe, prices, 'move lands');
  clocks.push(fixture.clockId);
  const startedAt = Math.floor(Date.now() / 1000);
  const before = await invoiceCount(stripe, fixture.subscription.id);

  const moved = await moveToBasic(stripe, fixture, prices.basic);
  const move = readWaitingMove(moved.metadata);
  check('the move is readable from the metadata', move !== null);
  if (!move) return;
  check(
    'access stays on Premium until the renewal',
    moved.metadata.codex_tier_id === fixture.premiumTierId
  );
  check(
    'the hold is the Price the period was paid at',
    move.holdPriceId === prices.premium &&
      move.holdAmountCents === PREMIUM_PENCE
  );
  check(
    'nothing is invoiced for the move',
    (await invoiceCount(stripe, fixture.subscription.id)) === before
  );
  const upcoming = await stripe.invoices.createPreview({
    subscription: fixture.subscription.id,
  });
  check(
    'the next bill is Basic, with no proration lines',
    upcoming.amount_due === BASIC_PENCE &&
      !upcoming.lines.data.some(
        (line) => line.parent?.subscription_item_details?.proration === true
      ),
    `amount_due ${upcoming.amount_due}`
  );

  await advance(stripe, fixture.clockId, move.at + 3600);
  const renewed = await stripe.subscriptions.retrieve(fixture.subscription.id, {
    expand: ['latest_invoice'],
  });
  const item = renewed.items.data[0];
  check(
    'the renewal started a period on or after codex_move_at',
    (item?.current_period_start ?? 0) >= move.at
  );
  const latest = renewed.latest_invoice as Stripe.Invoice | null;
  check(
    'the renewal billed Basic',
    latest?.billing_reason === 'subscription_cycle' &&
      latest.amount_paid === BASIC_PENCE,
    `${latest?.billing_reason} ${latest?.amount_paid}`
  );
  const events = await stripe.events.list({
    type: 'customer.subscription.updated',
    created: { gte: startedAt - 60 },
    limit: 100,
  });
  check(
    'a customer.subscription.updated for the renewal arrived (the flip’s trigger)',
    events.data.some((event) => {
      const sub = event.data.object as Stripe.Subscription;
      return (
        sub.id === fixture.subscription.id &&
        (sub.items.data[0]?.current_period_start ?? 0) >= move.at
      );
    })
  );

  const flipped = await stripe.subscriptions.update(
    renewed.id,
    { metadata: flipMetadata(move) },
    { idempotencyKey: `move-apply:${renewed.id}:${move.tierId}:${move.at}` }
  );
  check(
    'the flip puts the member on Basic and clears every move and hold key',
    flipped.metadata.codex_tier_id === fixture.basicTierId &&
      readWaitingMove(flipped.metadata) === null &&
      !Object.keys(flipped.metadata).some((key) =>
        /^codex_(move|hold)_/.test(key)
      )
  );
}

async function scenarioKeep(
  stripe: Stripe,
  prices: { premium: string; basic: string },
  clocks: string[]
): Promise<void> {
  console.log('\nB. Move to Basic, Keep current plan, then the renewal');
  const fixture = await subscribedToPremium(stripe, prices, 'keep');
  clocks.push(fixture.clockId);
  const before = await invoiceCount(stripe, fixture.subscription.id);

  const moved = await moveToBasic(stripe, fixture, prices.basic);
  const move = readWaitingMove(moved.metadata);
  if (!move) {
    check('the move is readable from the metadata', false);
    return;
  }
  const item = moved.items.data[0];
  if (!item) throw new Error('subscription has no item');
  // keepCurrentPlan's Stripe write.
  const kept = await stripe.subscriptions.update(
    moved.id,
    {
      items: [{ id: item.id, price: move.holdPriceId }],
      proration_behavior: 'none',
      metadata: keepMetadata(move),
    },
    {
      idempotencyKey: `keep_${moved.id}_${move.holdPriceId}_${move.at}_${Date.now()}`,
    }
  );
  check(
    'Keep puts the exact held Price back and clears the move',
    kept.items.data[0]?.price.id === prices.premium &&
      readWaitingMove(kept.metadata) === null
  );
  check(
    'nothing is invoiced for the move or the Keep',
    (await invoiceCount(stripe, fixture.subscription.id)) === before
  );

  await advance(stripe, fixture.clockId, move.at + 3600);
  const renewed = await stripe.subscriptions.retrieve(fixture.subscription.id, {
    expand: ['latest_invoice'],
  });
  const latest = renewed.latest_invoice as Stripe.Invoice | null;
  check(
    'the renewal billed Premium',
    latest?.billing_reason === 'subscription_cycle' &&
      latest.amount_paid === PREMIUM_PENCE,
    `${latest?.billing_reason} ${latest?.amount_paid}`
  );
  check(
    'access is still Premium',
    renewed.metadata.codex_tier_id === fixture.premiumTierId
  );
}

async function scenarioKeepAfterReprice(
  stripe: Stripe,
  prices: { premium: string; basic: string },
  product: string,
  extraPrices: string[],
  clocks: string[]
): Promise<void> {
  console.log(
    '\nC. Move to Basic, Premium repriced while it waits, then Keep (F2)'
  );
  const fixture = await subscribedToPremium(
    stripe,
    prices,
    'keep after reprice'
  );
  clocks.push(fixture.clockId);
  const moved = await moveToBasic(stripe, fixture, prices.basic);
  const move = readWaitingMove(moved.metadata);
  const item = moved.items.data[0];
  if (!move || !item) {
    check('the move is readable from the metadata', false);
    return;
  }

  // TierService.updateTier: a new Premium Price, and the old one archived.
  const repriced = await stripe.prices.create({
    product,
    currency: 'gbp',
    unit_amount: REPRICED_PENCE,
    recurring: { interval: 'month' },
    nickname: 'Premium repriced',
    metadata: TAG,
  });
  extraPrices.push(repriced.id);
  await stripe.prices.update(prices.premium, { active: false });

  const keep: Stripe.SubscriptionUpdateParams = {
    items: [{ id: item.id, price: move.holdPriceId }],
    proration_behavior: 'none',
    metadata: keepMetadata(move),
  };
  // keepCurrentPlan's write as it stood before F2.
  const refusal = await stripe.subscriptions
    .update(moved.id, keep, {
      idempotencyKey: `keep_unfixed_${moved.id}_${Date.now()}`,
    })
    .then(
      () => null,
      (error: unknown) =>
        error as { statusCode?: number; code?: string; message?: string }
    );
  check(
    'without ensurePriceActive, Stripe refuses the archived held Price',
    refusal !== null && refusal.statusCode === 400,
    refusal
      ? `${refusal.statusCode} ${refusal.code ?? '-'}: ${refusal.message}`
      : 'it was accepted'
  );

  await ensurePriceActive(stripe, move.holdPriceId);
  const kept = await stripe.subscriptions.update(moved.id, keep, {
    idempotencyKey: `keep_${moved.id}_${move.holdPriceId}_${move.at}_${Date.now()}`,
  });
  check(
    'with ensurePriceActive, Keep puts the exact held Price back',
    kept.items.data[0]?.price.id === prices.premium &&
      readWaitingMove(kept.metadata) === null
  );
  check(
    'the held Price is left active',
    (await stripe.prices.retrieve(prices.premium)).active
  );

  await advance(stripe, fixture.clockId, move.at + 3600);
  const renewed = await stripe.subscriptions.retrieve(fixture.subscription.id, {
    expand: ['latest_invoice'],
  });
  const latest = renewed.latest_invoice as Stripe.Invoice | null;
  check(
    'the renewal billed the held £20, not the repriced £22',
    latest?.billing_reason === 'subscription_cycle' &&
      latest.amount_paid === PREMIUM_PENCE,
    `${latest?.billing_reason} ${latest?.amount_paid}`
  );
}

/** Clocks of this run Stripe still holds (each deleted one reads as missing). */
async function clocksLeft(stripe: Stripe, clocks: string[]): Promise<number> {
  let left = 0;
  for (const clockId of clocks) {
    const found = await stripe.testHelpers.testClocks.retrieve(clockId).then(
      (clock) => !(clock as { deleted?: boolean }).deleted,
      () => false
    );
    if (found) left += 1;
  }
  return left;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new Error('REFUSING: this proof runs on a Stripe TEST key only');
  }
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

  const product = await stripe.products.create({
    name: 'Codex tier move test clock',
    metadata: TAG,
  });
  const price = (pence: number, nickname: string) =>
    stripe.prices.create({
      product: product.id,
      currency: 'gbp',
      unit_amount: pence,
      recurring: { interval: 'month' },
      nickname,
      metadata: TAG,
    });
  const prices = {
    premium: (await price(PREMIUM_PENCE, 'Premium')).id,
    basic: (await price(BASIC_PENCE, 'Basic')).id,
  };
  const clocks: string[] = [];
  const extraPrices: string[] = [];
  try {
    await scenarioMoveLands(stripe, prices, clocks);
    await scenarioKeep(stripe, prices, clocks);
    // Last: it archives Premium's Price, then makes it active again.
    await scenarioKeepAfterReprice(
      stripe,
      prices,
      product.id,
      extraPrices,
      clocks
    );
  } finally {
    for (const clockId of clocks) {
      await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
    }
    for (const priceId of [...Object.values(prices), ...extraPrices]) {
      await stripe.prices.update(priceId, { active: false }).catch(() => {});
    }
    await stripe.products.update(product.id, { active: false }).catch(() => {});
    const left = await clocksLeft(stripe, clocks);
    console.log(`\nTest clocks left behind: ${left}`);
    if (left > 0) failures.push('test clocks left behind');
  }

  console.log(
    failures.length === 0
      ? '\nAll checks passed.'
      : `\n${failures.length} check(s) FAILED: ${failures.join('; ')}`
  );
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(
    `Test clock run aborted: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
