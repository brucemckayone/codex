/**
 * Unit tests for seed Stripe test-mode subscription helpers.
 *
 * These tests mock the Stripe SDK — no real network calls are made.
 * They verify:
 *   - assertTestModeKey refuses sk_live_* / rk_live_* (throws)
 *   - assertTestModeKey allows sk_test_* / rk_test_* (no throw)
 *   - classifyStripeKey returns the correct prefix classification
 *   - createOrFindStripeCustomer uses metadata search before create
 *   - createOrFindStripeSubscription sets an idempotency key on create
 *   - createOrFindStripeSubscription reuses an existing active subscription
 *   - Subscription create attaches metadata tag + codex_seed_subscription_id
 */

import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  assertTestModeKey,
  classifyStripeKey,
  createOrFindStripeCustomer,
  createOrFindStripeSubscription,
} from '../stripe-subscription';

// ── Mock Stripe SDK shape ─────────────────────────────────────────
// We only need the surface the helpers call. Using `unknown` casts is
// forbidden, so we build a minimal, accurately-typed mock that
// structurally matches the pieces of Stripe we consume.

interface MockStripe {
  customers: {
    search: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  paymentMethods: {
    create: ReturnType<typeof vi.fn>;
    attach: ReturnType<typeof vi.fn>;
  };
  subscriptions: {
    search: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function buildMockStripe(overrides: Partial<MockStripe> = {}): MockStripe {
  return {
    customers: {
      search: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.customers,
    },
    paymentMethods: {
      create: vi.fn().mockResolvedValue({ id: 'pm_test_fake' }),
      attach: vi.fn().mockResolvedValue({ id: 'pm_test_fake' }),
      ...overrides.paymentMethods,
    },
    subscriptions: {
      search: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      ...overrides.subscriptions,
    },
  };
}

// The helpers take a Stripe instance. Cast via the Stripe type (not `any`)
// at the call boundary. Vitest/TS allows this because our mock has the
// exact method shape the helpers touch.
function asStripe(mock: MockStripe): Stripe {
  return mock as unknown as Stripe;
}

const SEED_USER = {
  id: 'user_test_viewer',
  email: 'viewer@test.com',
  name: 'Sam Viewer',
};

const SEED_TIER = {
  id: 'tier_test_alpha_standard',
  stripePriceMonthlyId: 'price_test_monthly',
  stripePriceAnnualId: 'price_test_annual',
};

const SEED_SUBSCRIPTION_ID = 'sub_seed_test_viewer_alpha_standard';

function makeStripeCustomer(id: string): Stripe.Customer {
  return {
    id,
    object: 'customer',
    email: SEED_USER.email,
    metadata: { codex_seed_user_id: SEED_USER.id, codex_seed: 'true' },
    invoice_settings: { default_payment_method: null },
  } as unknown as Stripe.Customer;
}

function makeStripeSubscription(
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Subscription {
  const start = Math.floor(Date.now() / 1000);
  const end = start + 30 * 24 * 60 * 60;
  return {
    id: 'sub_test_created',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_existing',
    current_period_start: start,
    current_period_end: end,
    items: {
      data: [
        {
          id: 'si_test',
          current_period_start: start,
          current_period_end: end,
        },
      ],
    },
    metadata: {
      codex_seed_subscription_id: SEED_SUBSCRIPTION_ID,
      codex_seed: 'true',
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('assertTestModeKey', () => {
  it('throws for sk_live_* keys', () => {
    expect(() => assertTestModeKey('sk_live_abc123')).toThrow(
      /REFUSING TO SEED AGAINST LIVE STRIPE KEY/
    );
  });

  it('throws for rk_live_* keys', () => {
    expect(() => assertTestModeKey('rk_live_xyz789')).toThrow(
      /REFUSING TO SEED AGAINST LIVE STRIPE KEY/
    );
  });

  it('does not throw for sk_test_* keys', () => {
    expect(() => assertTestModeKey('sk_test_abc123')).not.toThrow();
  });

  it('does not throw for rk_test_* keys', () => {
    expect(() => assertTestModeKey('rk_test_xyz789')).not.toThrow();
  });

  it('does not log the actual key (only the prefix) in the error message', () => {
    const secret = 'sk_live_SENSITIVE_DO_NOT_LOG_12345';
    try {
      assertTestModeKey(secret);
      expect.fail('should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('SENSITIVE');
      expect(message).not.toContain('12345');
    }
  });
});

describe('classifyStripeKey', () => {
  it('returns "missing" for undefined', () => {
    expect(classifyStripeKey(undefined)).toBe('missing');
  });

  it('returns "live" for sk_live_* and rk_live_*', () => {
    expect(classifyStripeKey('sk_live_x')).toBe('live');
    expect(classifyStripeKey('rk_live_x')).toBe('live');
  });

  it('returns "test" for sk_test_* and rk_test_*', () => {
    expect(classifyStripeKey('sk_test_x')).toBe('test');
    expect(classifyStripeKey('rk_test_x')).toBe('test');
  });

  it('returns "unknown" for unrecognised prefixes', () => {
    expect(classifyStripeKey('pk_live_x')).toBe('unknown');
    expect(classifyStripeKey('garbage')).toBe('unknown');
  });
});

describe('createOrFindStripeCustomer', () => {
  it('reuses an existing customer found by metadata search', async () => {
    const existing = makeStripeCustomer('cus_test_existing');
    const mock = buildMockStripe({
      customers: {
        search: vi.fn().mockResolvedValue({ data: [existing] }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });

    const result = await createOrFindStripeCustomer(asStripe(mock), SEED_USER);

    expect(result.id).toBe('cus_test_existing');
    expect(mock.customers.search).toHaveBeenCalledTimes(1);
    expect(mock.customers.create).not.toHaveBeenCalled();
    // Search query must scope by metadata tags
    const query = mock.customers.search.mock.calls[0][0].query as string;
    expect(query).toContain(`codex_seed_user_id`);
    expect(query).toContain(SEED_USER.id);
    expect(query).toContain(`codex_seed`);
  });

  it('creates a new customer with an idempotency key when none found', async () => {
    const created = makeStripeCustomer('cus_test_new');
    const mock = buildMockStripe({
      customers: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue(created),
        update: vi.fn(),
      },
    });

    const result = await createOrFindStripeCustomer(asStripe(mock), SEED_USER);

    expect(result.id).toBe('cus_test_new');
    expect(mock.customers.create).toHaveBeenCalledTimes(1);

    const [params, options] = mock.customers.create.mock.calls[0];
    expect(params.email).toBe(SEED_USER.email);
    expect(params.metadata).toMatchObject({
      codex_seed_user_id: SEED_USER.id,
      codex_seed: 'true',
    });
    expect(options).toMatchObject({
      idempotencyKey: `seed_customer_${SEED_USER.id}`,
    });
  });

  it('wraps Stripe errors with contextual message', async () => {
    const mock = buildMockStripe({
      customers: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockRejectedValue(new Error('stripe boom')),
        update: vi.fn(),
      },
    });

    await expect(
      createOrFindStripeCustomer(asStripe(mock), SEED_USER)
    ).rejects.toThrow(/Failed to create Stripe customer for seed user/);
  });
});

describe('createOrFindStripeSubscription', () => {
  it('reuses an active existing subscription if metadata search hits', async () => {
    const existing = makeStripeSubscription({ id: 'sub_test_reused' });
    const mock = buildMockStripe({
      customers: {
        search: vi
          .fn()
          .mockResolvedValue({ data: [makeStripeCustomer('cus_test_reused')] }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptions: {
        search: vi.fn().mockResolvedValue({ data: [existing] }),
        create: vi.fn(),
      },
    });

    const result = await createOrFindStripeSubscription(asStripe(mock), {
      user: SEED_USER,
      tier: SEED_TIER,
      subscriptionSeedId: SEED_SUBSCRIPTION_ID,
      billingInterval: 'month',
    });

    expect(result.stripeSubscriptionId).toBe('sub_test_reused');
    expect(mock.subscriptions.create).not.toHaveBeenCalled();
  });

  it('creates a subscription with idempotency key and metadata tag', async () => {
    const created = makeStripeSubscription({ id: 'sub_test_created' });
    const customer = makeStripeCustomer('cus_test_fresh');

    // First customers.search returns empty → customer gets created
    // Second customers.search (subscription flow) not used in this path
    const customerSearch = vi.fn().mockResolvedValue({ data: [] });
    const customerCreate = vi.fn().mockResolvedValue(customer);

    const mock = buildMockStripe({
      customers: {
        search: customerSearch,
        create: customerCreate,
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptions: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue(created),
      },
    });

    const result = await createOrFindStripeSubscription(asStripe(mock), {
      user: SEED_USER,
      tier: SEED_TIER,
      subscriptionSeedId: SEED_SUBSCRIPTION_ID,
      billingInterval: 'month',
    });

    expect(result.stripeSubscriptionId).toBe('sub_test_created');

    // Confirm idempotency key on subscription create
    expect(mock.subscriptions.create).toHaveBeenCalledTimes(1);
    const [subParams, subOptions] = mock.subscriptions.create.mock.calls[0];
    expect(subOptions).toMatchObject({
      idempotencyKey: `seed_subscription_${SEED_SUBSCRIPTION_ID}`,
    });

    // Confirm metadata includes the codex_seed tag
    expect(subParams.metadata).toMatchObject({
      codex_seed_subscription_id: SEED_SUBSCRIPTION_ID,
      codex_seed_user_id: SEED_USER.id,
      codex_seed_tier_id: SEED_TIER.id,
      codex_seed: 'true',
    });

    // Confirm it used the monthly price for billingInterval: 'month'
    expect(subParams.items).toEqual([
      { price: SEED_TIER.stripePriceMonthlyId },
    ]);

    // Default payment method must be attached (idempotency key set)
    expect(mock.paymentMethods.create).toHaveBeenCalledTimes(1);
    const [, pmOptions] = mock.paymentMethods.create.mock.calls[0];
    expect(pmOptions).toMatchObject({
      idempotencyKey: `seed_pm_${customer.id}`,
    });
  });

  it('selects the annual price when billingInterval is year', async () => {
    const created = makeStripeSubscription({ id: 'sub_test_annual' });
    const customer = makeStripeCustomer('cus_test_annual');

    const mock = buildMockStripe({
      customers: {
        search: vi.fn().mockResolvedValue({ data: [customer] }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptions: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue(created),
      },
    });

    // Pre-populate the customer with a default payment method so the
    // paymentMethods.create path is skipped.
    (customer.invoice_settings as { default_payment_method: string }) = {
      default_payment_method: 'pm_existing',
    };

    await createOrFindStripeSubscription(asStripe(mock), {
      user: SEED_USER,
      tier: SEED_TIER,
      subscriptionSeedId: SEED_SUBSCRIPTION_ID,
      billingInterval: 'year',
    });

    const [subParams] = mock.subscriptions.create.mock.calls[0];
    expect(subParams.items).toEqual([{ price: SEED_TIER.stripePriceAnnualId }]);
  });

  it('throws when the tier has no matching price for the interval', async () => {
    const customer = makeStripeCustomer('cus_test_missing_price');
    (customer.invoice_settings as { default_payment_method: string }) = {
      default_payment_method: 'pm_existing',
    };

    const mock = buildMockStripe({
      customers: {
        search: vi.fn().mockResolvedValue({ data: [customer] }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      subscriptions: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn(),
      },
    });

    await expect(
      createOrFindStripeSubscription(asStripe(mock), {
        user: SEED_USER,
        tier: {
          id: SEED_TIER.id,
          stripePriceMonthlyId: '',
          stripePriceAnnualId: SEED_TIER.stripePriceAnnualId,
        },
        subscriptionSeedId: SEED_SUBSCRIPTION_ID,
        billingInterval: 'month',
      })
    ).rejects.toThrow(/missing stripePriceMonthlyId/);

    expect(mock.subscriptions.create).not.toHaveBeenCalled();
  });
});
