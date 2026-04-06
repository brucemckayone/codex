/**
 * Stripe Mock Utility for Tests
 *
 * Provides a factory for creating mock Stripe client instances with
 * vi.fn() spies on all methods used by subscription services.
 *
 * Each method returns a sensible default that matches the Stripe v19 API
 * shape. Auto-incrementing IDs ensure unique references per test.
 *
 * Usage:
 * ```typescript
 * const stripe = createMockStripe();
 * const service = new TierService({ db, environment: 'test' }, stripe);
 *
 * // Verify calls after test action
 * expect(stripe.products.create).toHaveBeenCalledWith(
 *   expect.objectContaining({ name: 'Pro Tier' })
 * );
 * ```
 */

import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { vi } from 'vitest';

/**
 * Generate a globally unique mock Stripe ID.
 * Uses UUID suffix to prevent collisions across test runs
 * (important for shared local DBs where stripe_account_id is UNIQUE).
 */
function nextId(prefix: string): string {
  return `${prefix}_test_${randomUUID().slice(0, 12)}`;
}

/**
 * Create a mock Stripe client for subscription service testing.
 *
 * All namespaced methods are vi.fn() spies with realistic default return values.
 * Override per-test with `.mockResolvedValueOnce()`.
 *
 * Covers the Stripe v19 API shape:
 * - Period dates on subscription items (not subscription root)
 * - payments.data[] array on invoices
 * - parent.subscription_details for subscription ID on invoices
 * - Controller properties for Connect accounts (not legacy types)
 */
export function createMockStripe(): Stripe {
  const mock = {
    products: {
      create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
        id: nextId('prod'),
        name: params.name ?? 'Test Product',
        active: true,
        metadata: params.metadata ?? {},
      })),
      update: vi
        .fn()
        .mockImplementation((_id: string, params: Record<string, unknown>) => ({
          id: _id,
          name: params.name ?? 'Updated Product',
          active: params.active ?? true,
          metadata: params.metadata ?? {},
        })),
    },

    prices: {
      create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
        id: nextId('price'),
        unit_amount: params.unit_amount ?? 999,
        currency: params.currency ?? 'gbp',
        recurring: params.recurring ?? { interval: 'month' },
        product: params.product ?? 'prod_test_1',
        active: true,
      })),
      update: vi
        .fn()
        .mockImplementation((_id: string, params: Record<string, unknown>) => ({
          id: _id,
          active: params.active ?? true,
        })),
    },

    accounts: {
      create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
        id: nextId('acct'),
        charges_enabled: false,
        payouts_enabled: false,
        country: (params as { country?: string }).country ?? 'GB',
        metadata:
          (params as { metadata?: Record<string, string> }).metadata ?? {},
        requirements: {
          currently_due: [],
          disabled_reason: null,
        },
        controller: (params as { controller?: unknown }).controller ?? {},
      })),
      createLoginLink: vi.fn().mockImplementation((_accountId: string) => ({
        url: `https://connect.stripe.com/express/login/${_accountId}`,
      })),
    },

    accountLinks: {
      create: vi.fn().mockImplementation(() => ({
        url: `https://connect.stripe.com/setup/${nextId('al')}`,
      })),
    },

    checkout: {
      sessions: {
        create: vi.fn().mockImplementation(() => {
          const id = nextId('cs');
          return {
            id,
            url: `https://checkout.stripe.com/pay/${id}`,
          };
        }),
      },
    },

    subscriptions: {
      retrieve: vi
        .fn()
        .mockImplementation((_subId: string) =>
          createDefaultStripeSubscription({ id: _subId })
        ),
      update: vi
        .fn()
        .mockImplementation(
          (_subId: string, params: Record<string, unknown>) => ({
            ...createDefaultStripeSubscription({ id: _subId }),
            cancel_at_period_end: params.cancel_at_period_end ?? false,
          })
        ),
    },

    transfers: {
      create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
        id: nextId('tr'),
        amount: params.amount ?? 0,
        currency: params.currency ?? 'gbp',
        destination: params.destination ?? 'acct_test_1',
        source_transaction: params.source_transaction ?? null,
        transfer_group: params.transfer_group ?? null,
        metadata: params.metadata ?? {},
      })),
    },

    paymentIntents: {
      retrieve: vi.fn().mockImplementation((_piId: string) => ({
        id: _piId,
        latest_charge: nextId('ch'),
      })),
    },
  };

  return mock as unknown as Stripe;
}

/**
 * Create a default Stripe Subscription object (v19 shape).
 * Period dates are on items.data[0], not the subscription root.
 */
function createDefaultStripeSubscription(
  overrides: Record<string, unknown> = {}
) {
  const now = Math.floor(Date.now() / 1000);
  const monthFromNow = now + 30 * 24 * 60 * 60;
  return {
    id: (overrides.id as string) ?? nextId('sub'),
    status: 'active',
    cancel_at_period_end: false,
    metadata: {},
    items: {
      data: [
        {
          id: nextId('si'),
          price: {
            id: 'price_test_monthly',
            unit_amount: 999,
            currency: 'gbp',
            recurring: { interval: 'month' },
          },
          current_period_start: now,
          current_period_end: monthFromNow,
        },
      ],
    },
    ...overrides,
  };
}
