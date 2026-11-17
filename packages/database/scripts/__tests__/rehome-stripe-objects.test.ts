/**
 * The rehome of production's Stripe references (2026-11-06): a row changes
 * only when the current key is told its object is gone, the dry run's
 * checksum names exactly the changes, and an apply builds each new object as
 * the app builds it.
 *
 * Against a fake Stripe and fake writes; no database.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  apply,
  type PlanLine,
  planChecksum,
  type RehomeStripe,
  type RehomeWrites,
  type Rows,
  survey,
} from '../rehome-stripe-objects';

const gone = (code: string) =>
  Object.assign(new Error('gone'), { code, type: 'StripeInvalidRequestError' });

/** Stripe knows only the ids in `known`; others answer as the sandbox does. */
function fakeStripe(known: ReadonlySet<string>, other?: Record<string, Error>) {
  const read = (missingCode: string) =>
    vi.fn(async (id: string) => {
      if (other?.[id]) throw other[id];
      if (!known.has(id)) throw gone(missingCode);
      return { id, deleted: id.startsWith('cus_deleted') ? true : undefined };
    });
  let made = 0;
  const create = (prefix: string) =>
    vi.fn(async (_params: unknown, _options: { idempotencyKey: string }) => ({
      id: `${prefix}_new${++made}`,
    }));
  return {
    products: { retrieve: read('resource_missing'), create: create('prod') },
    prices: { create: create('price') },
    subscriptions: { retrieve: read('resource_missing') },
    accounts: { retrieve: read('account_invalid'), create: create('acct') },
    customers: { retrieve: read('resource_missing') },
  };
}

const asStripe = (fake: ReturnType<typeof fakeStripe>) =>
  fake as unknown as RehomeStripe;

function rows(): Rows {
  return {
    priced: [
      {
        kind: 'tier',
        id: 'tier-1',
        organizationId: 'org-1',
        courseId: null,
        name: 'test',
        description: 'A tier',
        priceMonthly: 500,
        priceAnnual: 5000,
        stripeProductId: 'prod_old_tier',
      },
      {
        kind: 'course plan',
        id: 'plan-1',
        organizationId: 'org-1',
        courseId: 'course-1',
        name: 'Stillness',
        description: null,
        priceMonthly: 900,
        priceAnnual: 9000,
        stripeProductId: 'prod_old_plan',
      },
    ],
    courseSubscriptions: [
      {
        id: 'cs-1',
        userId: 'user-1',
        courseId: 'course-1',
        stripeSubscriptionId: 'sub_old',
      },
    ],
    connect: [{ id: 'sca-1', userId: 'user-2', stripeAccountId: 'acct_old' }],
    customers: [
      { userId: 'user-1', stripeCustomerId: 'cus_old' },
      { userId: 'user-2', stripeCustomerId: 'cus_here' },
    ],
    history: { purchases: 1, payouts: 3 },
  };
}

function fakeWrites(result = true) {
  return {
    swapPricedIds: vi.fn(async () => result),
    endCourseSubscription: vi.fn(async () => result),
    replaceConnectAccount: vi.fn(async () => result),
    clearCustomer: vi.fn(async () => result),
  } satisfies RehomeWrites;
}

const actions = (lines: readonly PlanLine[]) =>
  Object.fromEntries(lines.map((l) => [`${l.kind}:${l.rowId}`, l.action]));

describe('survey', () => {
  it('changes only the rows whose object the key cannot see', async () => {
    const lines = await survey(
      asStripe(fakeStripe(new Set(['cus_here']))),
      rows()
    );
    expect(actions(lines)).toEqual({
      'tier:tier-1': 'move',
      'course plan:plan-1': 'move',
      'course subscription:cs-1': 'end',
      'connect account:sca-1': 'replace',
      'customer:user-1': 'clear',
      'customer:user-2': 'keep',
    });
  });

  it('keeps every row whose object is on this account', async () => {
    const all = new Set([
      'prod_old_tier',
      'prod_old_plan',
      'sub_old',
      'acct_old',
      'cus_old',
      'cus_here',
    ]);
    const lines = await survey(asStripe(fakeStripe(all)), rows());
    expect(lines.every((l) => l.action === 'keep')).toBe(true);
  });

  it('skips, and never changes, a row on any other Stripe error', async () => {
    const lines = await survey(
      asStripe(
        fakeStripe(new Set(), {
          prod_old_tier: gone('rate_limit'),
          // A Connect account is gone only on account_invalid.
          acct_old: gone('resource_missing'),
        })
      ),
      rows()
    );
    expect(actions(lines)['tier:tier-1']).toBe('skip: Stripe error rate_limit');
    expect(actions(lines)['connect account:sca-1']).toBe(
      'skip: Stripe error resource_missing'
    );
  });

  it('clears a customer Stripe reports deleted', async () => {
    const r = rows();
    r.customers = [{ userId: 'user-3', stripeCustomerId: 'cus_deleted_1' }];
    const lines = await survey(
      asStripe(fakeStripe(new Set(['cus_deleted_1']))),
      r
    );
    expect(actions(lines)['customer:user-3']).toBe('clear');
  });
});

describe('planChecksum', () => {
  const line = (rowId: string, action: PlanLine['action']): PlanLine => ({
    kind: 'customer',
    rowId,
    stripeId: `cus_${rowId}`,
    action,
  });

  it('names the changes only, in any order', () => {
    const a = planChecksum([
      line('a', 'clear'),
      line('b', 'keep'),
      line('c', 'clear'),
    ]);
    const b = planChecksum([
      line('c', 'clear'),
      line('a', 'clear'),
      line('d', 'skip: Stripe error x'),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs when a change differs', () => {
    expect(planChecksum([line('a', 'clear')])).not.toBe(
      planChecksum([line('b', 'clear')])
    );
  });
});

describe('apply', () => {
  it('writes nothing for a plan with no changes', async () => {
    const stripe = fakeStripe(new Set());
    const writes = fakeWrites();
    const r = rows();
    const keepAll: PlanLine[] = [];
    const result = await apply(
      { stripe: asStripe(stripe), writes, print: () => {} },
      r,
      keepAll,
      'production'
    );
    expect(result).toEqual({ done: 0, unchanged: 0 });
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(Object.values(writes).every((w) => w.mock.calls.length === 0)).toBe(
      true
    );
  });

  it('builds each object as the app does, tagged for the environment', async () => {
    const stripe = fakeStripe(new Set(['cus_here']));
    const writes = fakeWrites();
    const r = rows();
    const lines = await survey(asStripe(stripe), r);
    const result = await apply(
      { stripe: asStripe(stripe), writes, print: () => {} },
      r,
      lines,
      'production'
    );
    expect(result).toEqual({ done: 5, unchanged: 0 });

    // TierService.createTier's Product, and CourseSubscriptionService's.
    expect(stripe.products.create.mock.calls[0]?.[0]).toEqual({
      name: 'test',
      description: 'A tier',
      metadata: {
        codex_organization_id: 'org-1',
        codex_type: 'subscription_tier',
        codex_env: 'production',
      },
    });
    expect(stripe.products.create.mock.calls[1]?.[0]).toEqual({
      name: 'Stillness — Subscription',
      metadata: {
        codex_organization_id: 'org-1',
        codex_course_id: 'course-1',
        codex_type: 'course_subscription',
        codex_env: 'production',
      },
    });
    // The tier's two Prices: GBP, its amounts, monthly then yearly.
    const tierPrices = stripe.prices.create.mock.calls
      .slice(0, 2)
      .map((c) => c[0]);
    expect(tierPrices).toEqual([
      {
        product: 'prod_new1',
        unit_amount: 500,
        currency: 'gbp',
        recurring: { interval: 'month' },
        metadata: {
          codex_organization_id: 'org-1',
          interval: 'month',
          codex_env: 'production',
        },
      },
      {
        product: 'prod_new1',
        unit_amount: 5000,
        currency: 'gbp',
        recurring: { interval: 'year' },
        metadata: {
          codex_organization_id: 'org-1',
          interval: 'year',
          codex_env: 'production',
        },
      },
    ]);
    // createAccountForUser's Express account.
    expect(stripe.accounts.create.mock.calls[0]?.[0]).toMatchObject({
      controller: { stripe_dashboard: { type: 'express' } },
      settings: {
        payouts: {
          schedule: { interval: 'manual' },
          debit_negative_balances: false,
        },
      },
      country: 'GB',
      metadata: { codex_user_id: 'user-2', codex_env: 'production' },
    });

    expect(writes.swapPricedIds).toHaveBeenCalledWith(r.priced[0], {
      productId: 'prod_new1',
      monthlyId: expect.stringMatching(/^price_new/),
      annualId: expect.stringMatching(/^price_new/),
    });
    expect(writes.endCourseSubscription).toHaveBeenCalledWith(
      r.courseSubscriptions[0]
    );
    expect(writes.replaceConnectAccount).toHaveBeenCalledWith(
      r.connect[0],
      expect.stringMatching(/^acct_new/)
    );
    expect(writes.clearCustomer).toHaveBeenCalledTimes(1);
    expect(writes.clearCustomer).toHaveBeenCalledWith(r.customers[0]);
  });

  it('keys every Stripe create to its row, so a re-run makes nothing new', async () => {
    const stripe = fakeStripe(new Set(['cus_here']));
    const r = rows();
    const lines = await survey(asStripe(stripe), r);
    await apply(
      { stripe: asStripe(stripe), writes: fakeWrites(), print: () => {} },
      r,
      lines,
      'production'
    );
    const keys = [
      ...stripe.products.create.mock.calls,
      ...stripe.prices.create.mock.calls,
      ...stripe.accounts.create.mock.calls,
    ].map((c) => (c as unknown[])[1] as { idempotencyKey: string });
    expect(keys.map((k) => k.idempotencyKey).sort()).toEqual(
      [
        'rehome-production-connect-user-2',
        'rehome-production-plan-plan-1-annual-9000',
        'rehome-production-plan-plan-1-monthly-900',
        'rehome-production-plan-plan-1-product',
        'rehome-production-tier-tier-1-annual-5000',
        'rehome-production-tier-tier-1-monthly-500',
        'rehome-production-tier-tier-1-product',
      ].sort()
    );
  });

  it('counts a row that changed under it, and does not count it done', async () => {
    const stripe = fakeStripe(new Set(['cus_here']));
    const r = rows();
    const lines = await survey(asStripe(stripe), r);
    const result = await apply(
      { stripe: asStripe(stripe), writes: fakeWrites(false), print: () => {} },
      r,
      lines,
      'production'
    );
    expect(result).toEqual({ done: 0, unchanged: 5 });
  });
});
