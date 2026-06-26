/**
 * Regression tests for `createLazyStripeProxy` (WP-12 · Codex-fc5oh.12).
 *
 * Bug: the service registry built the Stripe-backed services
 * (purchase/subscription/tier/connect) by resolving the Stripe client EAGERLY.
 * The resolver throws 'STRIPE_SECRET_KEY not configured' when the key is falsy,
 * so merely *accessing* `ctx.services.connect` threw at construction — turning a
 * brand-new creator's read-only Connect/earnings page (which never calls Stripe)
 * into a 500 INTERNAL_ERROR.
 *
 * Fix: inject a Proxy that defers resolution until the first property access.
 * These tests lock down that contract:
 *   - the resolver is NOT called at proxy creation (the core regression);
 *   - the resolver (and its throw) fires on first property access, so a genuine
 *     misconfiguration still surfaces the moment Stripe is actually used;
 *   - methods stay bound to the real client and nested resource namespaces pass
 *     through, so write paths behave identically to a direct client.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLazyStripeProxy } from '../service-registry';

describe('createLazyStripeProxy', () => {
  it('does NOT resolve the client at proxy creation (deferred)', () => {
    const resolve = vi.fn(() => ({}) as never);

    createLazyStripeProxy(resolve);

    // The eager-construction bug lived here: before the fix the resolver ran
    // synchronously while building the constructor argument.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves on first property access', () => {
    const client = { accounts: { create: vi.fn() } };
    const resolve = vi.fn(() => client as never);

    const proxy = createLazyStripeProxy(resolve);
    // touch a property
    void proxy.accounts;

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('propagates the resolver throw on access, not at creation', () => {
    const resolve = vi.fn(() => {
      throw new Error('STRIPE_SECRET_KEY not configured.');
    });

    // Creation must succeed even when the key is missing — this is what lets a
    // read-only zero-state endpoint render without ever touching Stripe.
    const proxy = createLazyStripeProxy(resolve);
    expect(resolve).not.toHaveBeenCalled();

    // A real Stripe call still surfaces the misconfiguration.
    expect(() => proxy.accounts).toThrow('STRIPE_SECRET_KEY not configured.');
  });

  it('binds methods to the real client so `this` resolves correctly', async () => {
    const client = {
      secret: 'sk_test',
      async whoAmI() {
        return this.secret;
      },
    };
    const proxy = createLazyStripeProxy(() => client as never);

    // If the method were returned unbound, `this` would be the proxy and the
    // call would re-trigger resolution / lose context.
    await expect((proxy as unknown as typeof client).whoAmI()).resolves.toBe(
      'sk_test'
    );
  });

  it('passes nested resource namespaces through untouched', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'acct_123' });
    const client = { accounts: { create } };
    const proxy = createLazyStripeProxy(() => client as never);

    const result = await (proxy as unknown as typeof client).accounts.create();

    expect(create).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 'acct_123' });
  });
});
