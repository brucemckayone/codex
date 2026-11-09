/**
 * Dev webhook router: every event production's endpoints take reaches the
 * handler production sends it to (Codex-2hxff.24).
 *
 * The Stripe CLI forwards every event to /webhooks/stripe/dev, so an event the
 * router does not match is only logged — a Dashboard edit to a tier's Product
 * would never sync in local dev, and nothing would say so.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../handlers/checkout', () => ({
  handleCheckoutCompleted: vi.fn(),
}));
vi.mock('../../handlers/connect-webhook', () => ({
  handleConnectWebhook: vi.fn(),
}));
vi.mock('../../handlers/payment-webhook', () => ({
  handlePaymentWebhook: vi.fn(),
}));
vi.mock('../../handlers/subscription-webhook', () => ({
  handleSubscriptionWebhook: vi.fn(),
}));

import { handleCheckoutCompleted } from '../../handlers/checkout';
import { handleConnectWebhook } from '../../handlers/connect-webhook';
import { handlePaymentWebhook } from '../../handlers/payment-webhook';
import { handleSubscriptionWebhook } from '../../handlers/subscription-webhook';
import type { StripeWebhookEnv } from '../../types';
import { routeDevWebhook } from '../dev-webhook-router';

const HANDLERS = {
  checkout: handleCheckoutCompleted,
  connect: handleConnectWebhook,
  payment: handlePaymentWebhook,
  subscription: handleSubscriptionWebhook,
} as const;

const stripe = {} as Stripe;
const c = { get: () => undefined } as unknown as Context<StripeWebhookEnv>;

function eventOf(type: string): Stripe.Event {
  return { id: `evt_${type}`, type } as unknown as Stripe.Event;
}

/** The handlers the router called, by name. */
function calledHandlers(): string[] {
  return Object.entries(HANDLERS)
    .filter(([, handler]) => vi.mocked(handler).mock.calls.length > 0)
    .map(([name]) => name);
}

describe('routeDevWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Production's subscription endpoint takes these three
  // (docs/payments/operations.md, "Webhook endpoints (production)").
  it.each([
    STRIPE_EVENTS.PRODUCT_UPDATED,
    STRIPE_EVENTS.PRICE_CREATED,
    STRIPE_EVENTS.PRICE_UPDATED,
  ])('sends %s to the subscription handler only', async (type) => {
    const event = eventOf(type);

    await routeDevWebhook(event, stripe, c);

    expect(calledHandlers()).toEqual(['subscription']);
    expect(handleSubscriptionWebhook).toHaveBeenCalledWith(event, stripe, c);
  });

  // Production's dispute endpoint takes it, into the payment handler.
  it('sends radar.early_fraud_warning.created to the payment handler only', async () => {
    const event = eventOf('radar.early_fraud_warning.created');

    await routeDevWebhook(event, stripe, c);

    expect(calledHandlers()).toEqual(['payment']);
    expect(handlePaymentWebhook).toHaveBeenCalledWith(event, stripe, c);
  });

  // The customer endpoint is gone: its events have no handler anywhere.
  it('sends customer.created to no handler', async () => {
    await routeDevWebhook(eventOf('customer.created'), stripe, c);

    expect(calledHandlers()).toEqual([]);
  });
});
