/**
 * stripe-client — unit tests.
 *
 * Focus: createLazyStripeClient (Codex-eys81). The @codex/access streaming
 * factory constructs a PurchaseService purely for its DB-backed verifyPurchase
 * method and must NOT require a Stripe key (content-api is not provisioned with
 * one). The lazy client must construct freely but fail loudly the moment a real
 * Stripe operation is attempted.
 */

import { describe, expect, it } from 'vitest';
import { createLazyStripeClient, createStripeClient } from '../stripe-client';

describe('createStripeClient', () => {
  it('throws immediately when the API key is empty', () => {
    expect(() => createStripeClient('')).toThrow('Stripe API key is required');
  });

  it('constructs a real client when given a key', () => {
    const client = createStripeClient('sk_test_dummy');
    expect(client).toBeDefined();
    expect(typeof client.checkout).toBe('object');
  });
});

describe('createLazyStripeClient', () => {
  it('constructs without throwing (no key needed)', () => {
    expect(() => createLazyStripeClient()).not.toThrow();
  });

  it('can be stored/passed around without triggering the failure', () => {
    const stripe = createLazyStripeClient();
    // Mirrors PurchaseService constructor: `this.stripe = stripe` — a plain
    // reference assignment must not trip the proxy.
    const holder: { stripe: unknown } = { stripe };
    expect(holder.stripe).toBe(stripe);
  });

  it('throws with a clear message the moment any Stripe API is accessed', () => {
    const stripe = createLazyStripeClient();
    expect(() => stripe.checkout).toThrow('Stripe API key is required');
    // Message names the accessed path to aid debugging.
    expect(() => stripe.checkout).toThrow(/attempted to use stripe\.checkout/);
    expect(() => stripe.transfers).toThrow('Stripe API key is required');
  });
});
