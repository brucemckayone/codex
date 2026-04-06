/**
 * Subscription Test Factories
 *
 * Factory functions for subscription-related test data:
 * - DB record factories for tiers, subscriptions, connect accounts
 * - Mock Stripe event payloads for webhook handler tests (v19 shapes)
 *
 * All factories use New* types from @codex/database/schema for DB inserts
 * and support partial overrides for per-test customization.
 */

import { randomUUID } from 'node:crypto';
import type {
  NewStripeConnectAccount,
  NewSubscription,
  NewSubscriptionTier,
} from '@codex/database/schema';

// ─── DB Record Factories ────────────────────────────────────────────────────

/**
 * Create a test subscription tier for DB insertion.
 */
export function createTestTierInput(
  orgId: string,
  overrides: Partial<NewSubscriptionTier> = {}
): NewSubscriptionTier {
  return {
    organizationId: orgId,
    name: `Tier ${Date.now()}`,
    description: 'Test tier description',
    sortOrder: 1,
    priceMonthly: 499,
    priceAnnual: 4990,
    stripeProductId: `prod_test_${randomUUID().slice(0, 8)}`,
    stripePriceMonthlyId: `price_monthly_${randomUUID().slice(0, 8)}`,
    stripePriceAnnualId: `price_annual_${randomUUID().slice(0, 8)}`,
    isActive: true,
    ...overrides,
  };
}

/**
 * Create a test subscription record for DB insertion.
 */
export function createTestSubscriptionInput(
  userId: string,
  orgId: string,
  tierId: string,
  overrides: Partial<NewSubscription> = {}
): NewSubscription {
  const now = new Date();
  const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    userId,
    organizationId: orgId,
    tierId,
    stripeSubscriptionId: `sub_test_${randomUUID().slice(0, 8)}`,
    stripeCustomerId: `cus_test_${randomUUID().slice(0, 8)}`,
    status: 'active',
    billingInterval: 'month',
    currentPeriodStart: now,
    currentPeriodEnd: monthFromNow,
    amountCents: 499,
    platformFeeCents: 50,
    organizationFeeCents: 67,
    creatorPayoutCents: 382,
    ...overrides,
  };
}

/**
 * Create a test Stripe Connect account for DB insertion.
 */
export function createTestConnectAccountInput(
  orgId: string,
  userId: string,
  overrides: Partial<NewStripeConnectAccount> = {}
): NewStripeConnectAccount {
  return {
    organizationId: orgId,
    userId,
    stripeAccountId: `acct_test_${randomUUID().slice(0, 8)}`,
    status: 'active',
    chargesEnabled: true,
    payoutsEnabled: true,
    onboardingCompletedAt: new Date(),
    ...overrides,
  };
}

// ─── Mock Stripe Event Payload Factories ────────────────────────────────────

/**
 * Create a mock Stripe Subscription object (v19 shape).
 *
 * IMPORTANT: Stripe v19 puts period dates on items.data[0], not subscription root.
 * The metadata fields (codex_user_id, codex_organization_id, codex_tier_id) are
 * used by webhook handlers to link Stripe data back to Codex DB records.
 */
export function createMockStripeSubscription(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const monthFromNow = now + 30 * 24 * 60 * 60;

  return {
    id: `sub_test_${randomUUID().slice(0, 8)}`,
    status: 'active',
    cancel_at_period_end: false,
    metadata: {
      codex_user_id: 'test_user_1',
      codex_organization_id: randomUUID(),
      codex_tier_id: randomUUID(),
    },
    customer: `cus_test_${randomUUID().slice(0, 8)}`,
    items: {
      data: [
        {
          id: `si_test_${randomUUID().slice(0, 8)}`,
          price: {
            id: `price_test_${randomUUID().slice(0, 8)}`,
            unit_amount: 499,
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

/**
 * Create a mock Stripe Invoice object (v19 shape).
 *
 * IMPORTANT: Stripe v19 uses:
 * - parent.subscription_details.subscription for subscription ID
 * - payments.data[] array (not direct charge field)
 */
export function createMockStripeInvoice(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const monthFromNow = now + 30 * 24 * 60 * 60;

  return {
    id: `in_test_${randomUUID().slice(0, 8)}`,
    amount_paid: 499,
    currency: 'gbp',
    status: 'paid',
    // v19: subscription ID via parent.subscription_details
    parent: {
      subscription_details: {
        subscription: `sub_test_${randomUUID().slice(0, 8)}`,
      },
    },
    // v19: payments array instead of direct charge field
    payments: {
      data: [
        {
          payment: {
            payment_intent: `pi_test_${randomUUID().slice(0, 8)}`,
            charge: `ch_test_${randomUUID().slice(0, 8)}`,
          },
        },
      ],
    },
    lines: {
      data: [
        {
          period: {
            start: now,
            end: monthFromNow,
          },
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Create a mock Stripe Account object for Connect webhook tests.
 *
 * Uses controller properties (not legacy Express/Standard/Custom types)
 * per Stripe's current best practices.
 */
export function createMockStripeAccount(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: `acct_test_${randomUUID().slice(0, 8)}`,
    charges_enabled: true,
    payouts_enabled: true,
    country: 'GB',
    metadata: {
      codex_organization_id: randomUUID(),
      codex_user_id: 'test_user_1',
    },
    requirements: {
      currently_due: [],
      disabled_reason: null,
    },
    controller: {
      stripe_dashboard: { type: 'express' },
      fees: { payer: 'application' },
      losses: { payments: 'application' },
    },
    capabilities: {
      card_payments: 'active',
      transfers: 'active',
    },
    ...overrides,
  };
}
