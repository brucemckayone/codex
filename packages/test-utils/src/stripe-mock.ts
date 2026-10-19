/**
 * Stripe Mock Utility for Tests
 *
 * Provides a factory for creating mock Stripe client instances with
 * vi.fn() spies on all methods used by subscription services.
 *
 * Each method returns a PROMISE of a sensible default matching the Stripe v19
 * API shape. Auto-incrementing IDs ensure unique references per test.
 *
 * The async-ness matters: the real SDK returns promises, so service code chains
 * `.catch()` / `.then()` on these calls (e.g. the orphaned-product cleanup in
 * CourseSubscriptionService). A mock that returned a bare object made every such
 * error-handling path crash with "…is not a function" the moment a test reached
 * it — which silently kept those paths untested (fixed in Codex-2pryk.2.4.1).
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
  // Per mock instance, so tests never see each other's transfers.
  const createdTransfers: Array<{
    id: string;
    created: number;
    destination: unknown;
    metadata: unknown;
    [key: string]: unknown;
  }> = [];
  const transfersByKey = new Map<string, (typeof createdTransfers)[number]>();
  const mock = {
    products: {
      create: vi
        .fn()
        .mockImplementation(async (params: Record<string, unknown>) => ({
          id: nextId('prod'),
          name: params.name ?? 'Test Product',
          active: true,
          metadata: params.metadata ?? {},
        })),
      update: vi
        .fn()
        .mockImplementation(
          async (_id: string, params: Record<string, unknown>) => ({
            id: _id,
            name: params.name ?? 'Updated Product',
            active: params.active ?? true,
            metadata: params.metadata ?? {},
          })
        ),
    },

    prices: {
      create: vi
        .fn()
        .mockImplementation(async (params: Record<string, unknown>) => ({
          id: nextId('price'),
          unit_amount: params.unit_amount ?? 999,
          currency: params.currency ?? 'gbp',
          recurring: params.recurring ?? { interval: 'month' },
          product: params.product ?? 'prod_test_1',
          active: true,
        })),
      update: vi
        .fn()
        .mockImplementation(
          async (_id: string, params: Record<string, unknown>) => ({
            id: _id,
            active: params.active ?? true,
          })
        ),
    },

    accounts: {
      create: vi
        .fn()
        .mockImplementation(async (params: Record<string, unknown>) => ({
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
      createLoginLink: vi
        .fn()
        .mockImplementation(async (_accountId: string) => ({
          url: `https://connect.stripe.com/express/login/${_accountId}`,
        })),
    },

    accountLinks: {
      create: vi.fn().mockImplementation(async () => ({
        url: `https://connect.stripe.com/setup/${nextId('al')}`,
      })),
    },

    checkout: {
      sessions: {
        create: vi.fn().mockImplementation(async () => {
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
        .mockImplementation(async (_subId: string) =>
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
      // Stripe v19 exposes `subscriptions.resume(id, params?, options?)`
      // for resuming a PAUSED subscription. The mock returns a freshly
      // active subscription so the service's downstream DB flip matches
      // a realistic response shape (status='active'). See
      // SubscriptionResumeParams in stripe-node types.
      resume: vi.fn().mockImplementation(async (_subId: string) => ({
        ...createDefaultStripeSubscription({ id: _subId }),
        status: 'active',
      })),
    },

    // Transfers are remembered so `list` can return them: a drain looks up
    // the transfers it already made before re-sending a row (Codex-2hxff.11).
    // Like Stripe, a repeated idempotency key returns the first transfer
    // instead of making another — so a test that counts transfers can tell a
    // key collision from a real second payment.
    transfers: {
      create: vi
        .fn()
        .mockImplementation(
          async (
            params: Record<string, unknown>,
            options?: { idempotencyKey?: string }
          ) => {
            const key = options?.idempotencyKey;
            const replayed = key ? transfersByKey.get(key) : undefined;
            if (replayed) return replayed;
            const transfer = {
              id: nextId('tr'),
              object: 'transfer',
              created: Math.floor(Date.now() / 1000),
              amount: params.amount ?? 0,
              currency: params.currency ?? 'gbp',
              destination: params.destination ?? 'acct_test_1',
              source_transaction: params.source_transaction ?? null,
              transfer_group: params.transfer_group ?? null,
              metadata: params.metadata ?? {},
            };
            createdTransfers.unshift(transfer);
            if (key) transfersByKey.set(key, transfer);
            return transfer;
          }
        ),
      // Newest first, like Stripe; honours destination, created.gte, limit
      // (Stripe's default 10) and starting_after.
      list: vi
        .fn()
        .mockImplementation(
          async (
            params: {
              destination?: string;
              created?: { gte?: number };
              limit?: number;
              starting_after?: string;
            } = {}
          ) => {
            let matching = createdTransfers.filter(
              (t) =>
                (!params.destination || t.destination === params.destination) &&
                (params.created?.gte === undefined ||
                  t.created >= params.created.gte)
            );
            if (params.starting_after) {
              const after = matching.findIndex(
                (t) => t.id === params.starting_after
              );
              matching = after === -1 ? [] : matching.slice(after + 1);
            }
            const limit = params.limit ?? 10;
            return {
              object: 'list',
              data: matching.slice(0, limit),
              has_more: matching.length > limit,
            };
          }
        ),
      createReversal: vi
        .fn()
        .mockImplementation(
          async (transferId: string, params: { amount?: number } = {}) => ({
            id: nextId('trr'),
            object: 'transfer_reversal',
            transfer: transferId,
            amount:
              params.amount ??
              createdTransfers.find((t) => t.id === transferId)?.amount ??
              0,
          })
        ),
    },

    paymentIntents: {
      retrieve: vi.fn().mockImplementation(async (_piId: string) => ({
        id: _piId,
        latest_charge: nextId('ch'),
      })),
    },

    // invoices.retrieve and charges.list back the Stripe 2024+ fallback
    // chain in resolveInvoiceCharge — see
    // packages/payments/src/invoice-charge.ts. Default returns an empty payments array so
    // tests that don't override see the "no charge resolvable" branch.
    invoices: {
      retrieve: vi.fn().mockImplementation(async (_id: string) => ({
        id: _id,
        payments: { data: [] },
      })),
    },

    charges: {
      list: vi.fn().mockImplementation(async () => ({
        object: 'list',
        data: [],
        has_more: false,
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
