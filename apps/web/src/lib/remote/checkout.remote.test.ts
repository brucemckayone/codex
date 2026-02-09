/**
 * Checkout Remote Functions Tests
 *
 * Tests for Stripe checkout remote functions.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock SvelteKit server modules before importing
vi.mock('$app/server', () => ({
  command: vi.fn((_schema, fn) => fn),
  form: vi.fn((_schema, fn) => fn),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn() },
    url: new URL('http://localhost:3000'),
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    checkout: {
      create: vi.fn(),
    },
  })),
}));

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
