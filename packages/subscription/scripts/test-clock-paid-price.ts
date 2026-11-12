/**
 * A Stripe test-clock regression proof for a change of plan made now.
 *
 * 1. A switch after an early price move credits the Price the period was PAID
 *    at, not the item's current one (review C1, F5; Codex-2hxff.95, closed as
 *    not a bug on our API version). Stripe credits the invoiced line, which
 *    each credit names in `proration_details.credited_items`. So nothing is
 *    put back before a switch, and the change-plan dialog, a plain preview,
 *    shows exactly what is charged.
 * 2. A switch INTO yearly billing starts a new period today (owner decision,
 *    Codex-2hxff.96). Our subscriptions are in Stripe's flexible billing mode,
 *    which never resets the anchor by itself, so the preview and the write
 *    pass `billing_cycle_anchor: { type: 'now' }`. Stripe refuses
 *    `proration_date` with it, so the credit runs to the write; the confirm
 *    previews again and refuses any figure the dialog did not show ("re-check
 *    at confirm"). A switch into monthly is not proved here: Codex-2hxff.97
 *    makes it wait for the year's end.
 * 3. The platform's own Price updates are told apart from a Dashboard edit
 *    (the false "edited in Stripe Dashboard" alert).
 *
 * Re-run it BEFORE any Stripe apiVersion upgrade. It takes its client from
 * `createStripeClient` (packages/purchase/src/stripe-client.ts), so it runs
 * on whatever version is pinned there, and it checks every subscription it
 * makes is in flexible billing mode. If a new version credits the item's
 * current Price, or the mode changes, these checks fail.
 *
 * It calls the real `schedulePriceChange` (the early move),
 * `applyDuePendingPriceChange` (the pending swap at a renewal),
 * `addMonthsClamped`, `ensurePriceActive`, `platformWriteMetadata` and
 * `isPlatformPriceWrite` (src/services/pending-price-change.ts), and
 * `tierChangeQuote` (src/services/tier-move.ts), on throwaway TEST-mode
 * objects. The preview, the re-check and the switch are the calls
 * `previewNow`, `changeTier` and `changeTierNow` make, with `nowProration`
 * and `startsNewPeriod` (src/services/subscription-service.ts): keep them in
 * step.
 *
 *   A. Applied now, a rise: annual £100 paid, £150 put on early.
 *   B. Applied now, a cut: annual £150 paid, £100 put on early.
 *   C. Two early moves in one period: annual £100 paid, then £150, then £180.
 *      In A to C, 45 days on, the member upgrades to annual £200 (invoiced
 *      now).
 *   D. The pending path: monthly £10, a rise to £12 told 27 days before the
 *      renewal. That renewal bills £10, the swap lands at it, and mid-period
 *      one member upgrades to monthly £20 and one switches to annual £100
 *      (both invoiced now).
 *   E. A dear plan: monthly £1,000 switched to annual £10,000 mid-month. The
 *      confirm 5 minutes after the preview is refused (the figures moved), and
 *      the fresh figures, confirmed at once, are charged to the penny.
 *   N. Price events: the platform's archive and `ensurePriceActive` read as
 *      ours; a nickname edit, a metadata edit and an archive by hand do not.
 *
 * Every change is confirmed 2 hours after its preview (E: 5 minutes), the
 * member reading the dialog, and checks:
 *   - before it, the item is on the moved Price, not the paid one, or the
 *     proof would show nothing;
 *   - the credit is the paid line's unused time (an upgrade's to the
 *     preview's proration_date, a switch into yearly billing's to the write),
 *     and differs from the current Price's figure;
 *   - the credit's `credited_items` names the paid invoice and its line;
 *   - the dialog's lines and amount due (the fresh ones after a refused
 *     confirm) equal the invoice cut now, to the penny, or where none is
 *     cut, the upcoming invoice's lines with 0 due. A switch into yearly
 *     billing lists every line (the new year is an ordinary line beside the
 *     credit), and its lines add up to the amount due and the invoice;
 *   - a switch into yearly billing starts its new period at the write and is
 *     next billed on the dialog's London date; an upgrade keeps its billing
 *     day.
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
  addMonthsClamped,
  applyDuePendingPriceChange,
  ensurePriceActive,
  isPlatformPriceWrite,
  platformWriteMetadata,
  schedulePriceChange,
} from '../src/services/pending-price-change';
import { tierChangeQuote } from '../src/services/tier-move';

const TAG = { codex_env: 'test-clock' };
const DAY = 86_400;
const HOUR = 3_600;
/** How long the member reads the dialog before confirming. */
const READ_DIALOG = 2 * HOUR;
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

const note = (text: string) => console.log(`  note  ${text}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pounds = (pence: number) => `£${pence / 100}`;
/** The London calendar day, as the dialog's date is read. */
const londonDay = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
  });

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

interface Members {
  clockId: string;
  now: number;
  members: string[];
}

/** One clock, `count` customers with a card, each with `plan` paid. */
async function subscribers(
  kit: Kit,
  plan: Plan,
  name: string,
  count: number
): Promise<Members> {
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
    // Both the credit and the anchor rule rest on this mode.
    check(
      'the subscription is in flexible billing mode',
      subscription.billing_mode?.type === 'flexible',
      `billing_mode ${subscription.billing_mode?.type ?? 'none'}`
    );
    return subscription.id;
  };
  const members: string[] = [];
  for (let i = 0; i < count; i++) members.push(await member());
  return { clockId: clock.id, now, members };
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
  clockId: string;
  subscriptionId: string;
  paid: Plan;
  moved: Plan;
  to: Plan;
  /** As `nowProration` decides it for this switch. */
  proration: 'always_invoice' | 'create_prorations';
  /** How long the member reads the dialog before confirming. */
  readFor?: number;
  /** A dear plan: its figures move while the dialog is read, so the confirm is refused. */
  moves?: boolean;
}

/** What the dialog shows for a change previewed at `at`. */
interface Dialog {
  at: number;
  amountDueCents: number;
  lines: Array<{ description: string | null; amountCents: number }>;
  nextBill: number;
  quote: string;
}

/**
 * Preview the change as the dialog does; for a switch of billing period
 * re-check it at the confirm as `changeTier` does (a moved figure is refused,
 * and the member confirms the fresh one at once); write it as `changeTierNow`
 * does; then check the credit against the paid line, the dialog against the
 * charge, and the new period against the dialog's date.
 */
async function switchAndCheck(kit: Kit, run: Switch): Promise<void> {
  const { stripe } = kit;
  console.log(`  -- ${run.label}`);
  const clock = await stripe.testHelpers.testClocks.retrieve(run.clockId);
  const prorationDate = clock.frozen_time;
  const live = await stripe.subscriptions.retrieve(run.subscriptionId);
  const item = live.items.data[0];
  if (!item) {
    check('the subscription has an item', false);
    return;
  }
  // A to D moved the price early; E did not, so the paid Price is the item's.
  const earlyMove = run.moved.id !== run.paid.id;
  check(
    earlyMove
      ? `before the switch the item is on the moved ${pounds(run.moved.pence)}, not the ${pounds(run.paid.pence)} paid`
      : `before the switch the item is on the ${pounds(run.paid.pence)} paid`,
    item.price.id === run.moved.id
  );
  const paid = await paidLine(stripe, live);
  check(
    `the latest invoice billed the ${pounds(run.paid.pence)}`,
    paid?.pricing?.price_details?.price === run.paid.id &&
      paid.amount === run.paid.pence,
    `line ${paid?.amount ?? 'none'}`
  );
  if (!paid) return;

  // startsNewPeriod: a switch INTO yearly billing (interval_switch or
  // cross_period_change). Stripe refuses proration_date with
  // billing_cycle_anchor { type: 'now' }, so it is re-checked at the confirm.
  // A switch into monthly is not proved here: Codex-2hxff.97 makes it wait.
  const newPeriod =
    run.to.interval === 'year' && run.to.interval !== run.moved.interval;
  // previewNow (subscription-service.ts).
  const dialogAt = async (at: number): Promise<Dialog> => {
    const preview = await stripe.invoices.createPreview({
      subscription: live.id,
      subscription_details: {
        items: [{ id: item.id, price: run.to.id }],
        proration_behavior: 'always_invoice',
        ...(newPeriod
          ? { billing_cycle_anchor: { type: 'now' } }
          : { proration_date: at }),
      },
    });
    // A switch into yearly billing lists every line: Stripe bills the new
    // year as an ordinary line beside the credit (previewNow).
    const lines = preview.lines.data
      .filter(
        (line) =>
          newPeriod ||
          line.parent?.subscription_item_details?.proration === true
      )
      .map((line) => ({
        description: line.description,
        amountCents: line.amount,
      }));
    const nextBill = newPeriod
      ? addMonthsClamped(at, run.to.interval === 'year' ? 12 : 1)
      : item.current_period_end;
    return {
      at,
      amountDueCents: preview.amount_due,
      lines,
      nextBill,
      quote: tierChangeQuote({
        amountDueCents: preview.amount_due,
        lineAmountsCents: lines.map((line) => line.amountCents),
        nextBillAt: new Date(nextBill * 1000),
      }),
    };
  };
  let shown = await dialogAt(prorationDate);
  const chargesNow = run.proration === 'always_invoice';

  // The member reads the dialog, then confirms.
  const readFor = run.readFor ?? READ_DIALOG;
  const writeAt = prorationDate + readFor;
  await advance(stripe, run.clockId, writeAt);
  if (newPeriod) {
    // changeTier's re-check: the same preview again, just before the write.
    const again = await dialogAt(writeAt);
    let refused = false;
    if (again.quote !== shown.quote) {
      // TIER_CHANGE_PREVIEW_EXPIRED: nothing is written, and the page shows
      // these fresh figures to confirm.
      refused = true;
    }
    const minutes = `${readFor / 60} minutes`;
    if (run.moves) {
      check(
        `the confirm ${minutes} after the preview is refused: the figures moved`,
        refused,
        `dialog ${shown.quote}; at the confirm ${again.quote}`
      );
    } else {
      note(
        refused
          ? `the confirm ${minutes} on was refused (${shown.quote} became ${again.quote}); the fresh figures are confirmed at once`
          : `the figures held for ${minutes}: confirmed as shown`
      );
    }
    if (refused) {
      check(
        'and nothing was written',
        (await stripe.subscriptions.retrieve(live.id)).items.data[0]?.price
          .id === run.moved.id
      );
      shown = again;
      // Confirmed at once: the re-check runs again at the same moment.
      check(
        'the fresh figures, confirmed at once, pass the re-check',
        (await dialogAt(writeAt)).quote === shown.quote
      );
    }
  }
  const before = new Set(
    (
      await stripe.invoices.list({ subscription: live.id, limit: 100 })
    ).data.map((invoice) => invoice.id)
  );
  // changeTierNow (subscription-service.ts).
  await stripe.subscriptions.update(live.id, {
    items: [{ id: item.id, price: run.to.id }],
    proration_behavior: run.proration,
    ...(newPeriod
      ? { billing_cycle_anchor: { type: 'now' } }
      : { proration_date: prorationDate }),
    ...(chargesNow && { payment_behavior: 'error_if_incomplete' as const }),
  });
  const cut = (
    await stripe.invoices.list({ subscription: live.id, limit: 100 })
  ).data.filter((invoice) => !before.has(invoice.id));
  if (chargesNow) {
    check('the switch cut one invoice now', cut.length === 1, `${cut.length}`);
  } else {
    note(`invoices cut now by this switch: ${cut.length}`);
  }

  // What is charged: the invoice cut now, or else the upcoming one.
  const cutNow = cut[0];
  const charged =
    cutNow ?? (await stripe.invoices.createPreview({ subscription: live.id }));
  const chargedLines = cutNow
    ? (await stripe.invoices.listLineItems(cutNow.id, { limit: 100 })).data
    : charged.lines.data;
  const prorations = chargedLines.filter(
    (line) => prorationOf(line)?.proration === true
  );

  // An upgrade's credit runs to its pinned proration_date; a switch of
  // billing period's to the write.
  const creditTo = newPeriod ? writeAt : prorationDate;
  const credit = prorations.find((line) => line.amount < 0);
  const unusedTo = (at: number) =>
    (paid.period.end - at) / (paid.period.end - paid.period.start);
  const atPaid = -Math.round(run.paid.pence * unusedTo(creditTo));
  const atCurrent = -Math.round(run.moved.pence * unusedTo(creditTo));
  check(
    `the credit is the paid ${pounds(run.paid.pence)} for the unused time to the ${newPeriod ? 'write' : "preview's proration_date"}`,
    credit !== undefined && Math.abs(credit.amount - atPaid) <= 1,
    `credit ${credit?.amount ?? 'none'}, paid x unused ${atPaid}`
  );
  if (earlyMove) {
    check(
      `and is not the current ${pounds(run.moved.pence)}'s figure`,
      credit !== undefined &&
        Math.abs(atPaid - atCurrent) > 1 &&
        Math.abs(credit.amount - atCurrent) > 1,
      `current x unused ${atCurrent}`
    );
  }
  if (!newPeriod) {
    const atWrite = -Math.round(run.paid.pence * unusedTo(writeAt));
    if (Math.abs(atPaid - atWrite) > 1) {
      check(
        "the credit runs to the preview's proration_date, not the later write",
        credit !== undefined && Math.abs(credit.amount - atWrite) > 1,
        `to the write it would be ${atWrite}`
      );
    }
  }
  const credited = credit
    ? prorationOf(credit)?.proration_details?.credited_items
    : null;
  check(
    'credited_items names the paid invoice and its line',
    credited?.invoice === paid.invoice &&
      credited.invoice_line_items.includes(paid.id),
    `credited ${credited?.invoice ?? 'none'}, paid ${paid.invoice}`
  );

  // The dialog shows the prorations, or for a switch into yearly billing
  // every line of the invoice, the new year's own charge included.
  const listed = newPeriod ? chargedLines : prorations;
  const sameLines =
    shown.lines.length === listed.length &&
    shown.lines.every((line) =>
      listed.some(
        (charge) =>
          charge.description === line.description &&
          charge.amount === line.amountCents
      )
    );
  check(
    cutNow
      ? 'every dialog line is on the invoice cut now, to the penny, and no other'
      : 'every dialog line is on the upcoming invoice, and no other',
    sameLines,
    `dialog ${shown.lines.map((line) => line.amountCents).join(', ')}; charged ${listed.map((line) => line.amount).join(', ')}`
  );
  if (newPeriod) {
    const sum = shown.lines.reduce(
      (total, line) => total + line.amountCents,
      0
    );
    check(
      "the dialog's lines add up to its amount due and to the invoice cut now",
      sum === shown.amountDueCents && sum === cutNow?.amount_due,
      `lines ${sum}, dialog due ${shown.amountDueCents}, invoice ${cutNow?.amount_due ?? 'none'}`
    );
  }
  check(
    cutNow
      ? 'the dialog amount due equals the invoice cut now'
      : 'the dialog amount due is 0, as no invoice is cut now',
    shown.amountDueCents === (cutNow ? cutNow.amount_due : 0),
    `dialog ${shown.amountDueCents}, ${cutNow ? 'invoice' : 'upcoming'} ${charged.amount_due}`
  );

  const after = await stripe.subscriptions.retrieve(live.id);
  const period = after.items.data[0];
  if (newPeriod) {
    check(
      'the new period starts at the write',
      period !== undefined &&
        Math.abs(period.current_period_start - writeAt) <= 60,
      `starts ${londonDay(period?.current_period_start ?? 0)}, written ${londonDay(writeAt)}`
    );
  } else {
    check(
      'an upgrade keeps its billing day',
      period?.current_period_end === item.current_period_end
    );
  }
  check(
    "the next bill falls on the dialog's London date",
    period !== undefined &&
      londonDay(period.current_period_end) === londonDay(shown.nextBill),
    `next bill ${londonDay(period?.current_period_end ?? 0)}, dialog ${londonDay(shown.nextBill)}`
  );
}

/** A to C: 45 days on, the member upgrades to annual £200. */
async function upgradeLater(
  kit: Kit,
  run: Members,
  paid: Plan,
  moved: Plan,
  annual200: Plan
): Promise<void> {
  await advance(kit.stripe, run.clockId, run.now + 45 * DAY);
  await switchAndCheck(kit, {
    label: 'upgrade to annual £200',
    clockId: run.clockId,
    subscriptionId: run.members[0],
    paid,
    moved,
    to: annual200,
    proration: 'always_invoice',
  });
}

async function scenarioApplied(
  kit: Kit,
  label: string,
  from: Plan,
  steps: Plan[],
  annual200: Plan
): Promise<void> {
  console.log(`\n${label}`);
  const run = await subscribers(kit, from, label.slice(0, 1), 1);
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
  await upgradeLater(kit, run, from, current, annual200);
}

async function scenarioPending(kit: Kit): Promise<void> {
  console.log(
    '\nD. Monthly £10, a rise to £12 told 27 days before the renewal'
  );
  const p10 = await price(kit, 1_000, 'month');
  const p12 = await price(kit, 1_200, 'month');
  const p20 = await price(kit, 2_000, 'month');
  const annual100 = await price(kit, 10_000, 'year');
  const run = await subscribers(kit, p10, 'pending', 2);
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

  await advance(kit.stripe, run.clockId, renewal + 15 * DAY);
  await switchAndCheck(kit, {
    label: 'upgrade to monthly £20',
    clockId: run.clockId,
    subscriptionId: run.members[0],
    paid: p10,
    moved: p12,
    to: p20,
    proration: 'always_invoice',
  });
  await switchAndCheck(kit, {
    label: 'switch to annual £100',
    clockId: run.clockId,
    subscriptionId: run.members[1],
    paid: p10,
    moved: p12,
    to: annual100,
    // nowProration: £100 a year is more than the £12 a month on the row.
    proration: 'always_invoice',
  });
}

/**
 * E. A dear plan: monthly £1,000, switched mid-month to annual £10,000. Its
 * credit moves about 12p in 5 minutes, so a confirm 5 minutes after the
 * preview is refused; the fresh figures, confirmed at once, are charged to
 * the penny.
 */
async function scenarioDear(kit: Kit): Promise<void> {
  console.log(
    '\nE. A dear plan: monthly £1,000 to annual £10,000, confirmed 5 minutes on'
  );
  const monthly = await price(kit, 100_000, 'month');
  const annual = await price(kit, 1_000_000, 'year');
  const run = await subscribers(kit, monthly, 'dear', 1);
  await advance(kit.stripe, run.clockId, run.now + 15 * DAY);
  await switchAndCheck(kit, {
    label: 'switch to annual £10,000, 5 minutes after the preview',
    clockId: run.clockId,
    subscriptionId: run.members[0],
    // Nothing moved early here: what was paid is what the item carries.
    paid: monthly,
    moved: monthly,
    to: annual,
    // nowProration: £10,000 a year is more than £1,000 a month.
    proration: 'always_invoice',
    readFor: 5 * 60,
    moves: true,
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
    const annual200 = await price(kit, 20_000, 'year');
    const a100 = await price(kit, 10_000, 'year');
    const a150 = await price(kit, 15_000, 'year');
    await scenarioApplied(
      kit,
      'A. Applied now, a rise: annual £100 paid, £150 early',
      a100,
      [a150],
      annual200
    );
    const b150 = await price(kit, 15_000, 'year');
    const b100 = await price(kit, 10_000, 'year');
    await scenarioApplied(
      kit,
      'B. Applied now, a cut: annual £150 paid, £100 early',
      b150,
      [b100],
      annual200
    );
    const c100 = await price(kit, 10_000, 'year');
    const c150 = await price(kit, 15_000, 'year');
    const c180 = await price(kit, 18_000, 'year');
    await scenarioApplied(
      kit,
      'C. Two early moves: annual £100 paid, then £150, then £180',
      c100,
      [c150, c180],
      annual200
    );
    await scenarioPending(kit);
    await scenarioDear(kit);
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
