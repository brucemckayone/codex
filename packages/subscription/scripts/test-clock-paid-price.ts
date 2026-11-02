/**
 * A Stripe test-clock regression proof: a switch after an early price move
 * credits the Price the period was PAID at, not the item's current one
 * (review C1, F5; Codex-2hxff.95, closed as not a bug on our API version).
 * Stripe credits the invoiced line, which each credit names in
 * `proration_details.credited_items`. So nothing is put back before a switch,
 * and the change-plan dialog, a plain preview, shows exactly what is charged.
 * It also proves the platform's own Price updates are told apart from a
 * Dashboard edit (the false "edited in Stripe Dashboard" alert).
 *
 * Re-run it BEFORE any Stripe apiVersion upgrade. It takes its client from
 * `createStripeClient` (packages/purchase/src/stripe-client.ts), so it runs
 * on whatever version is pinned there. If a new version credits the item's
 * current Price, a switch after an early move credits the wrong amount, and
 * these checks fail.
 *
 * It calls the real `schedulePriceChange` (the early move),
 * `applyDuePendingPriceChange` (the pending swap at a renewal),
 * `ensurePriceActive`, `platformWriteMetadata` and `isPlatformPriceWrite`,
 * from src/services/pending-price-change.ts, on throwaway TEST-mode objects.
 * The preview and the switch are the calls `previewTierChange` and
 * `changeTierNow` make (src/services/subscription-service.ts): keep them in
 * step.
 *
 *   A. Applied now, a rise: annual £100 paid, £150 put on early.
 *   B. Applied now, a cut: annual £150 paid, £100 put on early.
 *   C. Two early moves in one period: annual £100 paid, then £150, then £180.
 *      In A to C, a month on, one member upgrades to annual £200 (invoiced
 *      now) and one switches to monthly £15 (credited on the next invoice).
 *   D. The pending path: monthly £10, a rise to £12 told 27 days before the
 *      renewal. That renewal bills £10, the swap lands at it, and mid-period
 *      one member upgrades to monthly £20 and one switches to annual £100
 *      (both invoiced now).
 *   N. Price events: the platform's archive and `ensurePriceActive` read as
 *      ours; a nickname edit, a metadata edit and an archive by hand do not.
 *
 * Every switch checks:
 *   - before it, the item is on the moved Price, not the paid one, or the
 *     proof would show nothing;
 *   - the credit is the paid line's unused time, and differs from the
 *     current Price's figure;
 *   - the credit's `credited_items` names the paid invoice and its line;
 *   - the dialog's preview (always_invoice, the same proration_date) has the
 *     invoice's proration lines and its amount due. Where nothing is invoiced
 *     now, its lines are on the upcoming invoice and its amount due is 0.
 *
 * Run from the repo root, with the dev TEST key in .env.dev:
 *
 *   pnpm exec tsx --env-file=.env.dev packages/subscription/scripts/test-clock-paid-price.ts
 *
 * It refuses any key that is not a test-mode one. Every object it makes is
 * tagged `codex_env: test-clock` and none carries a `codex_organization_id`,
 * so no webhook takes them for a tier's. The clocks are deleted (with their
 * customers and subscriptions), the prices and product archived, and it
 * reports how many clocks are left. Waits are bounded (a clock advance 2
 * minutes, every 3 s; an event 30 s, every 3 s); this is a manual proof,
 * never a cron or a page. It writes nothing to any database. Nothing
 * imports it (it is run by hand), so fallow's unused-file finding is
 * suppressed below.
 */

// fallow-ignore-file unused-file

import { createStripeClient } from '@codex/purchase';
import type Stripe from 'stripe';
import {
  applyDuePendingPriceChange,
  ensurePriceActive,
  isPlatformPriceWrite,
  platformWriteMetadata,
  schedulePriceChange,
} from '../src/services/pending-price-change';

const TAG = { codex_env: 'test-clock' };
const DAY = 86_400;
const HOUR = 3_600;
const ADVANCE_WAIT_MS = 120_000;
const POLL_MS = 3_000;
const EVENT_WAIT_MS = 30_000;

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`
  );
  if (!ok) failures.push(label);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pounds = (pence: number) => `£${pence / 100}`;

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
    await sleep(POLL_MS);
  }
  throw new Error(`test clock ${clockId} did not finish advancing in time`);
}

interface Kit {
  stripe: Stripe;
  product: string;
  prices: string[];
  clocks: string[];
}

interface Plan {
  id: string;
  pence: number;
  interval: 'month' | 'year';
}

async function price(
  kit: Kit,
  pence: number,
  interval: 'month' | 'year'
): Promise<Plan> {
  const created = await kit.stripe.prices.create({
    product: kit.product,
    currency: 'gbp',
    unit_amount: pence,
    recurring: { interval },
    nickname: `${interval === 'year' ? 'Annual' : 'Monthly'} ${pence / 100}`,
    metadata: TAG,
  });
  kit.prices.push(created.id);
  return { id: created.id, pence, interval };
}

/** One clock, two customers with a card, each with `plan` paid. */
async function twoMembers(
  kit: Kit,
  plan: Plan,
  name: string
): Promise<{ clockId: string; now: number; members: [string, string] }> {
  const now = Math.floor(Date.now() / 1000);
  const clock = await kit.stripe.testHelpers.testClocks.create({
    frozen_time: now,
    name: `codex paid price: ${name}`,
  });
  kit.clocks.push(clock.id);
  const member = async () => {
    const customer = await kit.stripe.customers.create({
      test_clock: clock.id,
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
      metadata: TAG,
    });
    const subscription = await kit.stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: plan.id }],
      metadata: TAG,
    });
    return subscription.id;
  };
  return { clockId: clock.id, now, members: [await member(), await member()] };
}

/** The re-price: a Studio save archives the old Price, with the nonce. */
const archive = (kit: Kit, plan: Plan) =>
  kit.stripe.prices.update(plan.id, {
    active: false,
    metadata: platformWriteMetadata(),
  });

/** A price move through the real path, its notice accepted at `noticeAt`. */
async function move(
  kit: Kit,
  subscriptionId: string,
  to: Plan,
  noticeAt: number
): Promise<string> {
  const outcome = await schedulePriceChange(
    kit.stripe,
    {
      stripeSubscriptionId: subscriptionId,
      newPriceId: to.id,
      newAmountCents: to.pence,
      interval: to.interval,
      noticeAt: new Date(noticeAt * 1000),
    },
    async () => true
  );
  return outcome.kind;
}

/** The line of the latest invoice that billed the item: what was paid. */
async function paidLine(
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<Stripe.InvoiceLineItem | null> {
  const item = subscription.items.data[0];
  const invoiceId =
    typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;
  if (!item || !invoiceId) return null;
  const lines = (await stripe.invoices.listLineItems(invoiceId, { limit: 100 }))
    .data;
  return (
    lines.find(
      (line) =>
        line.parent?.subscription_item_details?.subscription_item === item.id &&
        line.parent.subscription_item_details.proration === false
    ) ?? null
  );
}

/** A line's proration details, whichever parent Stripe files it under. */
const prorationOf = (line: Stripe.InvoiceLineItem) =>
  line.parent?.subscription_item_details ??
  line.parent?.invoice_item_details ??
  null;

interface Switch {
  label: string;
  subscriptionId: string;
  paid: Plan;
  moved: Plan;
  to: Plan;
  /** As `nowProration` decides it for this switch. */
  proration: 'always_invoice' | 'create_prorations';
  prorationDate: number;
}

/**
 * Preview the switch as the dialog does, make it as `changeTierNow` does,
 * and check the credit against the paid line and the dialog against the
 * charge.
 */
async function switchAndCheck(kit: Kit, run: Switch): Promise<void> {
  const { stripe } = kit;
  console.log(`  -- ${run.label}`);
  const live = await stripe.subscriptions.retrieve(run.subscriptionId);
  const item = live.items.data[0];
  if (!item) {
    check('the subscription has an item', false);
    return;
  }
  check(
    `before the switch the item is on the moved ${pounds(run.moved.pence)}, not the ${pounds(run.paid.pence)} paid`,
    item.price.id === run.moved.id && run.moved.id !== run.paid.id
  );
  const paid = await paidLine(stripe, live);
  check(
    `the latest invoice billed the ${pounds(run.paid.pence)}`,
    paid?.pricing?.price_details?.price === run.paid.id &&
      paid.amount === run.paid.pence,
    `line ${paid?.amount ?? 'none'}`
  );
  if (!paid) return;

  // previewTierChange (subscription-service.ts).
  const preview = await stripe.invoices.createPreview({
    subscription: live.id,
    subscription_details: {
      items: [{ id: item.id, price: run.to.id }],
      proration_date: run.prorationDate,
      proration_behavior: 'always_invoice',
    },
  });
  const dialogLines = preview.lines.data
    .filter(
      (line) => line.parent?.subscription_item_details?.proration === true
    )
    .map((line) => ({
      description: line.description,
      amountCents: line.amount,
    }));

  const before = new Set(
    (
      await stripe.invoices.list({ subscription: live.id, limit: 100 })
    ).data.map((invoice) => invoice.id)
  );
  // changeTierNow (subscription-service.ts).
  const chargesNow = run.proration === 'always_invoice';
  await stripe.subscriptions.update(live.id, {
    items: [{ id: item.id, price: run.to.id }],
    proration_behavior: run.proration,
    proration_date: run.prorationDate,
    ...(chargesNow && { payment_behavior: 'error_if_incomplete' as const }),
  });
  const cut = (
    await stripe.invoices.list({ subscription: live.id, limit: 100 })
  ).data.filter((invoice) => !before.has(invoice.id));
  if (run.to.interval !== run.moved.interval) {
    // Not a check: what the dialog's "next billed" date can be held to.
    const after = await stripe.subscriptions.retrieve(live.id);
    const day = (seconds: number | undefined) =>
      seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : 'none';
    console.log(
      `  note  the new period: ${day(after.items.data[0]?.current_period_start)} to ${day(after.items.data[0]?.current_period_end)}; switched on ${day(run.prorationDate)}`
    );
  }
  check(
    chargesNow
      ? 'the switch cut one invoice now'
      : 'the switch cut no invoice now',
    cut.length === (chargesNow ? 1 : 0),
    `${cut.length} new`
  );

  // What is charged: the invoice cut now, or else the upcoming one.
  const charged = chargesNow
    ? cut[0]
    : await stripe.invoices.createPreview({ subscription: live.id });
  if (!charged) return;
  const chargedLines =
    chargesNow && charged.id
      ? (await stripe.invoices.listLineItems(charged.id, { limit: 100 })).data
      : charged.lines.data;
  const prorations = chargedLines.filter(
    (line) => prorationOf(line)?.proration === true
  );

  const credit = prorations.find((line) => line.amount < 0);
  const unused =
    (paid.period.end - run.prorationDate) /
    (paid.period.end - paid.period.start);
  const atPaid = -Math.round(run.paid.pence * unused);
  const atCurrent = -Math.round(run.moved.pence * unused);
  check(
    `the credit is the paid ${pounds(run.paid.pence)} for the unused time`,
    credit !== undefined && Math.abs(credit.amount - atPaid) <= 1,
    `credit ${credit?.amount ?? 'none'}, paid x unused ${atPaid}`
  );
  check(
    `and is not the current ${pounds(run.moved.pence)}'s figure`,
    credit !== undefined &&
      Math.abs(atPaid - atCurrent) > 1 &&
      Math.abs(credit.amount - atCurrent) > 1,
    `current x unused ${atCurrent}`
  );
  const credited = credit
    ? prorationOf(credit)?.proration_details?.credited_items
    : null;
  check(
    'credited_items names the paid invoice and its line',
    credited?.invoice === paid.invoice &&
      credited.invoice_line_items.includes(paid.id),
    `credited ${credited?.invoice ?? 'none'}, paid ${paid.invoice}`
  );

  const sameLines =
    dialogLines.length === prorations.length &&
    dialogLines.every((shown) =>
      prorations.some(
        (line) =>
          line.description === shown.description &&
          line.amount === shown.amountCents
      )
    );
  check(
    chargesNow
      ? 'every dialog line is on the invoice, and no other'
      : 'every dialog line is on the upcoming invoice, and no other',
    sameLines,
    dialogLines.map((line) => line.amountCents).join(', ')
  );
  check(
    chargesNow
      ? 'the dialog amount due equals the invoice'
      : 'the dialog amount due is 0, as nothing is charged now',
    preview.amount_due === (chargesNow ? charged.amount_due : 0),
    `dialog ${preview.amount_due}, ${chargesNow ? 'invoice' : 'upcoming'} ${charged.amount_due}`
  );
}

/** A to C: a month on, one member upgrades and one switches to monthly. */
async function bothSwitches(
  kit: Kit,
  run: { clockId: string; now: number; members: [string, string] },
  paid: Plan,
  moved: Plan,
  plans: { annual200: Plan; monthly15: Plan }
): Promise<void> {
  const at = run.now + 30 * DAY;
  await advance(kit.stripe, run.clockId, at);
  await switchAndCheck(kit, {
    label: 'upgrade to annual £200',
    subscriptionId: run.members[0],
    paid,
    moved,
    to: plans.annual200,
    proration: 'always_invoice',
    prorationDate: at,
  });
  await switchAndCheck(kit, {
    label: 'switch to monthly £15',
    subscriptionId: run.members[1],
    paid,
    moved,
    to: plans.monthly15,
    // nowProration: £15 a month is not more than the annual amount paid.
    proration: 'create_prorations',
    prorationDate: at,
  });
}

async function scenarioApplied(
  kit: Kit,
  label: string,
  from: Plan,
  steps: Plan[],
  plans: { annual200: Plan; monthly15: Plan }
): Promise<void> {
  console.log(`\n${label}`);
  const run = await twoMembers(kit, from, label.slice(0, 1));
  let current = from;
  for (const next of steps) {
    // A Studio save archives the Price it replaces.
    await archive(kit, current);
    for (const member of run.members) {
      check(
        `the move to ${pounds(next.pence)} goes on now`,
        (await move(kit, member, next, run.now)) === 'applied'
      );
    }
    current = next;
  }
  await bothSwitches(kit, run, from, current, plans);
}

async function scenarioPending(kit: Kit): Promise<void> {
  console.log(
    '\nD. Monthly £10, a rise to £12 told 27 days before the renewal'
  );
  const p10 = await price(kit, 1_000, 'month');
  const p12 = await price(kit, 1_200, 'month');
  const p20 = await price(kit, 2_000, 'month');
  const annual100 = await price(kit, 10_000, 'year');
  const run = await twoMembers(kit, p10, 'pending');
  const first = await kit.stripe.subscriptions.retrieve(run.members[0]);
  const renewal = first.items.data[0]?.current_period_end ?? 0;
  const noticeAt = renewal - 27 * DAY;
  await advance(kit.stripe, run.clockId, noticeAt);
  await archive(kit, p10);
  for (const member of run.members) {
    check(
      'the rise waits: under 30 days to the renewal',
      (await move(kit, member, p12, noticeAt)) === 'pending'
    );
  }

  await advance(kit.stripe, run.clockId, renewal + 2 * HOUR);
  for (const member of run.members) {
    const renewed = await kit.stripe.subscriptions.retrieve(member);
    const line = await paidLine(kit.stripe, renewed);
    check(
      'the renewal billed the old £10',
      line?.pricing?.price_details?.price === p10.id &&
        line.amount === 1_000 &&
        line.period.start === renewal,
      `line ${line?.amount ?? 'none'}`
    );
    // As the renewal's customer.subscription.updated does in the webhook.
    check(
      'the pending swap lands at that renewal',
      await applyDuePendingPriceChange(kit.stripe, renewed)
    );
  }

  const at = renewal + 15 * DAY;
  await advance(kit.stripe, run.clockId, at);
  await switchAndCheck(kit, {
    label: 'upgrade to monthly £20',
    subscriptionId: run.members[0],
    paid: p10,
    moved: p12,
    to: p20,
    proration: 'always_invoice',
    prorationDate: at,
  });
  await switchAndCheck(kit, {
    label: 'switch to annual £100',
    subscriptionId: run.members[1],
    paid: p10,
    moved: p12,
    to: annual100,
    // nowProration: £100 a year is more than the £12 a month on the row.
    proration: 'always_invoice',
    prorationDate: at,
  });
}

/** The next `price.updated` event for `priceId` created at or after `since`. */
async function priceEvent(
  stripe: Stripe,
  priceId: string,
  since: number,
  seen: Set<string>
): Promise<Stripe.Event | null> {
  const deadline = Date.now() + EVENT_WAIT_MS;
  while (Date.now() < deadline) {
    const events = await stripe.events.list({
      type: 'price.updated',
      created: { gte: since },
      limit: 100,
    });
    const found = events.data
      .filter(
        (event) =>
          (event.data.object as Stripe.Price).id === priceId &&
          !seen.has(event.id)
      )
      .sort((a, b) => a.created - b.created)[0];
    if (found) {
      seen.add(found.id);
      return found;
    }
    await sleep(POLL_MS);
  }
  return null;
}

async function scenarioEvents(kit: Kit): Promise<void> {
  console.log(
    "\nN. The platform's Price updates against a Dashboard-style edit"
  );
  const { stripe } = kit;
  const target = await price(kit, 900, 'month');
  const seen = new Set<string>();
  const since = Math.floor(Date.now() / 1000) - 5;
  const shape = (event: Stripe.Event | null) =>
    JSON.stringify(event?.data.previous_attributes ?? null);
  const observe = async (label: string, ours: boolean) => {
    const event = await priceEvent(stripe, target.id, since, seen);
    check(
      label,
      event !== null && isPlatformPriceWrite(event) === ours,
      `previous_attributes ${shape(event)}`
    );
  };

  await archive(kit, target);
  await observe("a re-price's archive reads as the platform's write", true);
  await ensurePriceActive(stripe, target.id);
  await observe("ensurePriceActive reads as the platform's write", true);
  await stripe.prices.update(target.id, { nickname: 'Edited by hand' });
  await observe('a nickname edit does not', false);
  await stripe.prices.update(target.id, { metadata: { note: 'by hand' } });
  await observe('a metadata edit that leaves the nonce alone does not', false);
  await stripe.prices.update(target.id, { active: false });
  await observe('an archive by hand does not', false);
  await ensurePriceActive(stripe, target.id);
  await observe('a platform write after a hand edit reads as ours', true);
}

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
  const stripe = createStripeClient(key);
  const product = await stripe.products.create({
    name: 'Codex paid price test clock',
    metadata: TAG,
  });
  const kit: Kit = { stripe, product: product.id, prices: [], clocks: [] };
  try {
    const plans = {
      annual200: await price(kit, 20_000, 'year'),
      monthly15: await price(kit, 1_500, 'month'),
    };
    const a100 = await price(kit, 10_000, 'year');
    const a150 = await price(kit, 15_000, 'year');
    await scenarioApplied(
      kit,
      'A. Applied now, a rise: annual £100 paid, £150 early',
      a100,
      [a150],
      plans
    );
    const b150 = await price(kit, 15_000, 'year');
    const b100 = await price(kit, 10_000, 'year');
    await scenarioApplied(
      kit,
      'B. Applied now, a cut: annual £150 paid, £100 early',
      b150,
      [b100],
      plans
    );
    const c100 = await price(kit, 10_000, 'year');
    const c150 = await price(kit, 15_000, 'year');
    const c180 = await price(kit, 18_000, 'year');
    await scenarioApplied(
      kit,
      'C. Two early moves: annual £100 paid, then £150, then £180',
      c100,
      [c150, c180],
      plans
    );
    await scenarioPending(kit);
    await scenarioEvents(kit);
  } finally {
    for (const clockId of kit.clocks) {
      await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
    }
    for (const priceId of kit.prices) {
      await stripe.prices.update(priceId, { active: false }).catch(() => {});
    }
    await stripe.products.update(product.id, { active: false }).catch(() => {});
    const left = await clocksLeft(stripe, kit.clocks);
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
