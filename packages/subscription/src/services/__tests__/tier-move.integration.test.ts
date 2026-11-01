/**
 * A move to a cheaper plan waits for the renewal (Codex-2hxff.16, owner
 * decisions T1-T6 and Q1-Q4; data design §1-§6).
 *
 * Real DB, and a Stripe fake that keeps one live subscription the way Stripe
 * does: an update merges metadata ('' deletes a key), swaps the item's Price,
 * and an idempotency key replays its first response without applying a new
 * write (a repeat with other parameters is refused, as Stripe's is). That is
 * what lets these tests see a toggle that does nothing.
 *
 * The prices are the mockups': Basic £5, Pro £12, Premium £20 a month. Every
 * row hangs off this file's own organisations and subscribers, deleted in
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
  TierChangeCancellingError,
  TierChangeIntervalWhileMovingError,
  TierChangeTwoStepsError,
  TierHasSubscribersError,
} from '../../errors';
import { SubscriptionService } from '../subscription-service';
import { TierService } from '../tier-service';

const DAY = 86_400;

type Tier = typeof subscriptionTiers.$inferSelect;

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
  metadata: Record<string, string>;
  items: { data: LiveItem[] };
}

/**
 * Stripe's subscriptions, held in memory. `prices` maps a Price id to its
 * amount and interval, as Stripe's Price objects would.
 */
function liveStripe(
  prices: Map<string, { amount: number; interval: 'month' | 'year' }>
) {
  const stripe = createMockStripe();
  const live = new Map<string, LiveSubscription>();
  const keys = new Map<string, { params: string; response: unknown }>();
  const clone = <T>(value: T): T => structuredClone(value);

  vi.mocked(stripe.subscriptions.retrieve).mockImplementation((async (
    id: string
  ) => {
    const sub = live.get(id);
    if (!sub) {
      throw Object.assign(new Error('No such subscription'), {
        type: 'StripeInvalidRequestError',
        statusCode: 404,
      });
    }
    return clone(sub);
  }) as unknown as typeof stripe.subscriptions.retrieve);

  vi.mocked(stripe.subscriptions.update).mockImplementation((async (
    id: string,
    params: {
      items?: Array<{ id: string; price: string }>;
      metadata?: Record<string, string>;
      cancel_at_period_end?: boolean;
    },
    options?: { idempotencyKey?: string }
  ) => {
    const key = options?.idempotencyKey;
    const asSent = JSON.stringify(params);
    if (key) {
      const earlier = keys.get(key);
      if (earlier && earlier.params !== asSent) {
        throw Object.assign(
          new Error(
            'Keys for idempotent requests can only be used with the same parameters'
          ),
          { type: 'StripeIdempotencyError', statusCode: 400 }
        );
      }
      // Stripe replays the first response and applies nothing.
      if (earlier) return clone(earlier.response);
    }
    const sub = live.get(id);
    if (!sub) throw new Error(`no live subscription ${id}`);
    const [item] = sub.items.data;
    if (params.items?.[0] && item) {
      const priceId = params.items[0].price;
      const price = prices.get(priceId);
      if (!price) throw new Error(`no such Price ${priceId}`);
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
    }
    const response = clone(sub);
    if (key) keys.set(key, { params: asSent, response });
    return response;
  }) as unknown as typeof stripe.subscriptions.update);

  const createPreview = vi.fn().mockResolvedValue({
    amount_due: 336,
    lines: { data: [] },
  });
  (stripe as unknown as { invoices: Record<string, unknown> }).invoices = {
    ...(stripe as unknown as { invoices: Record<string, unknown> }).invoices,
    createPreview,
  };

  return { stripe, live, createPreview };
}

describe('waiting tier moves (Codex-2hxff.16)', () => {
  let db: Database;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let stripe: Stripe;
  let live: Map<string, LiveSubscription>;
  let createPreview: ReturnType<typeof vi.fn>;
  let service: SubscriptionService;
  let invalidate: ReturnType<typeof vi.fn>;
  const prices = new Map<
    string,
    { amount: number; interval: 'month' | 'year' }
  >();

  beforeAll(() => {
    db = setupTestDatabase();
  });

  beforeEach(() => {
    ({ stripe, live, createPreview } = liveStripe(prices));
    invalidate = vi.fn().mockResolvedValue(undefined);
    service = new SubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        cache: { invalidate } as unknown as VersionedCache,
        waitUntil: () => {},
      },
      stripe
    );
  });

  afterAll(async () => {
    // Price moves hang off subscriptions and price changes off tiers (RESTRICT).
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

  /** An org with Basic, Pro and Premium, every Price known to the fake. */
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

  /**
   * A member on `tier` monthly, renewing in 12 days, live at Stripe.
   * `periodStart` is 18 days ago.
   */
  async function member(
    orgId: string,
    tier: Tier,
    overrides: Partial<typeof subscriptions.$inferInsert> = {}
  ) {
    const userId = takeFirst(await seedTestUsers(db, 1), 'member');
    userIds.push(userId);
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - 18 * DAY;
    const periodEnd = now + 12 * DAY;
    const amount = tier.priceMonthly;
    const platform = Math.floor(amount / 10);
    const orgFee = Math.floor((amount - platform) * 0.15);
    const row = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tier.id, {
            amountCents: amount,
            platformFeeCents: platform,
            organizationFeeCents: orgFee,
            creatorPayoutCents: amount - platform - orgFee,
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
            ...overrides,
          })
        )
        .returning()
    );
    const priceId = tier.stripePriceMonthlyId ?? 'price_missing';
    live.set(row.stripeSubscriptionId, {
      id: row.stripeSubscriptionId,
      object: 'subscription',
      status: 'active',
      cancel_at_period_end: false,
      customer: row.stripeCustomerId,
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
              id: priceId,
              unit_amount: amount,
              recurring: { interval: 'month' },
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

  function liveOf(stripeSubscriptionId: string): LiveSubscription {
    const sub = live.get(stripeSubscriptionId);
    if (!sub) throw new Error('no live subscription');
    return sub;
  }

  /** The renewal the move lands on: Stripe starts the next period. */
  function renew(stripeSubscriptionId: string): Stripe.Subscription {
    const sub = liveOf(stripeSubscriptionId);
    const [item] = sub.items.data;
    if (!item) throw new Error('no item');
    item.current_period_start = item.current_period_end;
    item.current_period_end = item.current_period_end + 30 * DAY;
    return structuredClone(sub) as unknown as Stripe.Subscription;
  }

  function updates() {
    return vi.mocked(stripe.subscriptions.update).mock.calls;
  }

  // ─── §2.1 The write ─────────────────────────────────────────────────────

  describe('a cheaper plan on the same billing (T1)', () => {
    it('waits: one no-proration swap, the hold marker, the tier kept, nothing previewed', async () => {
      const { org, basic, premium } = await hollowOak('move-first');
      const { userId, row, periodEnd } = await member(org.id, premium);

      await service.changeTier(userId, org.id, basic.id, 'month');

      expect(updates()).toHaveLength(1);
      const [, params, options] = updates()[0] ?? [];
      expect(params).toMatchObject({
        items: [{ price: basic.stripePriceMonthlyId }],
        proration_behavior: 'none',
      });
      expect(params).not.toHaveProperty('proration_date');
      expect(params).not.toHaveProperty('payment_behavior');
      expect(createPreview).not.toHaveBeenCalled();
      expect(options).toEqual({
        idempotencyKey: expect.stringMatching(
          new RegExp(
            `^move_${row.id}_${basic.stripePriceMonthlyId}_${periodEnd}_\\d+$`
          )
        ),
      });

      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.metadata).toMatchObject({
        codex_tier_id: premium.id,
        codex_move_tier_id: basic.id,
        codex_move_at: String(periodEnd),
        codex_hold_price_id: premium.stripePriceMonthlyId,
        codex_hold_amount: '2000',
      });
      expect(stripeSide.items.data[0]?.price.id).toBe(
        basic.stripePriceMonthlyId
      );

      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(premium.id);
      expect(stored.pendingTierId).toBe(basic.id);
      expect(stored.pendingTierFrom).toEqual(new Date(periodEnd * 1000));
      expect(stored.heldAmountCents).toBe(2000);
      expect(stored.amountCents).toBe(500);
      expect(
        stored.platformFeeCents +
          stored.organizationFeeCents +
          stored.creatorPayoutCents
      ).toBe(500);
      expect(invalidate).toHaveBeenCalled();
    });

    it('the preview says it waits: £0 today, the renewal date, no invoice preview', async () => {
      const { org, basic, premium } = await hollowOak('move-preview');
      const { userId, periodEnd } = await member(org.id, premium);

      const preview = await service.previewTierChange(
        userId,
        org.id,
        basic.id,
        'month'
      );

      expect(preview).toMatchObject({
        amountDueCents: 0,
        prorationLineItems: [],
        newRecurringAmountCents: 500,
        isUpgrade: false,
        takesEffect: 'period_end',
        currentPeriodEnd: new Date(periodEnd * 1000),
      });
      expect(createPreview).not.toHaveBeenCalled();
    });

    it('latest wins: another cheaper plan replaces the move and KEEPS the first hold keys (T2)', async () => {
      const { org, basic, pro, premium } = await hollowOak('move-replace');
      const { userId, row } = await member(org.id, premium);

      await service.changeTier(userId, org.id, basic.id, 'month');
      // Judged against the £20 held, not the £5 the row now bills.
      await service.changeTier(userId, org.id, pro.id, 'month');

      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.metadata).toMatchObject({
        codex_tier_id: premium.id,
        codex_move_tier_id: pro.id,
        codex_hold_price_id: premium.stripePriceMonthlyId,
        codex_hold_amount: '2000',
      });
      expect(stripeSide.items.data[0]?.price.id).toBe(pro.stripePriceMonthlyId);
      const [, replacement] = updates()[1] ?? [];
      expect(
        Object.keys(
          (replacement as { metadata: Record<string, string> }).metadata
        ).filter((key) => key.startsWith('codex_hold_'))
      ).toEqual([]);

      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(premium.id);
      expect(stored.pendingTierId).toBe(pro.id);
      expect(stored.heldAmountCents).toBe(2000);
      expect(stored.amountCents).toBe(1200);
    });

    it('Basic, Pro, then Basic again inside 24 hours are three writes, not a replay', async () => {
      const { org, basic, pro, premium } = await hollowOak('move-toggle');
      const { userId, row } = await member(org.id, premium);
      const now = Math.floor(Date.now() / 1000);

      await service.changeTier(userId, org.id, basic.id, 'month', now - 30);
      await service.changeTier(userId, org.id, pro.id, 'month', now - 20);
      await service.changeTier(userId, org.id, basic.id, 'month', now - 10);

      expect(updates()).toHaveLength(3);
      // The third reaches Stripe under a key of its own, not the first's.
      const keys = updates().map(
        (call) => (call[2] as { idempotencyKey: string }).idempotencyKey
      );
      expect(new Set(keys).size).toBe(3);
      expect(liveOf(row.stripeSubscriptionId).items.data[0]?.price.id).toBe(
        basic.stripePriceMonthlyId
      );
      expect((await rowOf(row.id)).pendingTierId).toBe(basic.id);
    });
  });

  // ─── §1 The refusals ────────────────────────────────────────────────────

  describe('refusals, before Stripe is written to', () => {
    it('a dearer plan while a move waits: PENDING_MOVE_KEEP_FIRST (T2, §3)', async () => {
      const { org, basic, pro, premium } = await hollowOak('refuse-keep');
      const { userId } = await member(org.id, pro);
      await service.changeTier(userId, org.id, basic.id, 'month');
      vi.mocked(stripe.subscriptions.update).mockClear();

      for (const attempt of [
        () => service.previewTierChange(userId, org.id, premium.id, 'month'),
        () => service.changeTier(userId, org.id, premium.id, 'month'),
      ]) {
        const refused = await attempt().catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(PendingMoveKeepFirstError);
        expect((refused as PendingMoveKeepFirstError).context).toMatchObject({
          code: 'PENDING_MOVE_KEEP_FIRST',
        });
      }
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(createPreview).not.toHaveBeenCalled();
    });

    it('their own plan while a move waits: PENDING_MOVE_KEEP_FIRST, never a switch that drops the held Price', async () => {
      const { org, basic, premium } = await hollowOak('refuse-own');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      vi.mocked(stripe.subscriptions.update).mockClear();

      const refused = await service
        .changeTier(userId, org.id, premium.id, 'month')
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(PendingMoveKeepFirstError);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect((await rowOf(row.id)).pendingTierId).toBe(basic.id);
    });

    it('a billing switch while a move waits: TIER_CHANGE_INTERVAL_WHILE_MOVING (Q3)', async () => {
      const { org, basic, pro } = await hollowOak('refuse-interval');
      const { userId } = await member(org.id, pro);
      await service.changeTier(userId, org.id, basic.id, 'month');
      vi.mocked(stripe.subscriptions.update).mockClear();

      const refused = await service
        .changeTier(userId, org.id, pro.id, 'year')
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(TierChangeIntervalWhileMovingError);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('a cheaper plan on another period: TIER_CHANGE_TWO_STEPS with the first step (Q1)', async () => {
      const { org, basic, pro } = await hollowOak('refuse-two-steps');
      const { userId } = await member(org.id, pro);

      const refused = await service
        .changeTier(userId, org.id, basic.id, 'year')
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(TierChangeTwoStepsError);
      expect((refused as TierChangeTwoStepsError).statusCode).toBe(422);
      expect((refused as TierChangeTwoStepsError).context).toMatchObject({
        code: 'TIER_CHANGE_TWO_STEPS',
        firstStep: { tierId: basic.id, billingInterval: 'month' },
      });
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('any change while set to cancel: TIER_CHANGE_CANCELLING, Stripe not even read (Q2)', async () => {
      const { org, basic, premium, pro } = await hollowOak('refuse-cancel');
      const { userId } = await member(org.id, pro, {
        status: 'cancelling',
        cancelAtPeriodEnd: true,
      });

      for (const tier of [basic, premium]) {
        const refused = await service
          .changeTier(userId, org.id, tier.id, 'month')
          .catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(TierChangeCancellingError);
      }
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });
  });

  // ─── Q4 Same price ──────────────────────────────────────────────────────

  it('a same-price plan switches now with no proration and replaces a waiting move (Q4)', async () => {
    const { org, basic, premium } = await hollowOak('lateral');
    const studio = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(org.id, {
            name: 'Studio',
            sortOrder: 4,
            priceMonthly: 2000,
            priceAnnual: 20000,
          })
        )
        .returning()
    );
    if (studio.stripePriceMonthlyId) {
      prices.set(studio.stripePriceMonthlyId, {
        amount: 2000,
        interval: 'month',
      });
    }
    const { userId, row } = await member(org.id, premium);
    await service.changeTier(userId, org.id, basic.id, 'month');

    const preview = await service.previewTierChange(
      userId,
      org.id,
      studio.id,
      'month'
    );
    expect(preview).toMatchObject({ amountDueCents: 0, takesEffect: 'now' });
    await service.changeTier(userId, org.id, studio.id, 'month');

    const [, params] = updates().at(-1) ?? [];
    expect(params).toMatchObject({ proration_behavior: 'none' });
    const stripeSide = liveOf(row.stripeSubscriptionId);
    expect(stripeSide.metadata.codex_tier_id).toBe(studio.id);
    expect(stripeSide.metadata).not.toHaveProperty('codex_move_tier_id');
    expect(stripeSide.metadata).not.toHaveProperty('codex_hold_price_id');
    const stored = await rowOf(row.id);
    expect(stored.tierId).toBe(studio.id);
    expect(stored.pendingTierId).toBeNull();
    expect(stored.heldAmountCents).toBeNull();
    expect(stored.amountCents).toBe(2000);
  });

  // ─── §4 Keep current plan ───────────────────────────────────────────────

  describe('Keep current plan (§4)', () => {
    it('puts the EXACT held Price back (grandfathered), no proration, the parked price change live again', async () => {
      const { org, basic, premium } = await hollowOak('keep');
      const { userId, row } = await member(org.id, premium);
      const heldPriceId = premium.stripePriceMonthlyId;
      const repriced = `${heldPriceId}_v2`;
      liveOf(row.stripeSubscriptionId).metadata.codex_pending_price_id =
        repriced;
      liveOf(row.stripeSubscriptionId).metadata.codex_pending_price_from =
        '1790000000';
      await service.changeTier(userId, org.id, basic.id, 'month');
      expect(liveOf(row.stripeSubscriptionId).metadata).not.toHaveProperty(
        'codex_pending_price_id'
      );
      // Premium is repriced while the move waits: its current Price changes.
      await db
        .update(subscriptionTiers)
        .set({ priceMonthly: 2200, stripePriceMonthlyId: repriced })
        .where(eq(subscriptionTiers.id, premium.id));
      const obs = (
        service as unknown as {
          obs: { info: (m: string, d?: unknown) => void };
        }
      ).obs;
      const logged = vi.spyOn(obs, 'info');

      await service.keepCurrentPlan(userId, org.id);

      const [, params] = updates().at(-1) ?? [];
      expect(params).toMatchObject({
        items: [{ price: heldPriceId }],
        proration_behavior: 'none',
      });
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.items.data[0]?.price.id).toBe(heldPriceId);
      expect(stripeSide.metadata.codex_tier_id).toBe(premium.id);
      expect(stripeSide.metadata).toMatchObject({
        codex_pending_price_id: repriced,
        codex_pending_price_from: '1790000000',
      });
      for (const key of Object.keys(stripeSide.metadata)) {
        expect(key).not.toMatch(/^codex_(move|hold)_/);
      }
      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(premium.id);
      expect(stored.pendingTierId).toBeNull();
      expect(stored.pendingTierFrom).toBeNull();
      expect(stored.heldAmountCents).toBeNull();
      expect(stored.amountCents).toBe(2000);
      expect(logged).toHaveBeenCalledWith(
        'tier_move.kept',
        expect.objectContaining({ heldTierRepriced: true, alreadyTold: true })
      );
      // The parked change Keep made live again is to the current Price, and a
      // pending marker is written only after an accepted notice: they were
      // told, so nothing is recorded to tell them again.
      expect(
        await db
          .select()
          .from(subscriptionPriceMoves)
          .where(eq(subscriptionPriceMoves.subscriptionId, row.id))
      ).toEqual([]);
    });

    // Part A rule 3 (data design §2.3): a tier repriced while the member was
    // moving away skipped them, so Keep hands them to the price-change step.
    describe('on a tier repriced while they waited (Codex-2hxff.86)', () => {
      async function keptAfterReprice(slug: string) {
        const { org, basic, premium } = await hollowOak(slug);
        const { userId, row } = await member(org.id, premium);
        await service.changeTier(userId, org.id, basic.id, 'month');
        const repriced = `${premium.stripePriceMonthlyId}_v2`;
        await db
          .update(subscriptionTiers)
          .set({ priceMonthly: 2200, stripePriceMonthlyId: repriced })
          .where(eq(subscriptionTiers.id, premium.id));
        return { org, premium, userId, row, repriced };
      }

      const rowsOf = (subscriptionId: string) =>
        db
          .select()
          .from(subscriptionPriceMoves)
          .where(eq(subscriptionPriceMoves.subscriptionId, subscriptionId));

      it('no change recorded for the Price yet: Keep writes its own, and one due row for them', async () => {
        const { org, premium, userId, row, repriced } =
          await keptAfterReprice('keep-rejoin-own');

        await service.keepCurrentPlan(userId, org.id);

        const [change] = await db
          .select()
          .from(priceChanges)
          .where(eq(priceChanges.tierId, premium.id));
        expect(change).toMatchObject({
          organizationId: org.id,
          kind: 'tier',
          interval: 'month',
          // From what they pay now (the held Price), to the tier's current one.
          fromAmountCents: 2000,
          newAmountCents: 2200,
          newStripePriceId: repriced,
          state: 'running',
          totalCount: 1,
          createdByUserId: null,
        });
        expect(await rowsOf(row.id)).toEqual([
          expect.objectContaining({
            priceChangeId: change?.id,
            state: 'due',
            source: 'keep_current_plan',
            stripeSubscriptionId: row.stripeSubscriptionId,
            organizationId: org.id,
            userId,
            attempts: 0,
          }),
        ]);
      });

      it("hangs the row off the tier's latest change and re-opens it when done", async () => {
        const { org, premium, userId, row, repriced } =
          await keptAfterReprice('keep-rejoin-done');
        const doneAt = new Date(Date.now() - 60_000);
        const [change] = await db
          .insert(priceChanges)
          .values({
            organizationId: org.id,
            kind: 'tier',
            tierId: premium.id,
            interval: 'month',
            fromAmountCents: 2000,
            newAmountCents: 2200,
            newStripePriceId: repriced,
            state: 'done',
            doneAt,
            totalCount: 4,
          })
          .returning();

        await service.keepCurrentPlan(userId, org.id);

        const [after] = await db
          .select()
          .from(priceChanges)
          .where(eq(priceChanges.tierId, premium.id));
        expect(after).toMatchObject({
          id: change?.id,
          state: 'running',
          doneAt: null,
          totalCount: 5,
        });
        expect(await rowsOf(row.id)).toEqual([
          expect.objectContaining({
            priceChangeId: change?.id,
            state: 'due',
            source: 'keep_current_plan',
          }),
        ]);
      });
    });

    it('Keep, a new move, then Keep again inside 24 hours: the second Keep writes too', async () => {
      const { org, basic, premium } = await hollowOak('keep-toggle');
      const { userId, row } = await member(org.id, premium);
      const now = Math.floor(Date.now() / 1000);

      // Each move from its own preview, as the dialog makes them.
      await service.changeTier(userId, org.id, basic.id, 'month', now - 20);
      await service.keepCurrentPlan(userId, org.id);
      await service.changeTier(userId, org.id, basic.id, 'month', now - 10);
      expect(liveOf(row.stripeSubscriptionId).items.data[0]?.price.id).toBe(
        basic.stripePriceMonthlyId
      );
      // Same Price, same renewal, same metadata as the first Keep: only the
      // row version tells Stripe this is a new request.
      await service.keepCurrentPlan(userId, org.id);

      expect(updates()).toHaveLength(4);
      const keepKeys = updates()
        .map((call) => (call[2] as { idempotencyKey: string }).idempotencyKey)
        .filter((key) => key.startsWith('keep_'));
      expect(keepKeys).toHaveLength(2);
      expect(new Set(keepKeys).size).toBe(2);
      expect(liveOf(row.stripeSubscriptionId).items.data[0]?.price.id).toBe(
        premium.stripePriceMonthlyId
      );
      expect((await rowOf(row.id)).pendingTierId).toBeNull();
    });

    it('nothing waiting: changes nothing (idempotent)', async () => {
      const { org, pro } = await hollowOak('keep-nothing');
      const { userId } = await member(org.id, pro);

      await service.keepCurrentPlan(userId, org.id);

      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('after the renewal it lands on: MOVE_ALREADY_LANDED, the cheaper Price stays', async () => {
      const { org, basic, premium } = await hollowOak('keep-landed');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      renew(row.stripeSubscriptionId);
      vi.mocked(stripe.subscriptions.update).mockClear();

      const refused = await service
        .keepCurrentPlan(userId, org.id)
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(MoveAlreadyLandedError);
      expect((refused as MoveAlreadyLandedError).statusCode).toBe(409);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  // ─── §5 The renewal flip ────────────────────────────────────────────────

  describe('the renewal flip (§5.1)', () => {
    it('before the renewal: not due, nothing written', async () => {
      const { org, basic, premium } = await hollowOak('flip-not-due');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      vi.mocked(stripe.subscriptions.update).mockClear();

      const outcome = await service.applyDueTierMove(
        structuredClone(
          liveOf(row.stripeSubscriptionId)
        ) as unknown as Stripe.Subscription
      );

      expect(outcome).toBe('not_due');
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it.each([
      'active',
      'past_due',
      'paused',
    ] as const)('at the renewal (%s): the tier flips to the target, keys cleared, row mirrored', async (status) => {
      const { org, basic, premium } = await hollowOak(`flip-${status}`);
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      liveOf(row.stripeSubscriptionId).status = status;
      const event = renew(row.stripeSubscriptionId);
      // The webhook mirrors the event first, as it does today.
      await service.handleSubscriptionUpdated(event);

      const outcome = await service.applyDueTierMove(event);

      expect(outcome).toBe('applied');
      const stripeSide = liveOf(row.stripeSubscriptionId);
      expect(stripeSide.metadata.codex_tier_id).toBe(basic.id);
      for (const key of Object.keys(stripeSide.metadata)) {
        expect(key).not.toMatch(/^codex_(move|hold)_/);
      }
      const [, , options] = updates().at(-1) ?? [];
      expect(options).toEqual({
        idempotencyKey: `move-apply:${row.stripeSubscriptionId}:${basic.id}:${event.items.data[0]?.current_period_start}`,
      });
      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(basic.id);
      expect(stored.pendingTierId).toBeNull();
      expect(stored.heldAmountCents).toBeNull();
      expect(stored.amountCents).toBe(500);
      expect(invalidate).toHaveBeenCalled();
    });

    it('a cancelled subscription never flips, and the row drops the move (T4)', async () => {
      const { org, basic, premium } = await hollowOak('flip-cancelled');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      liveOf(row.stripeSubscriptionId).status = 'canceled';
      const event = renew(row.stripeSubscriptionId);
      vi.mocked(stripe.subscriptions.update).mockClear();

      const outcome = await service.applyDueTierMove(event);

      expect(outcome).toBe('none');
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(premium.id);
      expect(stored.pendingTierId).toBeNull();
    });

    it('a stale pre-flip event delivered after the flip: the row is mirrored again from Stripe', async () => {
      const { org, basic, premium } = await hollowOak('flip-stale');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      const stale = structuredClone(
        liveOf(row.stripeSubscriptionId)
      ) as unknown as Stripe.Subscription;
      const renewal = renew(row.stripeSubscriptionId);
      await service.handleSubscriptionUpdated(renewal);
      await service.applyDueTierMove(renewal);

      // The stale snapshot puts Premium and the move back on the row...
      await service.handleSubscriptionUpdated(stale);
      expect((await rowOf(row.id)).pendingTierId).toBe(basic.id);
      // ...and the hook, seeing the move on the event, reads Stripe again.
      const outcome = await service.applyDueTierMove(stale);

      expect(outcome).toBe('none');
      const stored = await rowOf(row.id);
      expect(stored.tierId).toBe(basic.id);
      expect(stored.pendingTierId).toBeNull();
    });

    it('an event with no move and a row with none costs no Stripe call', async () => {
      const { org, pro } = await hollowOak('flip-none');
      const { row } = await member(org.id, pro);

      const outcome = await service.applyDueTierMove(
        structuredClone(
          liveOf(row.stripeSubscriptionId)
        ) as unknown as Stripe.Subscription
      );

      expect(outcome).toBe('none');
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('a deletion drops the waiting move with the tombstone (T4)', async () => {
      const { org, basic, premium } = await hollowOak('flip-deleted');
      const { userId, row } = await member(org.id, premium);
      await service.changeTier(userId, org.id, basic.id, 'month');
      liveOf(row.stripeSubscriptionId).status = 'canceled';

      await service.handleSubscriptionDeleted(
        structuredClone(
          liveOf(row.stripeSubscriptionId)
        ) as unknown as Stripe.Subscription
      );

      const stored = await rowOf(row.id);
      expect(stored.endedAt).not.toBeNull();
      expect(stored.pendingTierId).toBeNull();
      expect(stored.heldAmountCents).toBeNull();
    });
  });

  // ─── A target deleted while the move waited (T5, lead FYI 1) ────────────

  describe('a move to a tier deleted while it waited', () => {
    /**
     * deleteTier refuses a tier members are moving to, but it counts them
     * before its transaction: a move written in between gets past it. The
     * tier is soft-deleted here directly, as that race leaves it.
     */
    async function blockedMove(slug: string) {
      const { org, basic, premium } = await hollowOak(slug);
      const m = await member(org.id, premium);
      await service.changeTier(m.userId, org.id, basic.id, 'month');
      await db
        .update(subscriptionTiers)
        .set({ deletedAt: new Date() })
        .where(eq(subscriptionTiers.id, basic.id));
      const event = renew(m.row.stripeSubscriptionId);
      vi.mocked(stripe.subscriptions.update).mockClear();
      return { org, basic, premium, ...m, event };
    }

    function errorsSpy() {
      const obs = (
        service as unknown as {
          obs: { error: (m: string, d?: unknown) => void };
        }
      ).obs;
      return vi.spyOn(obs, 'error');
    }

    /** This row's target_tier_deleted alerts among everything logged. */
    function blockedAlertsFor(
      spy: ReturnType<typeof errorsSpy>,
      subscriptionId: string
    ) {
      return spy.mock.calls.filter(
        ([message, data]) =>
          message === 'tier_move.apply_failed' &&
          (data as { reason?: string; subscriptionId?: string }).reason ===
            'target_tier_deleted' &&
          (data as { subscriptionId?: string }).subscriptionId ===
            subscriptionId
      );
    }

    it('never flips onto it: one target_tier_deleted alert with the ids, nothing thrown, the dearer plan kept', async () => {
      const b = await blockedMove('blocked-flip');
      const alerted = errorsSpy();

      const outcome = await service.applyDueTierMove(b.event);

      expect(outcome).toBe('blocked');
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(liveOf(b.row.stripeSubscriptionId).metadata.codex_tier_id).toBe(
        b.premium.id
      );
      expect(alerted).toHaveBeenCalledExactlyOnceWith(
        'tier_move.apply_failed',
        expect.objectContaining({
          errorId: expect.any(String),
          reason: 'target_tier_deleted',
          subscriptionId: b.row.id,
          stripeSubscriptionId: b.row.stripeSubscriptionId,
          organizationId: b.org.id,
          tierId: b.premium.id,
          targetTierId: b.basic.id,
        })
      );
      const stored = await rowOf(b.row.id);
      expect(stored.tierId).toBe(b.premium.id);
      expect(stored.pendingTierId).toBe(b.basic.id);
    });

    it('the hourly backstop alerts it once a day, never in its every-run list', async () => {
      const b = await blockedMove('blocked-backstop');
      const due = Date.now() - 2 * 60 * 60 * 1000;
      await db
        .update(subscriptions)
        .set({ pendingTierFrom: new Date(due) })
        .where(eq(subscriptions.id, b.row.id));
      const alerted = errorsSpy();
      const HOUR = 60 * 60 * 1000;
      const listedEveryRun = () =>
        alerted.mock.calls.some(
          ([message, data]) =>
            message === 'tier_move.apply_failed' &&
            (
              (data as { left?: Array<{ subscriptionId: string }> }).left ?? []
            ).some((left) => left.subscriptionId === b.row.id)
        );

      // 1, 2 and 25 whole hours overdue, as three of the cron's runs.
      const alertsAt = async (overdueMs: number) => {
        alerted.mockClear();
        const result = await service.runTierMoveBackstop({
          now: new Date(due + overdueMs),
        });
        expect(result.blocked).toBeGreaterThanOrEqual(1);
        expect(listedEveryRun()).toBe(false);
        return blockedAlertsFor(alerted, b.row.id).length;
      };
      expect(await alertsAt(1.5 * HOUR)).toBe(1);
      expect(await alertsAt(2.5 * HOUR)).toBe(0);
      expect(await alertsAt(25.5 * HOUR)).toBe(1);
      expect(stripe.subscriptions.update).not.toHaveBeenCalledWith(
        b.row.stripeSubscriptionId,
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('the hourly backstop (§5.2)', () => {
    it('flips a move whose renewal is over an hour past; a younger one waits for its webhook', async () => {
      const { org, basic, premium } = await hollowOak('backstop');
      const old = await member(org.id, premium);
      const young = await member(org.id, premium);
      for (const m of [old, young]) {
        await service.changeTier(m.userId, org.id, basic.id, 'month');
        renew(m.row.stripeSubscriptionId);
      }
      // As the hourly run sees them: one renewed two hours ago, one just now.
      const now = Date.now();
      await db
        .update(subscriptions)
        .set({ pendingTierFrom: new Date(now - 2 * 60 * 60 * 1000) })
        .where(eq(subscriptions.id, old.row.id));
      await db
        .update(subscriptions)
        .set({ pendingTierFrom: new Date(now - 10 * 60 * 1000) })
        .where(eq(subscriptions.id, young.row.id));

      const result = await service.runTierMoveBackstop({ limit: 50 });

      expect(result.applied).toBeGreaterThanOrEqual(1);
      expect((await rowOf(old.row.id)).tierId).toBe(basic.id);
      expect((await rowOf(young.row.id)).tierId).toBe(premium.id);
      expect((await rowOf(young.row.id)).pendingTierId).toBe(basic.id);
    });

    it('one that fails is alerted with its ids and the run carries on; it never throws', async () => {
      const { org, basic, premium } = await hollowOak('backstop-fail');
      const failing = await member(org.id, premium);
      const fine = await member(org.id, premium);
      for (const m of [failing, fine]) {
        await service.changeTier(m.userId, org.id, basic.id, 'month');
        renew(m.row.stripeSubscriptionId);
        await db
          .update(subscriptions)
          .set({ pendingTierFrom: new Date(Date.now() - 3 * 60 * 60 * 1000) })
          .where(eq(subscriptions.id, m.row.id));
      }
      const realRetrieve = vi
        .mocked(stripe.subscriptions.retrieve)
        .getMockImplementation();
      vi.mocked(stripe.subscriptions.retrieve).mockImplementation(((
        id: string,
        ...rest: unknown[]
      ) => {
        if (id === failing.row.stripeSubscriptionId) {
          return Promise.reject(
            Object.assign(new Error('Stripe down'), { statusCode: 500 })
          );
        }
        return (realRetrieve as (...a: unknown[]) => unknown)(id, ...rest);
      }) as unknown as typeof stripe.subscriptions.retrieve);
      const obs = (
        service as unknown as {
          obs: { error: (m: string, d?: unknown) => void };
        }
      ).obs;
      const alerted = vi.spyOn(obs, 'error');

      const result = await service.runTierMoveBackstop({ limit: 50 });

      expect((await rowOf(fine.row.id)).tierId).toBe(basic.id);
      expect((await rowOf(failing.row.id)).tierId).toBe(premium.id);
      expect(result.left).toBeGreaterThanOrEqual(1);
      expect(alerted).toHaveBeenCalledWith(
        'tier_move.apply_failed',
        expect.objectContaining({
          errorId: expect.any(String),
          left: expect.arrayContaining([
            expect.objectContaining({ subscriptionId: failing.row.id }),
          ]),
        })
      );
    });
  });

  // ─── §2.3 What the screens read ─────────────────────────────────────────

  it('getSubscription and getUserSubscriptions carry pendingTierChange and heldAmountCents', async () => {
    const { org, basic, premium } = await hollowOak('reads');
    const { userId, periodEnd } = await member(org.id, premium);
    expect(
      (await service.getSubscription(userId, org.id))?.pendingTierChange
    ).toBeNull();

    await service.changeTier(userId, org.id, basic.id, 'month');

    const current = await service.getSubscription(userId, org.id);
    expect(current?.tier.id).toBe(premium.id);
    expect(current?.heldAmountCents).toBe(2000);
    expect(current?.amountCents).toBe(500);
    expect(current?.pendingTierChange).toEqual({
      tierId: basic.id,
      tierName: 'Basic',
      amountCents: 500,
      billingInterval: 'month',
      effectiveAt: new Date(periodEnd * 1000).toISOString(),
      laterPrice: null,
    });
    expect(current).not.toHaveProperty('pendingTierId');
    const [mine] = await service.getUserSubscriptions(userId);
    expect(mine?.pendingTierChange?.tierId).toBe(basic.id);
  });

  // T6: a member moving to a repriced tier moves at the price they confirmed,
  // then pays the new one from a later renewal. `laterPrice` is read from
  // their price-move row, never from Stripe (Codex-2hxff.86).
  it('pendingTierChange.laterPrice is the newest change on the target they were told about', async () => {
    const { org, basic, premium } = await hollowOak('reads-later');
    const { userId, row } = await member(org.id, premium);
    await service.changeTier(userId, org.id, basic.id, 'month');
    const reads = vi.mocked(stripe.subscriptions.retrieve);
    const laterOf = async () => {
      const before = reads.mock.calls.length;
      const [current, [mine]] = await Promise.all([
        service.getSubscription(userId, org.id),
        service.getUserSubscriptions(userId),
      ]);
      expect(reads.mock.calls.length).toBe(before);
      expect(mine?.pendingTierChange?.laterPrice).toEqual(
        current?.pendingTierChange?.laterPrice
      );
      return current?.pendingTierChange?.laterPrice;
    };
    const change = async (newAmountCents: number, createdAt: Date) =>
      takeFirst(
        await db
          .insert(priceChanges)
          .values({
            organizationId: org.id,
            kind: 'tier',
            tierId: basic.id,
            interval: 'month',
            fromAmountCents: 500,
            newAmountCents,
            newStripePriceId: `price_basic_${newAmountCents}`,
            state: 'running',
            createdAt,
          })
          .returning()
      );
    const effectiveAt = new Date(Date.now() + 45 * DAY * 1000);

    // Not told yet: nothing to show.
    const first = await change(600, new Date(Date.now() - 2 * 3_600_000));
    await db.insert(subscriptionPriceMoves).values({
      priceChangeId: first.id,
      subscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
      organizationId: org.id,
      userId,
    });
    expect(await laterOf()).toBeNull();

    // Told and scheduled.
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'scheduled',
        scheduledKind: 'pending',
        noticeAt: new Date(),
        effectiveAt,
      })
      .where(eq(subscriptionPriceMoves.priceChangeId, first.id));
    expect(await laterOf()).toEqual({
      amountCents: 600,
      effectiveAt: effectiveAt.toISOString(),
    });

    // A newer change replaces it; until they are told, the earlier one stands.
    await db
      .update(priceChanges)
      .set({ state: 'done', doneAt: new Date() })
      .where(eq(priceChanges.id, first.id));
    const second = await change(700, new Date(Date.now() - 3_600_000));
    await db.insert(subscriptionPriceMoves).values({
      priceChangeId: second.id,
      subscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
      organizationId: org.id,
      userId,
    });
    expect((await laterOf())?.amountCents).toBe(600);

    // Told about the newer one (its Stripe write still to land): it shows.
    const later = new Date(effectiveAt.getTime() + 30 * DAY * 1000);
    await db
      .update(subscriptionPriceMoves)
      .set({ state: 'notified', noticeAt: new Date(), effectiveAt: later })
      .where(eq(subscriptionPriceMoves.priceChangeId, second.id));
    expect(await laterOf()).toEqual({
      amountCents: 700,
      effectiveAt: later.toISOString(),
    });
  });

  // ─── §6.2 Deleting a tier people are moving to (T5) ─────────────────────

  it('deleteTier refuses a tier whose only "subscribers" are waiting movers, with both counts', async () => {
    const { org, basic, premium } = await hollowOak('delete-target');
    const { userId } = await member(org.id, premium);
    await service.changeTier(userId, org.id, basic.id, 'month');
    const tiers = new TierService(
      { db, dbWs: db, environment: 'test' },
      stripe
    );

    const refused = await tiers
      .deleteTier(basic.id, org.id, { onlyHere: 'keep' })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(TierHasSubscribersError);
    expect((refused as TierHasSubscribersError).context).toMatchObject({
      code: 'TIER_HAS_SUBSCRIBERS',
      subscriberCount: 0,
      movingInCount: 1,
    });
    const [still] = await db
      .select({ deletedAt: subscriptionTiers.deletedAt })
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.id, basic.id));
    expect(still?.deletedAt).toBeNull();
  });
});
