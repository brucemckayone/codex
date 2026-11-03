/**
 * A Stripe test-clock proof that leaving yearly billing waits for the year's
 * end, with nothing credited (Codex-2hxff.97; data design §1, §8).
 *
 * Each member has one Stripe customer across every org, so a switch's credit
 * for the unused year would pay their next bill anywhere. The change rides a
 * Stripe subscription schedule instead (src/services/billing-change.ts). This
 * runs the REAL `SubscriptionService` (`previewTierChange`, `changeTier`,
 * `keepCurrentPlan`, `cancelSubscription`, `reactivateSubscription`, and at
 * each renewal `handleSubscriptionUpdated`, `applyDuePendingPriceChange` and
 * `applyDueTierMove` in the webhook's order) against TEST-mode Stripe and a
 * THROWAWAY database, and checks after every step that nothing is credited:
 * the customer's balance stays 0 and no invoice starts or ends on credit.
 *
 *   Clock 1, three members on Pro yearly (£120), 230 days into the year:
 *     A. Pro monthly: waits; the renewal bills £12 with no proration lines.
 *        During the wait Pro monthly is repriced to £13: a pending marker,
 *        never a swap (no phase split), landing a month after the switch;
 *        a Pro yearly reprice skips them.
 *     B. Basic monthly: one waiting change; the renewal bills £5 and the
 *        tier flips with the price.
 *     C. Premium monthly (C(b)): Premium yearly now, the part-year
 *        difference paid by card; the renewal bills £20 monthly.
 *   Clock 2, three more:
 *     D. A move to Basic yearly waits; Basic monthly then joins it. The
 *        renewal bills £5 monthly.
 *     K. Pro monthly, then Keep yearly billing: the renewal bills £120 yearly.
 *     R. Pro monthly, cancel, reactivate: the change survives; the renewal
 *        bills £12 monthly.
 *   Clock 3, one member whose subscription carries its own card, as Checkout
 *   sets it (review C1 cycle 2, M1):
 *     M. Pro monthly: the schedule copies the subscription's card (card A).
 *        Then Update card as the portal does it: card B the customer's
 *        default, the subscription's own card cleared. Stripe clears the
 *        schedule's copy with it, so the renewal that starts monthly billing
 *        charges card B, with no step of ours. The card A check first shows
 *        the proof can fail.
 *        NOT proven here: that the hosted portal makes this same call. The
 *        script clears the card through the API (`default_payment_method:
 *        ''`); the portal drive showed only that the portal clears each
 *        subscription's own card (.52 §10), not how.
 *   `--only=card` runs Clock 3 alone.
 *
 * Run from the repo root, through the throwaway-database wrapper, with the
 * dev TEST key in .env.dev:
 *
 *   zsh with-db.sh <worktree> b_<name> pnpm exec tsx --env-file=.env.dev \
 *     packages/subscription/scripts/test-clock-billing-change.ts
 *
 * It refuses any key that is not a test-mode one and any database URL that
 * is not a `b_` throwaway (never printing either). Every Stripe object is
 * tagged `codex_env: test-clock`, so every deployed webhook takes it for
 * another environment's and ignores it; the Prices carry no
 * `codex_organization_id`. The service's own "now" is the clock's frozen
 * time, so its preview and its pinned dates are the clock's. Clocks are
 * deleted (with their customers, subscriptions and schedules), the Prices and
 * Products archived, the rows deleted, and it reports how many clocks are
 * left. Waits are bounded (an advance 2 minutes, every 3 s); advances are at
 * most 55 days once a monthly phase exists (Stripe's two-interval limit).
 * Nothing imports it, so fallow's unused-file finding is suppressed below.
 */

// fallow-ignore-file unused-file

import {
  organizations,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { createStripeClient } from '@codex/purchase';
import { seedTestUsers, setupTestDatabase } from '@codex/test-utils/database';
import {
  createTestOrganizationInput,
  createUniqueSlug,
} from '@codex/test-utils/factories';
import { createTestMoneyDeps } from '@codex/test-utils/money-deps';
import {
  createTestSubscriptionInput,
  createTestTierInput,
} from '@codex/test-utils/subscription-factories';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  addMonthsClamped,
  applyDuePendingPriceChange,
  schedulePriceChange,
} from '../src/services/pending-price-change';
import { SubscriptionService } from '../src/services/subscription-service';

const TAG = { codex_env: 'test-clock' };
const DAY = 86_400;
const HOUR = 3_600;
const STEP = 55 * DAY;
const ADVANCE_WAIT_MS = 120_000;
const POLL_MS = 3_000;

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`
  );
  if (!ok) failures.push(label);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Db = ReturnType<typeof setupTestDatabase>;

interface TierKit {
  id: string;
  name: string;
  monthly: string;
  annual: string;
  monthlyPence: number;
  annualPence: number;
}

interface Kit {
  stripe: Stripe;
  db: Db;
  service: SubscriptionService;
  orgId: string;
  tiers: { basic: TierKit; pro: TierKit; premium: TierKit };
  products: string[];
  prices: string[];
  clocks: string[];
  userIds: string[];
}

interface Member {
  label: string;
  userId: string;
  customerId: string;
  subscriptionId: string;
  rowId: string;
  renewal: number;
  /** Invoices seen so far. */
  invoices: Set<string>;
  /** The subscription's own card, when it was given one (Clock 3). */
  cardId?: string;
}

/** The service's "now" is the clock's: its previews and pins are the clock's. */
let frozen = 0;
const realNow = Date.now.bind(Date);
Date.now = () => (frozen > 0 ? frozen * 1000 : realNow());

async function advance(kit: Kit, clockId: string, to: number): Promise<void> {
  await kit.stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: to,
  });
  const deadline = realNow() + ADVANCE_WAIT_MS;
  while (realNow() < deadline) {
    const clock = await kit.stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') {
      frozen = to;
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`test clock ${clockId} did not finish advancing in time`);
}

/** Advance in steps no longer than 55 days. */
async function advanceTo(kit: Kit, clockId: string, from: number, to: number) {
  let at = from;
  while (at < to) {
    at = Math.min(to, at + STEP);
    await advance(kit, clockId, at);
  }
}

async function tier(
  kit: Pick<Kit, 'stripe' | 'products' | 'prices'>,
  db: Db,
  orgId: string,
  name: string,
  sortOrder: number,
  monthlyPence: number
): Promise<TierKit> {
  const product = await kit.stripe.products.create({
    name: `Codex billing change test clock: ${name}`,
    metadata: TAG,
  });
  kit.products.push(product.id);
  const make = async (pence: number, interval: 'month' | 'year') => {
    const created = await kit.stripe.prices.create({
      product: product.id,
      currency: 'gbp',
      unit_amount: pence,
      recurring: { interval },
      metadata: TAG,
    });
    kit.prices.push(created.id);
    return created.id;
  };
  const annualPence = monthlyPence * 10;
  const monthly = await make(monthlyPence, 'month');
  const annual = await make(annualPence, 'year');
  const [row] = await db
    .insert(subscriptionTiers)
    .values(
      createTestTierInput(orgId, {
        name,
        sortOrder,
        priceMonthly: monthlyPence,
        priceAnnual: annualPence,
        stripeProductId: product.id,
        stripePriceMonthlyId: monthly,
        stripePriceAnnualId: annual,
      })
    )
    .returning();
  if (!row) throw new Error('tier insert returned nothing');
  return { id: row.id, name, monthly, annual, monthlyPence, annualPence };
}

/** A clock and up to three members on Pro yearly, mirrored onto our rows. */
async function clockWith(
  kit: Kit,
  name: string,
  labels: string[],
  options: { ownCard?: boolean } = {}
): Promise<{ clockId: string; t0: number; members: Member[] }> {
  const t0 = Math.floor(realNow() / 1000);
  const clock = await kit.stripe.testHelpers.testClocks.create({
    frozen_time: t0,
    name: `codex billing change: ${name}`,
  });
  kit.clocks.push(clock.id);
  frozen = t0;
  const members: Member[] = [];
  for (const label of labels) {
    const [userId] = await seedTestUsers(kit.db, 1);
    kit.userIds.push(userId);
    // Checkout sets the card on the subscription, not the customer: the
    // ownCard members are made that way.
    const customer = await kit.stripe.customers.create({
      test_clock: clock.id,
      payment_method: 'pm_card_visa',
      ...(!options.ownCard && {
        invoice_settings: { default_payment_method: 'pm_card_visa' },
      }),
      metadata: TAG,
    });
    const cardId = options.ownCard
      ? (
          await kit.stripe.paymentMethods.list({
            customer: customer.id,
            type: 'card',
          })
        ).data[0]?.id
      : undefined;
    if (cardId) {
      await kit.stripe.paymentMethods.update(cardId, { metadata: TAG });
    }
    const sub = await kit.stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: kit.tiers.pro.annual }],
      ...(cardId && { default_payment_method: cardId }),
      metadata: {
        ...TAG,
        codex_tier_id: kit.tiers.pro.id,
        codex_user_id: userId,
      },
    });
    check(
      `${label}: the subscription is in flexible billing mode`,
      sub.billing_mode?.type === 'flexible',
      `billing_mode ${sub.billing_mode?.type ?? 'none'}`
    );
    const item = sub.items.data[0];
    if (!item) throw new Error('no item');
    const amount = kit.tiers.pro.annualPence;
    const [row] = await kit.db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(userId, kit.orgId, kit.tiers.pro.id, {
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customer.id,
          billingInterval: 'year',
          amountCents: amount,
          platformFeeCents: amount / 10,
          organizationFeeCents: 0,
          creatorPayoutCents: amount - amount / 10,
          currentPeriodStart: new Date(item.current_period_start * 1000),
          currentPeriodEnd: new Date(item.current_period_end * 1000),
        })
      )
      .returning();
    if (!row) throw new Error('subscription insert returned nothing');
    const invoices = new Set(
      (await kit.stripe.invoices.list({ subscription: sub.id })).data.map(
        (invoice) => invoice.id
      )
    );
    members.push({
      label,
      userId,
      customerId: customer.id,
      subscriptionId: sub.id,
      rowId: row.id,
      renewal: item.current_period_end,
      invoices,
      cardId,
    });
  }
  return { clockId: clock.id, t0, members };
}

/** Invoices since the last look, oldest first. */
async function newInvoices(kit: Kit, m: Member): Promise<Stripe.Invoice[]> {
  const all = (
    await kit.stripe.invoices.list({
      subscription: m.subscriptionId,
      limit: 100,
    })
  ).data.filter((invoice) => !m.invoices.has(invoice.id));
  for (const invoice of all) m.invoices.add(invoice.id);
  return all.sort((a, b) => a.created - b.created);
}

/** Nothing credited: the balance is 0, and no invoice started or ended on credit. */
async function noCredit(
  kit: Kit,
  m: Member,
  when: string,
  invoices: Stripe.Invoice[] = []
): Promise<void> {
  const customer = await kit.stripe.customers.retrieve(m.customerId);
  const balance = 'balance' in customer ? customer.balance : 0;
  const onCredit = invoices.filter(
    (invoice) =>
      (invoice.starting_balance ?? 0) !== 0 ||
      (invoice.ending_balance ?? 0) !== 0
  );
  check(
    `${m.label} ${when}: balance 0, nothing credited`,
    balance === 0 && onCredit.length === 0,
    `balance ${balance}; invoices on credit ${onCredit.length}`
  );
}

async function live(kit: Kit, m: Member): Promise<Stripe.Subscription> {
  return kit.stripe.subscriptions.retrieve(m.subscriptionId);
}

async function rowOf(kit: Kit, m: Member) {
  const [row] = await kit.db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, m.rowId));
  if (!row) throw new Error('row gone');
  return row;
}

/** Preview, then confirm at once, as the dialog does. */
async function change(
  kit: Kit,
  m: Member,
  target: TierKit,
  interval: 'month' | 'year'
) {
  const preview = await kit.service.previewTierChange(
    m.userId,
    kit.orgId,
    target.id,
    interval
  );
  await kit.service.changeTier(
    m.userId,
    kit.orgId,
    target.id,
    interval,
    preview.prorationDate,
    preview.quote
  );
  return preview;
}

/** A waiting change of billing as it stands at Stripe. */
async function waiting(
  kit: Kit,
  m: Member,
  target: TierKit,
  heldPriceId: string
): Promise<void> {
  const sub = await live(kit, m);
  const item = sub.items.data[0];
  const scheduleId =
    typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  const schedule = scheduleId
    ? await kit.stripe.subscriptionSchedules.retrieve(scheduleId)
    : null;
  check(
    `${m.label}: the paid year runs on (the item is unchanged, to the renewal)`,
    item?.price.id === heldPriceId && item.current_period_end === m.renewal
  );
  check(
    `${m.label}: a schedule of two phases, then monthly ${target.name} from the renewal`,
    schedule?.phases.length === 2 &&
      schedule.phases[1]?.start_date === m.renewal &&
      schedule.phases[1]?.items[0]?.price === target.monthly,
    `${schedule?.phases.length ?? 0} phases`
  );
  check(
    `${m.label}: the schedule is tagged ours, and releases at its end`,
    schedule?.metadata?.codex_billing_change === 'waiting' &&
      schedule.metadata?.codex_env === 'test-clock' &&
      schedule.end_behavior === 'release'
  );
}

/** The renewal, handled in the webhook's order for this event. */
async function renewal(kit: Kit, m: Member): Promise<Stripe.Subscription> {
  const event = await live(kit, m);
  await kit.service.handleSubscriptionUpdated(event);
  await applyDuePendingPriceChange(kit.stripe, event);
  await kit.service.applyDueTierMove(event);
  // The release's own customer.subscription.updated.
  const released = await live(kit, m);
  await kit.service.handleSubscriptionUpdated(released);
  await applyDuePendingPriceChange(kit.stripe, released);
  return live(kit, m);
}

/** The renewal invoice: `pence` billed by card, no proration lines. */
async function renewalBilled(
  kit: Kit,
  m: Member,
  pence: number,
  interval: 'month' | 'year'
): Promise<void> {
  const invoices = await newInvoices(kit, m);
  const cycle = invoices.filter(
    (invoice) => invoice.billing_reason === 'subscription_cycle'
  );
  const [first] = cycle;
  const lines = first
    ? (await kit.stripe.invoices.listLineItems(first.id, { limit: 100 })).data
    : [];
  const prorations = lines.filter(
    (line) => line.parent?.subscription_item_details?.proration === true
  );
  check(
    `${m.label}: the renewal is one invoice of £${pence / 100}, paid by card, no proration lines`,
    cycle.length === 1 &&
      first?.total === pence &&
      first.amount_paid === pence &&
      prorations.length === 0,
    `${cycle.length} cycle invoices; total ${first?.total ?? '-'} paid ${first?.amount_paid ?? '-'}; prorations ${prorations.length}`
  );
  const sub = await live(kit, m);
  check(
    `${m.label}: billed ${interval === 'month' ? 'monthly' : 'yearly'} from the renewal`,
    sub.items.data[0]?.price.recurring?.interval === interval &&
      sub.items.data[0]?.current_period_start === m.renewal
  );
  await noCredit(kit, m, 'at the renewal', invoices);
}

async function clockOne(kit: Kit): Promise<void> {
  console.log('Clock 1: A, B and C(b)');
  const { clockId, t0, members } = await clockWith(kit, 'A B C', [
    'A',
    'B',
    'C',
  ]);
  const [a, b, c] = members;
  if (!a || !b || !c) throw new Error('members');
  const { basic, pro, premium } = kit.tiers;
  const today = t0 + 230 * DAY;
  await advance(kit, clockId, today);

  // A: the same plan, monthly.
  const pa = await change(kit, a, pro, 'month');
  check(
    'A: the dialog says it waits: £0 today, then £12 a month from the renewal',
    pa.amountDueCents === 0 &&
      pa.takesEffect === 'period_end' &&
      pa.billingChange?.amountCents === pro.monthlyPence &&
      pa.billingChange.effectiveAt === new Date(a.renewal * 1000).toISOString()
  );
  await waiting(kit, a, pro, pro.annual);
  check('A: nothing invoiced today', (await newInvoices(kit, a)).length === 0);
  await noCredit(kit, a, 'today');

  // B: a cheaper plan, monthly: one waiting change.
  await change(kit, b, basic, 'month');
  await waiting(kit, b, basic, pro.annual);
  check('B: nothing invoiced today', (await newInvoices(kit, b)).length === 0);
  check(
    'B: access stays on Pro until the renewal',
    (await rowOf(kit, b)).tierId === pro.id &&
      (await live(kit, b)).metadata.codex_tier_id === pro.id
  );
  await noCredit(kit, b, 'today');

  // C(b): a dearer plan, monthly: Premium yearly now, monthly later.
  const pc = await change(kit, c, premium, 'month');
  const cut = await newInvoices(kit, c);
  check(
    'C: one invoice now, paid by card, as the dialog showed',
    cut.length === 1 &&
      cut[0]?.amount_paid === pc.amountDueCents &&
      pc.amountDueCents > 0,
    `invoices ${cut.length}; paid ${cut[0]?.amount_paid ?? '-'}; dialog ${pc.amountDueCents}`
  );
  await waiting(kit, c, premium, premium.annual);
  check(
    'C: Premium now',
    (await rowOf(kit, c)).tierId === premium.id &&
      (await live(kit, c)).metadata.codex_tier_id === premium.id
  );
  await noCredit(kit, c, 'after the upgrade', cut);

  // A price move during the wait: Pro monthly £12 -> £13, Pro yearly £120 -> £130.
  const proM13 = await kit.stripe.prices.create({
    product: (await kit.stripe.prices.retrieve(pro.monthly)).product as string,
    currency: 'gbp',
    unit_amount: 1300,
    recurring: { interval: 'month' },
    metadata: TAG,
  });
  kit.prices.push(proM13.id);
  const moved = await schedulePriceChange(
    kit.stripe,
    {
      stripeSubscriptionId: a.subscriptionId,
      newPriceId: proM13.id,
      newAmountCents: 1300,
      interval: 'month',
      noticeAt: new Date(today * 1000),
      floorFrom: new Date((a.renewal + 1) * 1000),
    },
    async () => true
  );
  check(
    "A: Pro monthly's reprice is a pending marker, quoted at the £12 they will pay",
    moved.kind === 'pending' &&
      'currentAmountCents' in moved &&
      moved.currentAmountCents === pro.monthlyPence,
    JSON.stringify(moved)
  );
  const skipped = await schedulePriceChange(
    kit.stripe,
    {
      stripeSubscriptionId: a.subscriptionId,
      newPriceId: pro.annual,
      newAmountCents: 13000,
      interval: 'year',
      noticeAt: new Date(today * 1000),
    },
    async () => true
  );
  check(
    "A: Pro yearly's reprice skips them (they are leaving it)",
    skipped.kind === 'skipped',
    JSON.stringify(skipped)
  );
  await waiting(kit, a, pro, pro.annual);

  // To the renewal, in steps.
  const at = a.renewal + 3 * HOUR;
  await advanceTo(kit, clockId, today, at);

  for (const [m, target, pence] of [
    [a, pro, pro.monthlyPence],
    [b, basic, basic.monthlyPence],
    [c, premium, premium.monthlyPence],
  ] as const) {
    const after = await renewal(kit, m);
    await renewalBilled(kit, m, pence, 'month');
    const row = await rowOf(kit, m);
    check(
      `${m.label}: the tier is ${target.name}, the row monthly, nothing waiting, the schedule let go`,
      row.tierId === target.id &&
        row.billingInterval === 'month' &&
        row.amountCents === pence &&
        row.pendingTierId === null &&
        row.stripeScheduleId === null &&
        after.schedule === null &&
        after.metadata.codex_tier_id === target.id,
      `tier ${row.tierId === target.id}; interval ${row.billingInterval}; amount ${row.amountCents}; pending ${row.pendingTierId}; schedule ${after.schedule ?? 'none'}`
    );
  }

  // A's reprice lands the month after the switch.
  const aLive = await live(kit, a);
  check(
    "A: after the release, the reprice's Price is on the item for the next renewal",
    aLive.items.data[0]?.price.id === proM13.id,
    `item ${aLive.items.data[0]?.price.id}`
  );
  const next = addMonthsClamped(a.renewal, 1) + 3 * HOUR;
  await advance(kit, clockId, next);
  const monthLater = await newInvoices(kit, a);
  check(
    'A: a month on, £13',
    monthLater.length === 1 && monthLater[0]?.total === 1300,
    `${monthLater.map((invoice) => invoice.total).join(', ')}`
  );
  await noCredit(kit, a, 'a month on', monthLater);
}

async function clockTwo(kit: Kit): Promise<void> {
  console.log('Clock 2: D, Keep and cancel then reactivate');
  const { clockId, t0, members } = await clockWith(kit, 'D K R', [
    'D',
    'K',
    'R',
  ]);
  const [d, k, r] = members;
  if (!d || !k || !r) throw new Error('members');
  const { basic, pro } = kit.tiers;
  const today = t0 + 230 * DAY;
  await advance(kit, clockId, today);

  // D: a move to Basic yearly waits; Basic monthly joins it.
  await change(kit, d, basic, 'year');
  check(
    'D: the move to Basic yearly waits (Basic yearly on the item)',
    (await live(kit, d)).items.data[0]?.price.id === basic.annual
  );
  const pd = await change(kit, d, basic, 'month');
  check(
    'D: the dialog names what it replaces: Basic at £50 a year',
    pd.replaces?.tierId === basic.id &&
      pd.replaces.interval === 'year' &&
      pd.replaces.amountCents === basic.annualPence
  );
  await waiting(kit, d, basic, pro.annual);
  check('D: nothing invoiced today', (await newInvoices(kit, d)).length === 0);
  await noCredit(kit, d, 'today');

  // K: Pro monthly, then Keep yearly billing.
  await change(kit, k, pro, 'month');
  await kit.service.keepCurrentPlan(k.userId, kit.orgId);
  const kept = await live(kit, k);
  check(
    'K: Keep let go of the schedule and cleared the record; still Pro yearly',
    kept.schedule === null &&
      kept.metadata.codex_move_tier_id === undefined &&
      kept.items.data[0]?.price.id === pro.annual &&
      (await rowOf(kit, k)).pendingTierId === null
  );
  check('K: nothing invoiced', (await newInvoices(kit, k)).length === 0);
  await noCredit(kit, k, 'after Keep');

  // R: Pro monthly, cancel, reactivate.
  await change(kit, r, pro, 'month');
  await kit.service.cancelSubscription(r.userId, kit.orgId);
  const cancelled = await live(kit, r);
  check(
    'R: cancel let go of the schedule first and kept the change',
    cancelled.cancel_at_period_end === true &&
      cancelled.schedule === null &&
      cancelled.metadata.codex_move_interval === 'month'
  );
  await kit.service.reactivateSubscription(r.userId, kit.orgId);
  const back = await live(kit, r);
  check(
    'R: reactivate un-cancelled, then set the schedule again',
    back.cancel_at_period_end === false &&
      back.cancel_at === null &&
      back.schedule !== null
  );
  await waiting(kit, r, pro, pro.annual);
  check('R: nothing invoiced', (await newInvoices(kit, r)).length === 0);
  await noCredit(kit, r, 'after reactivate');

  await advanceTo(kit, clockId, today, d.renewal + 3 * HOUR);

  await renewal(kit, d);
  await renewalBilled(kit, d, basic.monthlyPence, 'month');
  check(
    'D: the tier is Basic',
    (await rowOf(kit, d)).tierId === basic.id &&
      (await live(kit, d)).metadata.codex_tier_id === basic.id
  );
  await renewal(kit, k);
  await renewalBilled(kit, k, pro.annualPence, 'year');
  await renewal(kit, r);
  await renewalBilled(kit, r, pro.monthlyPence, 'month');
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

const cardOf = (
  card: string | Stripe.PaymentMethod | null | undefined
): string | null => (typeof card === 'string' ? card : (card?.id ?? null));

async function clockCard(kit: Kit): Promise<void> {
  console.log('Clock 3: Update card while a change of billing waits (M1)');
  const { clockId, t0, members } = await clockWith(kit, 'M card', ['M'], {
    ownCard: true,
  });
  const [m] = members;
  if (!m?.cardId) throw new Error('member or card');
  const { pro } = kit.tiers;
  const today = t0 + 230 * DAY;
  await advance(kit, clockId, today);

  await change(kit, m, pro, 'month');
  await waiting(kit, m, pro, pro.annual);
  const scheduleOf = async () => {
    const sub = await live(kit, m);
    const id =
      typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
    if (!id) throw new Error('no schedule attached');
    return kit.stripe.subscriptionSchedules.retrieve(id);
  };
  check(
    "M: the schedule copied the subscription's own card",
    cardOf((await scheduleOf()).default_settings.default_payment_method) ===
      m.cardId
  );

  // Update card, as the portal does it: card B the customer's default, and
  // the subscription's own card cleared.
  const cardB = await kit.stripe.paymentMethods.attach('pm_card_mastercard', {
    customer: m.customerId,
  });
  await kit.stripe.paymentMethods.update(cardB.id, { metadata: TAG });
  await kit.stripe.customers.update(m.customerId, {
    invoice_settings: { default_payment_method: cardB.id },
  });
  await kit.stripe.subscriptions.update(m.subscriptionId, {
    default_payment_method: '',
  });
  const cleared = cardOf(
    (await scheduleOf()).default_settings.default_payment_method
  );
  check(
    "M: clearing the subscription's card cleared the schedule's copy too",
    cleared === null,
    `the schedule holds ${cleared === m.cardId ? 'card A (the old one)' : (cleared ?? 'no card')}`
  );
  // Its customer.subscription.updated, in the webhook's order: nothing of
  // ours touches the schedule's card.
  const event = await live(kit, m);
  await kit.service.handleSubscriptionUpdated(event);
  await applyDuePendingPriceChange(kit.stripe, event);
  await kit.service.applyDueTierMove(event);
  const after = await scheduleOf();
  const held = cardOf(after.default_settings.default_payment_method);
  check(
    'M: after the webhook the schedule still holds no card, and keeps its two phases',
    held === null && after.phases.length === 2,
    `card ${held === m.cardId ? 'A (the old one)' : (held ?? 'none')}; ${after.phases.length} phases`
  );

  await advanceTo(kit, clockId, today, m.renewal + 3 * HOUR);
  await renewal(kit, m);
  // The cycle invoice's payment, and the card its PaymentIntent used.
  const cycle = (
    await kit.stripe.invoices.list({
      subscription: m.subscriptionId,
      limit: 20,
    })
  ).data.filter((invoice) => invoice.billing_reason === 'subscription_cycle');
  const paid = cycle[0]
    ? await kit.stripe.invoices.retrieve(cycle[0].id, { expand: ['payments'] })
    : null;
  const intent = paid?.payments?.data[0]?.payment?.payment_intent;
  const intentId = typeof intent === 'string' ? intent : intent?.id;
  const paidWith = intentId
    ? cardOf(
        (await kit.stripe.paymentIntents.retrieve(intentId)).payment_method
      )
    : null;
  check(
    'M: the renewal charged card B, the customer default, not the card replaced',
    cycle.length === 1 && paidWith === cardB.id,
    `${cycle.length} cycle invoices; charged ${paidWith === m.cardId ? 'card A (the old one)' : paidWith === cardB.id ? 'card B' : (paidWith ?? 'nothing found')}`
  );
  await renewalBilled(kit, m, pro.monthlyPence, 'month');
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new Error('REFUSING: this proof runs on a Stripe TEST key only');
  }
  const url = process.env.DATABASE_URL_LOCAL_PROXY ?? '';
  if (
    process.env.DB_METHOD !== 'LOCAL_PROXY' ||
    !/\/b_[a-z0-9_]+(\?|$)/.test(url)
  ) {
    throw new Error(
      'REFUSING: this proof writes to a b_ throwaway database only'
    );
  }
  const stripe = createStripeClient(key);
  const db = setupTestDatabase();
  const base = {
    stripe,
    db,
    products: [] as string[],
    prices: [] as string[],
    clocks: [] as string[],
    userIds: [] as string[],
  };
  const [org] = await db
    .insert(organizations)
    .values(
      createTestOrganizationInput({ slug: createUniqueSlug('billing-clock') })
    )
    .returning();
  if (!org) throw new Error('org insert returned nothing');
  try {
    const tiers = {
      basic: await tier(base, db, org.id, 'Basic', 1, 500),
      pro: await tier(base, db, org.id, 'Pro', 2, 1200),
      premium: await tier(base, db, org.id, 'Premium', 3, 2000),
    };
    const service = new SubscriptionService(
      { db, environment: 'test-clock', ...createTestMoneyDeps() },
      stripe
    );
    const kit: Kit = { ...base, service, orgId: org.id, tiers };
    if (!process.argv.includes('--only=card')) {
      await clockOne(kit);
      await clockTwo(kit);
    }
    await clockCard(kit);
  } finally {
    frozen = 0;
    for (const clockId of base.clocks) {
      await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
    }
    for (const priceId of base.prices) {
      await stripe.prices.update(priceId, { active: false }).catch(() => {});
    }
    for (const productId of base.products) {
      await stripe.products
        .update(productId, { active: false })
        .catch(() => {});
    }
    if (base.userIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.userId, base.userIds));
    }
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (base.userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, base.userIds));
    }
    console.log(
      `clocks left: ${await clocksLeft(stripe, base.clocks)} of ${base.clocks.length}`
    );
  }
  console.log(
    failures.length === 0
      ? 'ALL PASS'
      : `${failures.length} FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
