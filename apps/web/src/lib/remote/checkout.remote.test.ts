/**
 * Checkout Remote Functions Tests
 *
 * Tests for Stripe checkout remote functions.
 * Mocks are centralized in src/tests/mocks.ts
 */

import { describe, expect, it, vi } from 'vitest';

// Additional mock for @sveltejs/kit redirect function
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

describe('remote/checkout.remote', () => {
  it('exports createCheckout form', async () => {
    const { createCheckout } = await import('./checkout.remote');
    expect(createCheckout).toBeDefined();
  });

  it('exports createCheckoutSession command', async () => {
    const { createCheckoutSession } = await import('./checkout.remote');
    expect(createCheckoutSession).toBeDefined();
  });
});
