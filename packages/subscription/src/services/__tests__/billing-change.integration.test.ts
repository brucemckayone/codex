/**
 * Leaving yearly billing waits for the year's end (Codex-2hxff.97; data
 * design §2-§5, owner decisions Q1-Q4).
 *
 * Real DB, and a Stripe fake that keeps one live subscription and its
 * schedule the way Stripe does, as the test clocks showed (data design §1):
 * - an update merges metadata ('' deletes a key) and swaps the item's Price;
 *   an idempotency key replays its first response without applying again;
 * - `cancel_at_period_end` is REFUSED while a schedule is attached (P3), so
 *   a cancel that forgets to let go of the schedule fails here as it would
 *   there;
 * - an item write on a scheduled subscription is accepted, and SPLITS the
 *   schedule's phase (P4b): every such write is recorded in `splits`, which
 *   must stay empty;
 * - `from_subscription` on a subscription set to cancel turns the cancel off
 *   (P10), so scheduling before un-cancelling shows;
 * - the renewal under a schedule puts phase 2's Price on and merges its
 *   metadata (P1, P6).
 *
 * The prices are the mockups': Basic £5, Pro £12, Premium £20 a month, or
 * £50, £120, £200 a year. The member is on Pro, billed yearly. Every row
 * hangs off this file's own organisations and subscribers, deleted in
 * afterAll.
 */

import type { VersionedCache } from '@codex/cache';
import {
  organizations,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestMoneyDeps,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  MoveAlreadyLandedError,
  PendingMoveKeepFirstError,
  SubscriptionPaymentRequiredError,
  SubscriptionScheduledElsewhereError,
  TierChangeIntervalWhileMovingError,
  TierChangePreviewExpiredError,
} from '../../errors';
import { applyDuePendingPriceChange } from '../pending-price-change';
import { SubscriptionService } from '../subscription-service';

const DAY = 86_400;

type Tier = typeof subscriptionTiers.$inferSelect;

interface FakePrice {
  amount: number;
  interval: 'month' | 'year';
  archived?: boolean;
}

interface LiveItem {
  id: string;
  price: {
    id: string;
    unit_amount: number;
    recurring: { interval: 'month' | 'year' };
  };
  current_period_start: number;
  current_period_end: number;
}

interface LiveSubscription {
  id: string;
  object: 'subscription';
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  customer: string;
  schedule: string | null;
  metadata: Record<string, string>;
  items: { data: LiveItem[] };
}

interface FakePhase {
  items: Array<{ price: string; quantity: number }>;
  start_date: number;
  end_date: number;
  metadata: Record<string, string>;
}

interface FakeSchedule {
  id: string;
  object: 'subscription_schedule';
  subscription: string;
  status: 'active' | 'released';
  end_behavior: string;
  metadata: Record<string, string>;
  current_phase: { start_date: number; end_date: number } | null;
  phases: FakePhase[];
}

const MONTH = 30 * DAY;

/** Stripe's subscriptions and their schedules, in memory. */
function liveStripe(prices: Map<string, FakePrice>) {
  const stripe = createMockStripe();
  const live = new Map<string, LiveSubscription>();
  const schedules = new Map<string, FakeSchedule>();
  const keys = new Map<string, { params: string; response: unknown }>();
  /** Item writes made while a schedule was attached (proof P4b). */
  const splits: string[] = [];
  /** Every Stripe write, in order, as `kind:id`. */
  const writes: string[] = [];
  const clone = <T>(value: T): T => structuredClone(value);
  let nextSchedule = 1;

  const replayed = (key: string | undefined, params: unknown) => {
    if (!key) return undefined;
    const earlier = keys.get(key);
    const asSent = JSON.stringify(params);
    if (earlier && earlier.params !== asSent) {
      throw Object.assign(
        new Error(
          'Keys for idempotent requests can only be used with the same parameters'
        ),
        { type: 'StripeIdempotencyError', statusCode: 400 }
      );
    }
    return earlier ? { response: clone(earlier.response) } : undefined;
  };
  const remember = (
    key: string | undefined,
    params: unknown,
    response: unknown
  ) => {
    if (key) keys.set(key, { params: JSON.stringify(params), response });
  };
  const subOf = (id: string) => {
    const sub = live.get(id);
    if (!sub) {
      throw Object.assign(new Error('No such subscription'), {
        type: 'StripeInvalidRequestError',
        statusCode: 404,
      });
    }
    return sub;
  };
  const priceOf = (id: string) => {
    const price = prices.get(id);
    if (!price) throw new Error(`no such Price ${id}`);
    return price;
  };

  vi.mocked(stripe.subscriptions.retrieve).mockImplementation((async (
    id: string
  ) => clone(subOf(id))) as unknown as typeof stripe.subscriptions.retrieve);

  vi.mocked(stripe.subscriptions.update).mockImplementation((async (
    id: string,
    params: {
      items?: Array<{ id: string; price: string }>;
      metadata?: Record<string, string>;
      cancel_at_period_end?: boolean;
    },
    options?: { idempotencyKey?: string }
  ) => {
    const again = replayed(options?.idempotencyKey, params);
    if (again) return again.response;
    const sub = subOf(id);
    if (params.cancel_at_period_end !== undefined && sub.schedule) {
      throw Object.assign(
        new Error(
          `The subscription is managed by the subscription schedule \`${sub.schedule}\`, and updating any cancelation behavior directly is not allowed.`
        ),
        { type: 'StripeInvalidRequestError', statusCode: 400 }
      );
    }
    const [item] = sub.items.data;
    if (params.items?.[0] && item) {
      const priceId = params.items[0].price;
      const price = priceOf(priceId);
      if (price.archived) {
        throw Object.assign(new Error('The price specified is inactive.'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        });
      }
      if (sub.schedule) splits.push(`${id}:${priceId}`);
      item.price = {
        id: priceId,
        unit_amount: price.amount,
        recurring: { interval: price.interval },
      };
    }
    for (const [name, value] of Object.entries(params.metadata ?? {})) {
      if (value === '') delete sub.metadata[name];
      else sub.metadata[name] = value;
    }
    if (params.cancel_at_period_end !== undefined) {
      sub.cancel_at_period_end = params.cancel_at_period_end;
      writes.push(`cancel:${params.cancel_at_period_end}`);
    } else {
      writes.push(params.items ? 'update:items' : 'update:metadata');
    }
    const response = clone(sub);
    remember(options?.idempotencyKey, params, response);
    return response;
  }) as unknown as typeof stripe.subscriptions.update);

  const subscriptionSchedules = {
    create: vi.fn(
      async (
        params: { from_subscription: string },
        options?: { idempotencyKey?: string }
      ) => {
        const again = replayed(options?.idempotencyKey, params);
        if (again) return again.response;
        const sub = subOf(params.from_subscription);
        if (sub.schedule) {
          throw Object.assign(
            new Error('The subscription already has a schedule attached.'),
            { type: 'StripeInvalidRequestError', statusCode: 400 }
          );
        }
        const [item] = sub.items.data;
        if (!item) throw new Error('no item');
        const schedule: FakeSchedule = {
          id: `sub_sched_${nextSchedule++}`,
          object: 'subscription_schedule',
          subscription: sub.id,
          status: 'active',
          end_behavior: sub.cancel_at_period_end ? 'cancel' : 'release',
          metadata: {},
          current_phase: {
            start_date: item.current_period_start,
            end_date: item.current_period_end,
          },
          phases: [
            {
              items: [{ price: item.price.id, quantity: 1 }],
              start_date: item.current_period_start,
              end_date: item.current_period_end,
              metadata: {},
            },
          ],
        };
        // P10: from a subscription set to cancel, the cancel moves onto the
        // schedule and the subscription's own flag turns off.
        sub.cancel_at_period_end = false;
        sub.schedule = schedule.id;
        schedules.set(schedule.id, schedule);
        writes.push('schedule:create');
        const response = clone(schedule);
        remember(options?.idempotencyKey, params, response);
        return response;
      }
    ),
    update: vi.fn(
      async (
        id: string,
        params: {
          end_behavior?: string;
          metadata?: Record<string, string>;
          phases: Array<{
            items: Array<{ price: string; quantity?: number }>;
            start_date?: number;
            end_date?: number;
            duration?: { interval: 'month' | 'year'; interval_count: number };
            metadata?: Record<string, string>;
          }>;
        },
        options?: { idempotencyKey?: string }
      ) => {
        const again = replayed(options?.idempotencyKey, params);
        if (again) return again.response;
        const schedule = schedules.get(id);
        if (!schedule || schedule.status !== 'active') {
          throw Object.assign(new Error('No such active schedule'), {
            statusCode: 400,
          });
        }
        let start = params.phases[0]?.start_date ?? 0;
        schedule.phases = params.phases.map((phase) => {
          const startDate = phase.start_date ?? start;
          const endDate =
            phase.end_date ??
            startDate + (phase.duration?.interval === 'year' ? 365 : 30) * DAY;
          start = endDate;
          return {
            items: phase.items.map((i) => ({
              price: i.price,
              quantity: i.quantity ?? 1,
            })),
            start_date: startDate,
            end_date: endDate,
            metadata: phase.metadata ?? {},
          };
        });
        if (params.end_behavior) schedule.end_behavior = params.end_behavior;
        if (params.metadata) schedule.metadata = { ...params.metadata };
        writes.push('schedule:update');
        const response = clone(schedule);
        remember(options?.idempotencyKey, params, response);
        return response;
      }
    ),
    release: vi.fn(
      async (
        id: string,
        _params?: unknown,
        options?: { idempotencyKey?: string }
      ) => {
        const again = replayed(options?.idempotencyKey, { id });
        if (again) return again.response;
        const schedule = schedules.get(id);
        if (!schedule || schedule.status !== 'active') {
          throw Object.assign(new Error('Schedule is not active'), {
            statusCode: 400,
          });
        }
        schedule.status = 'released';
        const sub = live.get(schedule.subscription);
        if (sub) sub.schedule = null;
        writes.push('schedule:release');
        const response = clone(schedule);
        remember(options?.idempotencyKey, { id }, response);
        return response;
      }
    ),
    retrieve: vi.fn(async (id: string) => {
      const schedule = schedules.get(id);
      if (!schedule) throw new Error(`no schedule ${id}`);
      return clone(schedule);
    }),
  };
  (stripe as unknown as Record<string, unknown>).subscriptionSchedules =
    subscriptionSchedules;

  (stripe.prices as unknown as Record<string, unknown>).retrieve = vi.fn(
    async (id: string) => {
      const price = priceOf(id);
      return {
        id,
        active: !price.archived,
        recurring: { interval: price.interval },
      };
    }
  );
  vi.mocked(stripe.prices.update).mockImplementation((async (
    id: string,
    params: { active?: boolean }
  ) => {
    const price = priceOf(id);
    if (params.active !== undefined) price.archived = !params.active;
    return { id, active: !price.archived };
  }) as unknown as typeof stripe.prices.update);

  const createPreview = vi.fn().mockResolvedValue({
    amount_due: 2915,
    lines: {
      data: [
        {
          description: 'Unused time on Pro',
          amount: -4438,
          parent: { subscription_item_details: { proration: true } },
        },
        {
          description: 'Remaining time on Premium',
          amount: 7353,
          parent: { subscription_item_details: { proration: true } },
        },
      ],
    },
  });
  (stripe as unknown as { invoices: Record<string, unknown> }).invoices = {
    ...(stripe as unknown as { invoices: Record<string, unknown> }).invoices,
    createPreview,
  };

  /**
   * The renewal: the next period starts. Under a schedule, phase 2's Price
   * goes on and its metadata merges (P1, P6).
   */
  function renew(id: string): Stripe.Subscription {
    const sub = subOf(id);
    const [item] = sub.items.data;
    if (!item) throw new Error('no item');
    const schedule = sub.schedule ? schedules.get(sub.schedule) : undefined;
    const next = schedule?.phases.find(
      (phase) => phase.start_date === item.current_period_end
    );
    item.current_period_start = item.current_period_end;
    if (schedule && next) {
      const price = next.items[0]?.price ?? item.price.id;
      const fake = priceOf(price);
      item.price = {
        id: price,
        unit_amount: fake.amount,
        recurring: { interval: fake.interval },
      };
      for (const [name, value] of Object.entries(next.metadata)) {
        if (value === '') delete sub.metadata[name];
        else sub.metadata[name] = value;
      }
      schedule.current_phase = {
        start_date: next.start_date,
        end_date: next.end_date,
      };
    }
    item.current_period_end =
      item.current_period_start +
      (item.price.recurring.interval === 'year' ? 365 * DAY : MONTH);
    return clone(sub) as unknown as Stripe.Subscription;
  }

  return {
    stripe,
    live,
    schedules,
    splits,
    writes,
    createPreview,
    subscriptionSchedules,
    renew,
  };
}

describe('leaving yearly billing waits for the year (Codex-2hxff.97)', () => {
  let db: Database;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let fake: ReturnType<typeof liveStripe>;
  let service: SubscriptionService;
  const prices = new Map<string, FakePrice>();

  beforeAll(() => {
    db = setupTestDatabase();
  });

  beforeEach(() => {
    fake = liveStripe(prices);
    service = new SubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        cache: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        } as unknown as VersionedCache,
        waitUntil: () => {},
      },
      fake.stripe
    );
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await db
        .delete(subscriptionPriceMoves)
        .where(inArray(subscriptionPriceMoves.userId, userIds));
    }
    if (orgIds.length > 0) {
      await db
        .update(priceChanges)
        .set({
          supersededById: null,
          supersededAt: null,
          state: 'done',
          doneAt: new Date(),
        })
        .where(inArray(priceChanges.organizationId, orgIds));
      await db
        .delete(priceChanges)
        .where(inArray(priceChanges.organizationId, orgIds));
    }
    if (userIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.userId, userIds));
    }
    if (orgIds.length > 0) {
      await db
        .delete(subscriptionTiers)
        .where(inArray(subscriptionTiers.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await teardownTestDatabase();
  });

  /** Hollow Oak Films: Basic, Pro and Premium, every Price known to the fake. */
  async function hollowOak(slug: string) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(slug) }))
        .returning()
    );
    orgIds.push(org.id);
    const insertTier = async (
      name: string,
      sortOrder: number,
      monthly: number
    ): Promise<Tier> => {
      const tier = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org.id, {
              name,
              sortOrder,
              priceMonthly: monthly,
              priceAnnual: monthly * 10,
            })
          )
          .returning()
      );
      if (tier.stripePriceMonthlyId) {
        prices.set(tier.stripePriceMonthlyId, {
          amount: monthly,
          interval: 'month',
        });
      }
      if (tier.stripePriceAnnualId) {
        prices.set(tier.stripePriceAnnualId, {
          amount: monthly * 10,
          interval: 'year',
        });
      }
      return tier;
    };
    const basic = await insertTier('Basic', 1, 500);
    const pro = await insertTier('Pro', 2, 1200);
    const premium = await insertTier('Premium', 3, 2000);
    return { org, basic, pro, premium };
  }

  /** Alex on `tier`, billed yearly, 230 days into the year. */
  async function yearlyMember(orgId: string, tier: Tier) {
    const userId = takeFirst(await seedTestUsers(db, 1), 'member');
    userIds.push(userId);
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - 230 * DAY;
    const periodEnd = periodStart + 365 * DAY;
    const amount = tier.priceAnnual;
    const platform = Math.floor(amount / 10);
    const orgFee = Math.floor((amount - platform) * 0.15);
    const row = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tier.id, {
            billingInterval: 'year',
            amountCents: amount,
            platformFeeCents: platform,
            organizationFeeCents: orgFee,
            creatorPayoutCents: amount - platform - orgFee,
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
          })
        )
        .returning()
    );
    fake.live.set(row.stripeSubscriptionId, {
      id: row.stripeSubscriptionId,
      object: 'subscription',
      status: 'active',
      cancel_at_period_end: false,
      customer: row.stripeCustomerId,
      schedule: null,
      metadata: {
        codex_user_id: userId,
        codex_organization_id: orgId,
        codex_tier_id: tier.id,
        codex_env: 'test',
      },
      items: {
        data: [
          {
            id: `si_${row.id.slice(0, 8)}`,
            price: {
              id: tier.stripePriceAnnualId ?? 'price_missing',
              unit_amount: amount,
              recurring: { interval: 'year' },
            },
            current_period_start: periodStart,
            current_period_end: periodEnd,
          },
        ],
      },
    });
    return { userId, row, periodEnd };
  }

  async function rowOf(id: string) {
    return takeFirst(
      await db.select().from(subscriptions).where(eq(subscriptions.id, id))
    );
  }

  function liveOf(id: string): LiveSubscription {
    const sub = fake.live.get(id);
    if (!sub) throw new Error('no live subscription');
    return sub;
  }

  function scheduleOf(id: string): FakeSchedule {
    const scheduleId = liveOf(id).schedule;
    const schedule = scheduleId ? fake.schedules.get(scheduleId) : undefined;
    if (!schedule) throw new Error('no schedule attached');
    return schedule;
  }

  // ─── A: the same plan, yearly to monthly ────────────────────────────────

  describe('A: Pro yearly to Pro monthly', () => {
    it('the preview: nothing today, no Stripe preview, the year’s end, and the monthly bill after it', async () => {
      const { org, pro } = await hollowOak('a-preview');
      const { userId, periodEnd } = await yearlyMember(org.id, pro);

      const preview = await service.previewTierChange(
        userId,
        org.id,
        pro.id,
        'month'
      );

      expect(preview).toMatchObject({
        amountDueCents: 0,
        prorationLineItems: [],
        newRecurringAmountCents: 1200,
        newRecurringInterval: 'month',
        isUpgrade: false,
        takesEffect: 'period_end',
        // The year's end: never a month from today (nothing starts today).
        currentPeriodEnd: new Date(periodEnd * 1000),
        billingChange: {
          interval: 'month',
          amountCents: 1200,
          effectiveAt: new Date(periodEnd * 1000).toISOString(),
        },
        replaces: null,
      });
      expect(preview).not.toHaveProperty('quote');
      expect(fake.createPreview).not.toHaveBeenCalled();
    });

    it('confirm: the record first, then the schedule; the year runs on and nothing is swapped', async () => {
      const { org, pro } = await hollowOak('a-commit');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);

      await service.changeTier(userId, org.id, pro.id, 'month');

      expect(fake.writes).toEqual([
        'update:metadata',
        'schedule:create',
        'schedule:update',
      ]);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.items.data[0]?.price.id).toBe(pro.stripePriceAnnualId);
      expect(stripeSide.metadata).toMatchObject({
        codex_tier_id: pro.id,
        codex_move_tier_id: pro.id,
        codex_move_at: String(periodEnd),
        codex_hold_price_id: pro.stripePriceAnnualId,
        codex_hold_amount: '12000',
        codex_move_interval: 'month',
        codex_move_price_id: pro.stripePriceMonthlyId,
        codex_move_amount: '1200',
      });

      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.metadata).toMatchObject({
        codex_env: 'test',
        codex_billing_change: 'waiting',
        codex_subscription_id: row.id,
      });
      expect(schedule.end_behavior).toBe('release');
      expect(schedule.phases).toHaveLength(2);
      expect(schedule.phases[0]).toMatchObject({
        items: [{ price: pro.stripePriceAnnualId }],
        end_date: periodEnd,
      });
      expect(schedule.phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
        start_date: periodEnd,
        metadata: { codex_tier_id: pro.id, codex_move_tier_id: '' },
      });
      // A price change on the target, written during the wait, survives.
      expect(schedule.phases[1]?.metadata).not.toHaveProperty(
        'codex_pending_price_id'
      );

      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        tierId: pro.id,
        billingInterval: 'year',
        amountCents: 12000,
        pendingTierId: pro.id,
        pendingTierFrom: new Date(periodEnd * 1000),
        heldAmountCents: 12000,
        pendingBillingInterval: 'month',
        pendingAmountCents: 1200,
        stripeScheduleId: schedule.id,
      });

      const current = await service.getSubscription(userId, org.id);
      expect(current?.pendingTierChange).toMatchObject({
        kind: 'billing',
        tierId: pro.id,
        amountCents: 1200,
        billingInterval: 'month',
        effectiveAt: new Date(periodEnd * 1000).toISOString(),
      });
      expect(current?.amountCents).toBe(12000);
    });

    it('a monthly price saved between the preview and confirm is refused before Stripe; the fresh preview’s goes through (review C1 cycle 2, L4)', async () => {
      const { org, pro } = await hollowOak('a-repriced');
      const { userId, row } = await yearlyMember(org.id, pro);
      const preview = await service.previewTierChange(
        userId,
        org.id,
        pro.id,
        'month'
      );

      // The creator saves Pro monthly at £15 while the dialog shows £12.
      const repriced = `${pro.stripePriceMonthlyId}_repriced`;
      prices.set(repriced, { amount: 1500, interval: 'month' });
      await db
        .update(subscriptionTiers)
        .set({ priceMonthly: 1500, stripePriceMonthlyId: repriced })
        .where(eq(subscriptionTiers.id, pro.id));

      const refused = await service
        .changeTier(
          userId,
          org.id,
          pro.id,
          'month',
          preview.prorationDate,
          undefined,
          preview.newRecurringAmountCents
        )
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(TierChangePreviewExpiredError);
      expect(fake.writes).toEqual([]);
      expect((await rowOf(row.id)).pendingBillingInterval).toBeNull();

      const fresh = await service.previewTierChange(
        userId,
        org.id,
        pro.id,
        'month'
      );
      expect(fresh.billingChange?.amountCents).toBe(1500);
      await service.changeTier(
        userId,
        org.id,
        pro.id,
        'month',
        fresh.prorationDate,
        undefined,
        fresh.newRecurringAmountCents
      );
      expect(scheduleOf(row.stripeSubscriptionId).phases[1]).toMatchObject({
        items: [{ price: repriced }],
      });
      expect((await rowOf(row.id)).pendingAmountCents).toBe(1500);
    });

    it('the renewal: the schedule bills Pro monthly, we let go of it, and the row mirrors it', async () => {
      const { org, pro } = await hollowOak('a-renewal');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      const scheduleId = scheduleOf(row.stripeSubscriptionId).id;

      const event = fake.renew(row.stripeSubscriptionId);
      await service.handleSubscriptionUpdated(event);
      const outcome = await service.applyDueTierMove(event);

      expect(outcome).toBe('applied');
      expect(fake.subscriptionSchedules.release).toHaveBeenCalledWith(
        scheduleId,
        {},
        { idempotencyKey: `billing-release_${scheduleId}` }
      );
      expect(liveOf(row.stripeSubscriptionId).schedule).toBeNull();
      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        tierId: pro.id,
        billingInterval: 'month',
        amountCents: 1200,
        pendingTierId: null,
        pendingBillingInterval: null,
        pendingAmountCents: null,
        stripeScheduleId: null,
      });
      expect(fake.splits).toEqual([]);
    });

    it('Keep yearly billing: the schedule goes, the record goes, no item write, nothing charged', async () => {
      const { org, pro } = await hollowOak('a-keep');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      fake.writes.length = 0;

      await service.keepCurrentPlan(userId, org.id);

      expect(fake.writes).toEqual(['schedule:release', 'update:metadata']);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.schedule).toBeNull();
      expect(Object.keys(stripeSide.metadata).sort()).toEqual([
        'codex_env',
        'codex_organization_id',
        'codex_tier_id',
        'codex_user_id',
      ]);
      expect(stripeSide.items.data[0]?.price.id).toBe(pro.stripePriceAnnualId);
      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        amountCents: 12000,
        pendingTierId: null,
        heldAmountCents: null,
        pendingBillingInterval: null,
        stripeScheduleId: null,
      });
      expect(
        (await service.getSubscription(userId, org.id))?.pendingTierChange
      ).toBeNull();
    });

    // Part A rule 3, for a change of billing: a yearly price change made
    // while they waited skipped them (they were leaving it), so Keep hands
    // them to the price-change step, which gives the usual 30 days' notice.
    it('Keep yearly billing after a yearly price change made while they waited: one due row, so the notice and 30 days follow', async () => {
      const { org, pro } = await hollowOak('a-keep-rejoin');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      const repriced = `${pro.stripePriceAnnualId}_v2`;
      await db
        .update(subscriptionTiers)
        .set({ priceAnnual: 13000, stripePriceAnnualId: repriced })
        .where(eq(subscriptionTiers.id, pro.id));

      await service.keepCurrentPlan(userId, org.id);

      const [change] = await db
        .select()
        .from(priceChanges)
        .where(eq(priceChanges.tierId, pro.id));
      expect(change).toMatchObject({
        kind: 'tier',
        interval: 'year',
        fromAmountCents: 12000,
        newAmountCents: 13000,
        newStripePriceId: repriced,
        state: 'running',
      });
      expect(
        await db
          .select()
          .from(subscriptionPriceMoves)
          .where(eq(subscriptionPriceMoves.subscriptionId, row.id))
      ).toEqual([
        expect.objectContaining({
          priceChangeId: change?.id,
          state: 'due',
          source: 'keep_current_plan',
        }),
      ]);
    });

    it('a yearly price change they were told of before switching is parked by the change, live again on Keep, and nobody is told twice', async () => {
      const { org, pro } = await hollowOak('a-keep-parked');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      const repriced = `${pro.stripePriceAnnualId}_v2`;
      await db
        .update(subscriptionTiers)
        .set({ priceAnnual: 13000, stripePriceAnnualId: repriced })
        .where(eq(subscriptionTiers.id, pro.id));
      const live = liveOf(row.stripeSubscriptionId);
      live.metadata = {
        ...live.metadata,
        codex_pending_price_id: repriced,
        codex_pending_price_from: String(periodEnd),
      };

      await service.changeTier(userId, org.id, pro.id, 'month');
      // Parked: a yearly marker never reaches the monthly item.
      expect(liveOf(row.stripeSubscriptionId).metadata).toMatchObject({
        codex_hold_pending_price_id: repriced,
        codex_hold_pending_price_from: String(periodEnd),
      });
      expect(
        liveOf(row.stripeSubscriptionId).metadata.codex_pending_price_id
      ).toBeUndefined();

      await service.keepCurrentPlan(userId, org.id);

      const metadata = liveOf(row.stripeSubscriptionId).metadata;
      expect(metadata).toMatchObject({
        codex_pending_price_id: repriced,
        codex_pending_price_from: String(periodEnd),
      });
      expect(metadata.codex_hold_pending_price_id).toBeUndefined();
      expect(
        await db
          .select()
          .from(subscriptionPriceMoves)
          .where(eq(subscriptionPriceMoves.subscriptionId, row.id))
      ).toEqual([]);
    });

    it('Keep after the renewal it lands on: refused, the change has happened', async () => {
      const { org, pro } = await hollowOak('a-keep-late');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      // The renewal passed, but phase 2's metadata never reached it.
      const item = liveOf(row.stripeSubscriptionId).items.data[0];
      if (!item) throw new Error('no item');
      item.current_period_start = periodEnd;

      await expect(service.keepCurrentPlan(userId, org.id)).rejects.toThrow(
        MoveAlreadyLandedError
      );
    });

    it('their own plan on yearly while it waits is Keep first; a cheaper pick names what it replaces', async () => {
      const { org, pro, basic } = await hollowOak('a-own-plan');
      const { userId } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');

      await expect(
        service.changeTier(userId, org.id, pro.id, 'year')
      ).rejects.toThrow(PendingMoveKeepFirstError);
      await expect(
        service.previewTierChange(userId, org.id, basic.id, 'month')
      ).resolves.toMatchObject({ replaces: { tierId: pro.id } });
    });
  });

  // ─── Cancel and reactivate (T4) ─────────────────────────────────────────

  describe('cancel and reactivate while a change of billing waits (§4.3)', () => {
    it('cancel lets go of the schedule first (Stripe refuses otherwise) and keeps the record', async () => {
      const { org, pro } = await hollowOak('cancel');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      fake.writes.length = 0;

      await service.cancelSubscription(userId, org.id);

      expect(fake.writes).toEqual(['schedule:release', 'cancel:true']);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.cancel_at_period_end).toBe(true);
      expect(stripeSide.metadata.codex_move_interval).toBe('month');
      const stored = await rowOf(row.id);
      expect(stored.status).toBe('cancelling');
      expect(stored.pendingBillingInterval).toBe('month');
      expect(stored.stripeScheduleId).toBeNull();
    });

    it('reactivate un-cancels, THEN schedules again: the change survives (T4, P10)', async () => {
      const { org, pro } = await hollowOak('reactivate');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      await service.cancelSubscription(userId, org.id);
      fake.writes.length = 0;

      await service.reactivateSubscription(userId, org.id);

      expect(fake.writes).toEqual([
        'cancel:false',
        'schedule:create',
        'schedule:update',
      ]);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.cancel_at_period_end).toBe(false);
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.end_behavior).toBe('release');
      expect(schedule.phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
        start_date: periodEnd,
      });
      const stored = await rowOf(row.id);
      expect(stored.status).toBe('active');
      expect(stored.stripeScheduleId).toBe(schedule.id);
    });

    it("reactivate whose schedule can't be set still reactivates; the backstop sets it, making no call when healthy", async () => {
      const { org, pro } = await hollowOak('reactivate-fails');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      await service.cancelSubscription(userId, org.id);
      fake.subscriptionSchedules.create.mockRejectedValueOnce(
        Object.assign(new Error('Stripe is down'), { statusCode: 500 })
      );

      await service.reactivateSubscription(userId, org.id);

      expect(liveOf(row.stripeSubscriptionId).schedule).toBeNull();
      expect((await rowOf(row.id)).stripeScheduleId).toBeNull();

      const first = await service.runTierMoveBackstop({ limit: 50 });
      expect(first.rescheduled).toBeGreaterThanOrEqual(1);
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect((await rowOf(row.id)).stripeScheduleId).toBe(schedule.id);

      // Healthy now: the second run asks Stripe nothing for this member.
      vi.mocked(fake.stripe.subscriptions.retrieve).mockClear();
      const second = await service.runTierMoveBackstop({ limit: 50 });
      expect(second.rescheduled).toBe(0);
      expect(
        vi
          .mocked(fake.stripe.subscriptions.retrieve)
          .mock.calls.filter(([id]) => id === row.stripeSubscriptionId)
      ).toEqual([]);
    });
  });

  // Review C1 cycle 2, L1: a Cancel that lands between the backstop's read
  // and its from_subscription create is put back, and no schedule is set.
  describe('a Cancel during the backstop', () => {
    it('the create finds the subscription set to cancel: the schedule goes, the cancel is back, and the row stays cancelling', async () => {
      const { org, pro } = await hollowOak('backstop-cancel-race');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      // The schedule lost (as a reactivate whose create failed leaves it).
      const lost = scheduleOf(row.stripeSubscriptionId);
      lost.status = 'released';
      liveOf(row.stripeSubscriptionId).schedule = null;
      await db
        .update(subscriptions)
        .set({ stripeScheduleId: null })
        .where(eq(subscriptions.id, row.id));
      // The backstop reads the subscription not cancelling; the member's
      // Cancel lands right after, before the create.
      const retrieve = vi.mocked(fake.stripe.subscriptions.retrieve);
      const real = retrieve.getMockImplementation();
      let raced = false;
      retrieve.mockImplementation((async (id: string) => {
        if (id === row.stripeSubscriptionId && !raced) {
          raced = true;
          const before = structuredClone(liveOf(id));
          liveOf(id).cancel_at_period_end = true;
          // The Cancel's own write marks the row cancelling.
          await db
            .update(subscriptions)
            .set({ status: 'cancelling', cancelAtPeriodEnd: true })
            .where(eq(subscriptions.id, row.id));
          return before;
        }
        return real?.(id);
      }) as unknown as typeof fake.stripe.subscriptions.retrieve);
      fake.writes.length = 0;

      const result = await service.runTierMoveBackstop({ limit: 50 });

      expect(result.rescheduled).toBe(0);
      expect(fake.writes).toEqual([
        'schedule:create',
        'schedule:release',
        'cancel:true',
      ]);
      const after = liveOf(row.stripeSubscriptionId);
      expect(after.schedule).toBeNull();
      expect(after.cancel_at_period_end).toBe(true);
      // Cycle 3, L1 nit: the backstop's read, from before the Cancel, is
      // not mirrored back over the row.
      expect(await rowOf(row.id)).toMatchObject({
        stripeScheduleId: null,
        status: 'cancelling',
        cancelAtPeriodEnd: true,
      });
    });
  });

  // Review C1 cycle 2, L2: our schedule left half made (untagged, the paid
  // year only, so the year would renew yearly), or carrying an earlier
  // choice, is finished in place; never against a later cancel or Keep.
  describe("a schedule that doesn't carry the waiting change", () => {
    const down = (message: string) =>
      Object.assign(new Error(message), { statusCode: 500 });
    const spy = () => vi.fn<(...args: unknown[]) => void>();
    let alert = spy();
    let sent = spy();

    beforeEach(() => {
      const internals = service as unknown as Record<string, unknown> & {
        obs: { error: (...args: unknown[]) => void };
      };
      alert = spy();
      internals.obs.error = alert;
      sent = spy();
      internals.mailer = sent;
      internals.payoutMailer = sent;
    });

    /** One customer.subscription.updated, in the webhook's order. */
    async function eventPass(id: string) {
      const event = structuredClone(
        liveOf(id)
      ) as unknown as Stripe.Subscription;
      await service.handleSubscriptionUpdated(event);
      await applyDuePendingPriceChange(fake.stripe, event);
      return service.applyDueTierMove(event);
    }

    /** Pro yearly to Basic monthly, its schedule left half made (SF-3's path). */
    async function halfMade(slug: string) {
      const { org, pro, basic } = await hollowOak(slug);
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        down('Stripe is down')
      );
      fake.subscriptionSchedules.release.mockRejectedValueOnce(
        down('Stripe is still down')
      );
      await expect(
        service.changeTier(userId, org.id, basic.id, 'month')
      ).rejects.toThrow();
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.metadata).toEqual({});
      expect(schedule.phases).toHaveLength(1);
      alert.mockClear();
      return { org, pro, basic, userId, row, periodEnd, schedule };
    }

    it('the next event finishes it in place, the event that update fires writes nothing, and the renewal bills Basic monthly', async () => {
      const { basic, row, periodEnd, schedule } = await halfMade('l2-finish');
      const before = fake.writes.length;

      expect(await eventPass(row.stripeSubscriptionId)).toBe('not_due');

      expect(fake.writes.slice(before)).toEqual(['schedule:update']);
      expect(fake.subscriptionSchedules.update).toHaveBeenLastCalledWith(
        schedule.id,
        expect.anything(),
        {
          idempotencyKey: `billing-sched-set_${schedule.id}_${basic.stripePriceMonthlyId}_${periodEnd}_finish-none`,
        }
      );
      const finished = scheduleOf(row.stripeSubscriptionId);
      expect(finished.metadata).toMatchObject({
        codex_billing_change: 'waiting',
        codex_subscription_id: row.id,
      });
      expect(finished.phases).toHaveLength(2);
      expect(finished.phases[1]).toMatchObject({
        items: [{ price: basic.stripePriceMonthlyId }],
        metadata: { codex_tier_id: basic.id },
      });

      // Our update's own event: finished, so no write (no loop).
      const settled = fake.writes.length;
      expect(await eventPass(row.stripeSubscriptionId)).toBe('not_due');
      expect(fake.writes.length).toBe(settled);

      const renewed = fake.renew(row.stripeSubscriptionId);
      await service.handleSubscriptionUpdated(renewed);
      expect(await service.applyDueTierMove(renewed)).toBe('applied');
      expect(await rowOf(row.id)).toMatchObject({
        tierId: basic.id,
        billingInterval: 'month',
        amountCents: 500,
        pendingBillingInterval: null,
      });
      expect(alert).not.toHaveBeenCalled();
      expect(sent).not.toHaveBeenCalled();
    });

    it("an update in place that failed, its record not put back: the next event moves phase 2 to the record's choice", async () => {
      const { org, pro, basic } = await hollowOak('l2-earlier');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      const schedule = scheduleOf(row.stripeSubscriptionId);
      // Basic monthly next: the record goes on, the phase update fails, and
      // putting the record back fails too.
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        down('Stripe is down')
      );
      const update = vi.mocked(fake.stripe.subscriptions.update);
      const realUpdate = update.getMockImplementation()!;
      let calls = 0;
      update.mockImplementation(((...args: Parameters<typeof realUpdate>) => {
        calls += 1;
        return calls === 2
          ? Promise.reject(down('Stripe is still down'))
          : realUpdate(...args);
      }) as typeof realUpdate);
      await expect(
        service.changeTier(userId, org.id, basic.id, 'month')
      ).rejects.toThrow();
      update.mockImplementation(realUpdate);
      expect(liveOf(row.stripeSubscriptionId).metadata).toMatchObject({
        codex_move_tier_id: basic.id,
        codex_move_price_id: basic.stripePriceMonthlyId,
      });
      expect(scheduleOf(row.stripeSubscriptionId).phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
      });

      await eventPass(row.stripeSubscriptionId);

      const fixed = scheduleOf(row.stripeSubscriptionId);
      expect(fixed.id).toBe(schedule.id);
      expect(fixed.phases[1]).toMatchObject({
        items: [{ price: basic.stripePriceMonthlyId }],
        metadata: { codex_tier_id: basic.id },
      });
      expect(fake.subscriptionSchedules.update).toHaveBeenLastCalledWith(
        schedule.id,
        expect.anything(),
        {
          idempotencyKey: `billing-sched-set_${schedule.id}_${basic.stripePriceMonthlyId}_${periodEnd}_finish-${pro.stripePriceMonthlyId}`,
        }
      );
    });

    it('never against a cancel moved onto it: it is let go and the cancel put back, not finished', async () => {
      const { row, schedule } = await halfMade('l2-cancel-moved');
      // L1's leftover: a Cancel moved onto the schedule (P10), not put back.
      const held = fake.schedules.get(schedule.id);
      if (!held) throw new Error('no schedule');
      held.end_behavior = 'cancel';
      const before = fake.writes.length;

      await eventPass(row.stripeSubscriptionId);

      expect(fake.writes.slice(before)).toEqual([
        'schedule:release',
        'cancel:true',
      ]);
      expect(liveOf(row.stripeSubscriptionId)).toMatchObject({
        schedule: null,
        cancel_at_period_end: true,
      });
    });

    it('never against a subscription set to cancel: it is let go and the record kept, not finished', async () => {
      const { row } = await halfMade('l2-cancelling');
      liveOf(row.stripeSubscriptionId).cancel_at_period_end = true;
      const before = fake.writes.length;

      await eventPass(row.stripeSubscriptionId);

      expect(fake.writes.slice(before)).toEqual(['schedule:release']);
      const after = liveOf(row.stripeSubscriptionId);
      expect(after.schedule).toBeNull();
      expect(after.cancel_at_period_end).toBe(true);
      expect(after.metadata.codex_move_interval).toBe('month');
    });

    it('never against Keep: Keep lets it go, and the next event and the backstop set nothing', async () => {
      const { org, userId, row } = await halfMade('l2-keep');
      await service.keepCurrentPlan(userId, org.id);
      const before = fake.writes.length;

      await eventPass(row.stripeSubscriptionId);
      await service.runTierMoveBackstop({ limit: 50 });

      expect(fake.writes.slice(before)).toEqual([]);
      expect(liveOf(row.stripeSubscriptionId).schedule).toBeNull();
    });

    // Cycle 3, L2-a: the backstop reads, the member presses Keep (nothing to
    // let go yet), then the backstop creates from its stale read.
    it('never against a Keep between the backstop’s read and its create: the schedule made goes', async () => {
      const { org, pro } = await hollowOak('l2a-keep-race');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      // The schedule lost (as a reactivate whose create failed leaves it).
      scheduleOf(row.stripeSubscriptionId).status = 'released';
      liveOf(row.stripeSubscriptionId).schedule = null;
      await db
        .update(subscriptions)
        .set({ stripeScheduleId: null })
        .where(eq(subscriptions.id, row.id));
      const retrieve = vi.mocked(fake.stripe.subscriptions.retrieve);
      const real = retrieve.getMockImplementation();
      let raced = false;
      retrieve.mockImplementation((async (id: string) => {
        if (id === row.stripeSubscriptionId && !raced) {
          raced = true;
          const before = structuredClone(liveOf(id));
          await service.keepCurrentPlan(userId, org.id);
          return before;
        }
        return real?.(id);
      }) as unknown as typeof fake.stripe.subscriptions.retrieve);
      fake.writes.length = 0;

      const result = await service.runTierMoveBackstop({ limit: 50 });

      expect(result.rescheduled).toBe(0);
      expect(fake.writes).toEqual([
        'update:metadata',
        'schedule:create',
        'schedule:update',
        'schedule:release',
      ]);
      const after = liveOf(row.stripeSubscriptionId);
      expect(after.schedule).toBeNull();
      expect(after.metadata).not.toHaveProperty('codex_move_interval');
      expect(await rowOf(row.id)).toMatchObject({
        pendingBillingInterval: null,
        stripeScheduleId: null,
      });
    });

    it('a create whose answer was lost is taken up and finished: the change is set and nothing is put back', async () => {
      const { org, pro } = await hollowOak('l2-adopt');
      const { userId, row } = await yearlyMember(org.id, pro);
      const create = fake.subscriptionSchedules.create;
      const realCreate = create.getMockImplementation()!;
      create.mockImplementationOnce(async (params, options) => {
        await realCreate(params, options);
        throw Object.assign(new Error('socket hang up'), {
          type: 'StripeConnectionError',
        });
      });

      await service.changeTier(userId, org.id, pro.id, 'month');

      expect(fake.writes).toEqual([
        'update:metadata',
        'schedule:create',
        'schedule:update',
      ]);
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.metadata).toMatchObject({
        codex_billing_change: 'waiting',
      });
      expect(schedule.phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
      });
      expect(await rowOf(row.id)).toMatchObject({
        pendingBillingInterval: 'month',
        stripeScheduleId: schedule.id,
      });
    });

    it('a refusal is never taken up, even with a schedule there beside our record (one made in the Dashboard meanwhile)', async () => {
      const { org, pro } = await hollowOak('l2-refused');
      const { userId, row } = await yearlyMember(org.id, pro);
      const create = fake.subscriptionSchedules.create;
      const realCreate = create.getMockImplementation()!;
      create.mockImplementationOnce(async (params, options) => {
        await realCreate(params, options);
        throw Object.assign(
          new Error('The subscription already has a schedule attached.'),
          { type: 'StripeInvalidRequestError', statusCode: 400 }
        );
      });

      await expect(
        service.changeTier(userId, org.id, pro.id, 'month')
      ).rejects.toThrow();

      expect(fake.writes).toEqual([
        'update:metadata',
        'schedule:create',
        'update:metadata',
      ]);
      expect(liveOf(row.stripeSubscriptionId).metadata).not.toHaveProperty(
        'codex_move_interval'
      );
    });

    it("a lost answer is not taken up when the schedule there carries a tag that isn't ours", async () => {
      const { org, pro } = await hollowOak('l2-foreign');
      const { userId, row } = await yearlyMember(org.id, pro);
      const create = fake.subscriptionSchedules.create;
      const realCreate = create.getMockImplementation()!;
      create.mockImplementationOnce(async (params, options) => {
        const made = (await realCreate(params, options)) as FakeSchedule;
        const stored = fake.schedules.get(made.id);
        if (stored) stored.metadata = { made_by: 'dashboard' };
        throw Object.assign(new Error('socket hang up'), {
          type: 'StripeConnectionError',
        });
      });

      await expect(
        service.changeTier(userId, org.id, pro.id, 'month')
      ).rejects.toThrow();

      expect(fake.writes).toEqual([
        'update:metadata',
        'schedule:create',
        'update:metadata',
      ]);
      expect(liveOf(row.stripeSubscriptionId).metadata).not.toHaveProperty(
        'codex_move_interval'
      );
    });

    it('the hourly backstop finishes one it finds half made beside a row without it', async () => {
      const { org, pro } = await hollowOak('l2-backstop');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      await service.cancelSubscription(userId, org.id);
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        down('Stripe is down')
      );
      fake.subscriptionSchedules.release.mockRejectedValueOnce(
        down('Stripe is still down')
      );
      await service.reactivateSubscription(userId, org.id);
      const half = scheduleOf(row.stripeSubscriptionId);
      expect(half.phases).toHaveLength(1);
      expect((await rowOf(row.id)).stripeScheduleId).toBeNull();

      const run = await service.runTierMoveBackstop({ limit: 50 });

      expect(run.rescheduled).toBeGreaterThanOrEqual(1);
      const finished = scheduleOf(row.stripeSubscriptionId);
      expect(finished.id).toBe(half.id);
      expect(finished.phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
      });
      expect((await rowOf(row.id)).stripeScheduleId).toBe(half.id);
    });

    it('a finish that fails is one error alert with its ids: nothing thrown, no email', async () => {
      const { row, schedule } = await halfMade('l2-finish-fails');
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        down('Stripe is down again')
      );

      await expect(eventPass(row.stripeSubscriptionId)).resolves.toBe(
        'not_due'
      );

      expect(alert.mock.calls).toEqual([
        [
          expect.stringContaining('billing_change.finish_failed'),
          expect.objectContaining({
            errorId: expect.any(String),
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            stripeScheduleId: schedule.id,
          }),
        ],
      ]);
      expect(sent).not.toHaveBeenCalled();
      expect(scheduleOf(row.stripeSubscriptionId).phases).toHaveLength(1);
    });
  });

  // ─── B: a cheaper plan on monthly, one waiting change (Q3) ─────────────

  describe('B: Pro yearly to Basic monthly', () => {
    it('one waiting change: Pro until the year ends, then Basic monthly with the tier flipped by the schedule', async () => {
      const { org, pro, basic } = await hollowOak('b');
      const { userId, row } = await yearlyMember(org.id, pro);

      const preview = await service.previewTierChange(
        userId,
        org.id,
        basic.id,
        'month'
      );
      expect(preview).toMatchObject({
        amountDueCents: 0,
        takesEffect: 'period_end',
        billingChange: { interval: 'month', amountCents: 500 },
      });

      await service.changeTier(userId, org.id, basic.id, 'month');
      const stored = await rowOf(row.id);
      // Access stays on Pro until the renewal.
      expect(stored.tierId).toBe(pro.id);
      expect(stored.pendingTierId).toBe(basic.id);
      expect(
        (await service.getSubscription(userId, org.id))?.pendingTierChange
      ).toMatchObject({
        kind: 'plan_and_billing',
        tierName: 'Basic',
        amountCents: 500,
        billingInterval: 'month',
      });

      const event = fake.renew(row.stripeSubscriptionId);
      await service.handleSubscriptionUpdated(event);
      await service.applyDueTierMove(event);
      const after = await rowOf(row.id);
      expect(after).toMatchObject({
        tierId: basic.id,
        billingInterval: 'month',
        amountCents: 500,
        pendingTierId: null,
        stripeScheduleId: null,
      });
      expect(fake.splits).toEqual([]);
    });

    it('a schedule step that fails puts the record back: nothing changed, and the error stands', async () => {
      const { org, pro, basic } = await hollowOak('b-fails');
      const { userId, row } = await yearlyMember(org.id, pro);
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        Object.assign(new Error('Stripe is down'), { statusCode: 500 })
      );

      await expect(
        service.changeTier(userId, org.id, basic.id, 'month')
      ).rejects.toThrow();

      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.schedule).toBeNull();
      expect(Object.keys(stripeSide.metadata).sort()).toEqual([
        'codex_env',
        'codex_organization_id',
        'codex_tier_id',
        'codex_user_id',
      ]);
      expect((await rowOf(row.id)).pendingTierId).toBeNull();
    });

    // Review C1, SF-3: the update fails, and so does letting go of the
    // schedule made for it. The record stays beside the untagged schedule,
    // so it still reads as ours, never "scheduled elsewhere".
    it('the update fails and so does letting go of its schedule: one alert, the record kept, and Keep still reaches it', async () => {
      const { org, pro, basic } = await hollowOak('b-stranded');
      const { userId, row } = await yearlyMember(org.id, pro);
      fake.subscriptionSchedules.update.mockRejectedValueOnce(
        Object.assign(new Error('Stripe is down'), { statusCode: 500 })
      );
      fake.subscriptionSchedules.release.mockRejectedValueOnce(
        Object.assign(new Error('Stripe is still down'), { statusCode: 500 })
      );
      const alert = vi.spyOn(
        (service as unknown as { obs: { error: (...a: unknown[]) => void } })
          .obs,
        'error'
      );

      await expect(
        service.changeTier(userId, org.id, basic.id, 'month')
      ).rejects.toThrow();

      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.schedule).not.toBeNull();
      expect(stripeSide.metadata).toMatchObject({
        codex_move_tier_id: basic.id,
        codex_move_interval: 'month',
      });
      const stranded = alert.mock.calls.filter(([message]) =>
        String(message).includes('billing_change.undo_release_failed')
      );
      expect(stranded).toEqual([
        [
          expect.any(String),
          expect.objectContaining({
            errorId: expect.any(String),
            subscriptionId: row.id,
            stripeSubscriptionId: row.stripeSubscriptionId,
            stripeScheduleId: stripeSide.schedule,
          }),
        ],
      ]);
      alert.mockRestore();

      // Stripe answers again: the member's own Keep lets go of it.
      await service.keepCurrentPlan(userId, org.id);

      const kept = liveOf(row.stripeSubscriptionId);
      expect(kept.schedule).toBeNull();
      expect(kept.metadata.codex_move_interval).toBeUndefined();
      expect(kept.items.data[0]?.price.id).toBe(pro.stripePriceAnnualId);
    });
  });

  // ─── C(b): a dearer plan now, monthly later (Q1) ───────────────────────

  describe('C(b): Pro yearly to Premium monthly', () => {
    it('the preview is the yearly upgrade’s, with the monthly bill from the renewal', async () => {
      const { org, pro, premium } = await hollowOak('cb-preview');
      const { userId, periodEnd } = await yearlyMember(org.id, pro);

      const preview = await service.previewTierChange(
        userId,
        org.id,
        premium.id,
        'month'
      );

      expect(fake.createPreview).toHaveBeenCalledExactlyOnceWith({
        subscription: expect.any(String),
        subscription_details: {
          items: [
            { id: expect.any(String), price: premium.stripePriceAnnualId },
          ],
          proration_behavior: 'always_invoice',
          proration_date: preview.prorationDate,
        },
      });
      expect(preview).toMatchObject({
        amountDueCents: 2915,
        isUpgrade: true,
        takesEffect: 'now',
        newRecurringAmountCents: 2000,
        newRecurringInterval: 'month',
        currentPeriodEnd: new Date(periodEnd * 1000),
        billingChange: { interval: 'month', amountCents: 2000 },
      });
      expect(preview).not.toHaveProperty('quote');
    });

    it('confirm: Premium yearly now, paid by card, with the record; then the schedule to Premium monthly', async () => {
      const { org, pro, premium } = await hollowOak('cb-commit');
      const { userId, row, periodEnd } = await yearlyMember(org.id, pro);
      const now = Math.floor(Date.now() / 1000);

      await service.changeTier(userId, org.id, premium.id, 'month', now);

      const [first] = vi.mocked(fake.stripe.subscriptions.update).mock.calls;
      expect(first?.[1]).toMatchObject({
        items: [{ price: premium.stripePriceAnnualId }],
        proration_behavior: 'always_invoice',
        proration_date: now,
        payment_behavior: 'error_if_incomplete',
        metadata: {
          codex_tier_id: premium.id,
          codex_move_tier_id: premium.id,
          codex_move_interval: 'month',
          codex_move_price_id: premium.stripePriceMonthlyId,
          codex_hold_price_id: premium.stripePriceAnnualId,
        },
      });
      expect(first?.[1]).not.toHaveProperty('billing_cycle_anchor');
      expect(fake.writes).toEqual([
        'update:items',
        'schedule:create',
        'schedule:update',
      ]);
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.phases[0]?.items).toEqual([
        { price: premium.stripePriceAnnualId, quantity: 1 },
      ]);
      expect(schedule.phases[1]?.items).toEqual([
        { price: premium.stripePriceMonthlyId, quantity: 1 },
      ]);
      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        tierId: premium.id,
        billingInterval: 'year',
        amountCents: 20000,
        heldAmountCents: 20000,
        pendingTierId: premium.id,
        pendingTierFrom: new Date(periodEnd * 1000),
        pendingBillingInterval: 'month',
        pendingAmountCents: 2000,
      });
      expect(
        (await service.getSubscription(userId, org.id))?.pendingTierChange
      ).toMatchObject({ kind: 'billing', tierName: 'Premium' });
    });

    it('a declined card: nothing is set, no schedule', async () => {
      const { org, pro, premium } = await hollowOak('cb-402');
      const { userId, row } = await yearlyMember(org.id, pro);
      vi.mocked(fake.stripe.subscriptions.update).mockRejectedValueOnce(
        Object.assign(new Error('Your card was declined.'), {
          type: 'StripeCardError',
          statusCode: 402,
        })
      );

      await expect(
        service.changeTier(userId, org.id, premium.id, 'month')
      ).rejects.toThrow(SubscriptionPaymentRequiredError);

      expect(fake.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(liveOf(row.stripeSubscriptionId).metadata).not.toHaveProperty(
        'codex_move_tier_id'
      );
      expect((await rowOf(row.id)).tierId).toBe(pro.id);
    });
  });

  // ─── D and latest wins (Q2) ─────────────────────────────────────────────

  describe('a change of billing while something waits (Q2)', () => {
    it('D: a cheaper plan waits; switching to monthly joins it — the held Price back, then the schedule', async () => {
      const { org, pro, basic } = await hollowOak('d');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, basic.id, 'year');
      expect(liveOf(row.stripeSubscriptionId).items.data[0]?.price.id).toBe(
        basic.stripePriceAnnualId
      );

      const preview = await service.previewTierChange(
        userId,
        org.id,
        basic.id,
        'month'
      );
      expect(preview.replaces).toEqual({
        tierId: basic.id,
        tierName: 'Basic',
        interval: 'year',
        amountCents: 5000,
      });

      fake.writes.length = 0;
      await service.changeTier(userId, org.id, basic.id, 'month');

      expect(fake.writes).toEqual([
        'update:items',
        'schedule:create',
        'schedule:update',
      ]);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      // The year runs on at what was paid, Pro's yearly Price.
      expect(stripeSide.items.data[0]?.price.id).toBe(pro.stripePriceAnnualId);
      expect(stripeSide.metadata).toMatchObject({
        codex_tier_id: pro.id,
        codex_move_tier_id: basic.id,
        codex_hold_price_id: pro.stripePriceAnnualId,
        codex_move_price_id: basic.stripePriceMonthlyId,
      });
      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        amountCents: 12000,
        heldAmountCents: 12000,
        pendingTierId: basic.id,
        pendingBillingInterval: 'month',
        pendingAmountCents: 500,
      });
      expect(fake.splits).toEqual([]);
    });

    it('latest wins: Basic monthly, then Pro monthly, updates the same schedule’s phase 2', async () => {
      const { org, pro, basic } = await hollowOak('latest');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, basic.id, 'month');
      const scheduleId = scheduleOf(row.stripeSubscriptionId).id;
      fake.writes.length = 0;

      await service.changeTier(userId, org.id, pro.id, 'month');

      expect(fake.writes).toEqual(['update:metadata', 'schedule:update']);
      const schedule = scheduleOf(row.stripeSubscriptionId);
      expect(schedule.id).toBe(scheduleId);
      expect(schedule.phases[1]).toMatchObject({
        items: [{ price: pro.stripePriceMonthlyId }],
        metadata: { codex_tier_id: pro.id },
      });
      expect(liveOf(row.stripeSubscriptionId).metadata).toMatchObject({
        codex_move_tier_id: pro.id,
        codex_move_amount: '1200',
      });
      expect((await rowOf(row.id)).pendingTierId).toBe(pro.id);
    });

    it('a cheaper plan on yearly replaces it: the schedule goes, then the waiting move', async () => {
      const { org, pro, basic } = await hollowOak('replace-by-move');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      fake.writes.length = 0;

      await service.changeTier(userId, org.id, basic.id, 'year');

      expect(fake.writes).toEqual(['schedule:release', 'update:items']);
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.schedule).toBeNull();
      expect(stripeSide.metadata).toMatchObject({
        codex_move_tier_id: basic.id,
        codex_hold_price_id: pro.stripePriceAnnualId,
      });
      expect(stripeSide.metadata).not.toHaveProperty('codex_move_interval');
      const stored = await rowOf(row.id);
      expect(stored).toMatchObject({
        pendingTierId: basic.id,
        pendingBillingInterval: null,
        stripeScheduleId: null,
        heldAmountCents: 12000,
      });
      expect(fake.splits).toEqual([]);
    });

    it('a monthly member moving to a cheaper plan: a switch into yearly is still refused', async () => {
      const { org, pro, basic } = await hollowOak('monthly-into-year');
      const { userId, row } = await yearlyMember(org.id, pro);
      // Make Alex a monthly member on Pro, with a move to Basic waiting.
      const item = liveOf(row.stripeSubscriptionId).items.data[0];
      if (!item || !pro.stripePriceMonthlyId) throw new Error('setup');
      item.price = {
        id: pro.stripePriceMonthlyId,
        unit_amount: 1200,
        recurring: { interval: 'month' },
      };
      item.current_period_end = item.current_period_start + 40 * DAY;
      await db
        .update(subscriptions)
        .set({
          billingInterval: 'month',
          amountCents: 1200,
          platformFeeCents: 120,
          organizationFeeCents: 162,
          creatorPayoutCents: 918,
        })
        .where(eq(subscriptions.id, row.id));
      await service.changeTier(userId, org.id, basic.id, 'month');

      await expect(
        service.changeTier(userId, org.id, pro.id, 'year')
      ).rejects.toThrow(TierChangeIntervalWhileMovingError);
    });
  });

  // ─── Someone else's schedule (§3.4) ─────────────────────────────────────

  describe("a Stripe schedule that isn't ours", () => {
    it('refuses a change and a cancel with SUBSCRIPTION_SCHEDULED_ELSEWHERE and one alert; nothing is written', async () => {
      const { org, pro, basic } = await hollowOak('foreign');
      const { userId, row } = await yearlyMember(org.id, pro);
      fake.schedules.set('sub_sched_dashboard', {
        id: 'sub_sched_dashboard',
        object: 'subscription_schedule',
        subscription: row.stripeSubscriptionId,
        status: 'active',
        end_behavior: 'release',
        metadata: { made_by: 'dashboard' },
        current_phase: null,
        phases: [],
      });
      liveOf(row.stripeSubscriptionId).schedule = 'sub_sched_dashboard';
      const alert = vi.spyOn(
        (service as unknown as { obs: { error: (...a: unknown[]) => void } })
          .obs,
        'error'
      );

      const refused = await service
        .changeTier(userId, org.id, basic.id, 'month')
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(SubscriptionScheduledElsewhereError);
      expect((refused as { context: Record<string, unknown> }).context).toEqual(
        {
          code: 'SUBSCRIPTION_SCHEDULED_ELSEWHERE',
          organizationId: org.id,
          errorId: expect.any(String),
        }
      );
      await expect(service.cancelSubscription(userId, org.id)).rejects.toThrow(
        SubscriptionScheduledElsewhereError
      );
      expect(fake.writes).toEqual([]);
      expect(alert).toHaveBeenCalledTimes(2);
    });
  });

  // ─── The stale snapshot (§4.4, also .16's moves) ────────────────────────

  describe('a stale event without the waiting change', () => {
    it('re-reads the live subscription instead of clearing the row’s change', async () => {
      const { org, pro } = await hollowOak('stale');
      const { userId, row } = await yearlyMember(org.id, pro);
      const before = structuredClone(
        liveOf(row.stripeSubscriptionId)
      ) as unknown as Stripe.Subscription;
      await service.changeTier(userId, org.id, pro.id, 'month');

      // An event written before the change, delivered after it.
      await service.handleSubscriptionUpdated(before);

      const stored = await rowOf(row.id);
      expect(stored.pendingTierId).toBe(pro.id);
      expect(stored.pendingBillingInterval).toBe('month');
      expect(stored.stripeScheduleId).not.toBeNull();
      expect(
        (await service.getSubscription(userId, org.id))?.pendingTierChange
      ).not.toBeNull();
    });
  });

  // ─── Price moves during the wait (§5.1) ─────────────────────────────────

  describe('a due price change on a scheduled subscription', () => {
    it('is not swapped onto the item while our schedule is attached (no split)', async () => {
      const { org, pro } = await hollowOak('swap-guard');
      const { userId, row } = await yearlyMember(org.id, pro);
      await service.changeTier(userId, org.id, pro.id, 'month');
      prices.set('price_pro_y_v2', { amount: 13000, interval: 'year' });
      const sub = liveOf(row.stripeSubscriptionId);
      sub.metadata.codex_pending_price_id = 'price_pro_y_v2';
      sub.metadata.codex_pending_price_from = '1';

      const swapped = await applyDuePendingPriceChange(
        fake.stripe,
        structuredClone(sub) as unknown as Stripe.Subscription
      );

      expect(swapped).toBe(false);
      expect(fake.splits).toEqual([]);
    });

    it('never swaps on a Price of another billing period: dropped, and support told', async () => {
      const { org, pro } = await hollowOak('interval-guard');
      const { row } = await yearlyMember(org.id, pro);
      // A monthly member with a stale yearly marker (proof P4's leftover).
      const sub = liveOf(row.stripeSubscriptionId);
      const item = sub.items.data[0];
      if (!item || !pro.stripePriceMonthlyId) throw new Error('setup');
      item.price = {
        id: pro.stripePriceMonthlyId,
        unit_amount: 1200,
        recurring: { interval: 'month' },
      };
      prices.set('price_pro_y_v3', { amount: 13000, interval: 'year' });
      sub.metadata.codex_pending_price_id = 'price_pro_y_v3';
      sub.metadata.codex_pending_price_from = '1';

      await expect(
        applyDuePendingPriceChange(
          fake.stripe,
          structuredClone(sub) as unknown as Stripe.Subscription
        )
      ).rejects.toThrow(/another billing period/);

      expect(item.price.id).toBe(pro.stripePriceMonthlyId);
      expect(sub.metadata).not.toHaveProperty('codex_pending_price_id');
    });
  });
});
