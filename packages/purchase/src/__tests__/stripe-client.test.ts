/**
 * stripe-client — unit tests.
 *
 * The lazy client these once covered (Codex-eys81) is gone: the @codex/access
 * factory now takes the `verifyPurchase` read instead of a PurchaseService, so
 * content-api needs no Stripe client at all (rule A8, Codex-2hxff.55).
 */

import { describe, expect, it } from 'vitest';
import { createStripeClient } from '../stripe-client';

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
