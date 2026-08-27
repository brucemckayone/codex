/**
 * Regression tests for the missing-`STRIPE_SECRET_KEY` failure mode
 * (Codex-1g5lh.1).
 *
 * Bug, as shipped: `organization-api-production` was deployed WITHOUT
 * `STRIPE_SECRET_KEY` — the production deploy uploaded it to ecom-api only —
 * while `workers/organization-api/.dev.vars` carried it, so every local run and
 * every CI run passed. Subscription tiers are org-scoped, so
 * `POST /api/organizations/:id/tiers` lives on that worker and
 * `TierService.createTier` reaches `stripe.products.create`. The service
 * registry's key guard threw a PLAIN `Error`, and `mapErrorToResponse` masks any
 * non-`ServiceError` as `500 INTERNAL_ERROR / "An unexpected error occurred"` —
 * indistinguishable from a DB fault, a Stripe outage or a genuine bug. "Create
 * Tier" returned a bare, untriageable 500.
 *
 * These tests are deliberately DATABASE-FREE. The defect is entirely
 * configuration + error typing; no query is involved on either side of it.
 *
 * They lock down three things:
 *   1. the guard throws a TYPED error carrying the stable
 *      `STRIPE_NOT_CONFIGURED` code — not a bare `INTERNAL_ERROR`;
 *   2. neither the message nor the context leaks the binding name, the key, or
 *      any other secret material to the client (`mapErrorToResponse` forwards
 *      a `ServiceError`'s message AND context verbatim);
 *   3. the WP-12 (Codex-fc5oh.12) guarantee still holds — with NO key bound,
 *      merely constructing the Stripe-backed services must not throw, so
 *      read-only zero-state endpoints keep working.
 */
import { mapErrorToResponse, ServiceError } from '@codex/service-errors';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  createServiceRegistry,
  requireStripeSecretKey,
} from '../service-registry';

/**
 * A worker env shaped like production-with-a-missing-secret: everything else is
 * present, `STRIPE_SECRET_KEY` is not.
 *
 * `DB_METHOD`/`DATABASE_URL` are supplied explicitly so the registry's DB client
 * can be CONSTRUCTED — `pg`'s Pool is lazy and nothing here issues a query, so
 * no database is required or contacted. Passing them explicitly also stops the
 * ambient `.env.test` (`DB_METHOD=LOCAL_PROXY`) leaking in and making these
 * tests depend on the local dev stack.
 */
function envWithoutStripeKey(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WORKER_SHARED_SECRET: 'test-worker-shared-secret',
  } as unknown as Bindings;
}

describe('requireStripeSecretKey (Codex-1g5lh.1)', () => {
  it('throws a typed ServiceError, not a plain Error', () => {
    let thrown: unknown;
    try {
      requireStripeSecretKey({ STRIPE_SECRET_KEY: undefined } as Pick<
        Bindings,
        'STRIPE_SECRET_KEY'
      >);
    } catch (error) {
      thrown = error;
    }

    // The whole defect: a plain Error here is what `mapErrorToResponse`
    // collapses into an opaque 500.
    expect(thrown).toBeInstanceOf(ServiceError);
  });

  it('carries the stable STRIPE_NOT_CONFIGURED code', () => {
    try {
      requireStripeSecretKey({ STRIPE_SECRET_KEY: undefined } as Pick<
        Bindings,
        'STRIPE_SECRET_KEY'
      >);
      throw new Error('expected requireStripeSecretKey to throw');
    } catch (error) {
      expect((error as ServiceError).code).toBe('STRIPE_NOT_CONFIGURED');
      expect((error as ServiceError).statusCode).toBe(500);
    }
  });

  it('treats an EMPTY key the same as an absent one', () => {
    // `wrangler secret bulk` with an unset GitHub secret uploads "" — that must
    // fail the same way, not construct a Stripe client with an empty key.
    expect(() =>
      requireStripeSecretKey({ STRIPE_SECRET_KEY: '' } as Pick<
        Bindings,
        'STRIPE_SECRET_KEY'
      >)
    ).toThrow(ServiceError);
  });

  it('returns the key unchanged when it IS configured', () => {
    expect(
      requireStripeSecretKey({ STRIPE_SECRET_KEY: 'sk_test_abc123' } as Pick<
        Bindings,
        'STRIPE_SECRET_KEY'
      >)
    ).toBe('sk_test_abc123');
  });

  it('reports the misconfiguration to observability without the key value', () => {
    const obs = { error: vi.fn() };

    expect(() =>
      requireStripeSecretKey(
        { STRIPE_SECRET_KEY: undefined } as Pick<Bindings, 'STRIPE_SECRET_KEY'>,
        'production',
        obs as never
      )
    ).toThrow();

    expect(obs.error).toHaveBeenCalledTimes(1);
    const [, context] = obs.error.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(context.environment).toBe('production');
    // The operator needs the binding NAME in the log; it must never carry a value.
    expect(JSON.stringify(obs.error.mock.calls[0])).not.toContain('sk_');
  });
});

describe('the wire response for a missing Stripe key (Codex-1g5lh.1)', () => {
  function mapTheGuardThrow() {
    try {
      requireStripeSecretKey({ STRIPE_SECRET_KEY: undefined } as Pick<
        Bindings,
        'STRIPE_SECRET_KEY'
      >);
      throw new Error('expected requireStripeSecretKey to throw');
    } catch (error) {
      return mapErrorToResponse(error, { logError: false });
    }
  }

  it('is NOT a bare INTERNAL_ERROR', () => {
    const { response } = mapTheGuardThrow();

    // This assertion is the bead's 2nd acceptance criterion. Before the fix the
    // code WAS 'INTERNAL_ERROR' and the message 'An unexpected error occurred'.
    expect(response.error.code).not.toBe('INTERNAL_ERROR');
    expect(response.error.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('keeps the honest 500 — this is a server misconfiguration', () => {
    // Not 4xx: the request was well-formed and authorised. The server simply
    // cannot fulfil it until it is redeployed with the secret.
    expect(mapTheGuardThrow().statusCode).toBe(500);
  });

  it('carries generic human copy and leaks no configuration or secret material', () => {
    const { response } = mapTheGuardThrow();
    const onTheWire = JSON.stringify(response);

    expect(onTheWire).not.toContain('STRIPE_SECRET_KEY');
    expect(onTheWire).not.toContain('sk_');
    expect(onTheWire).not.toContain('acct_');
    // Generic, user-facing, actionable-by-support only.
    expect(response.error.message).toMatch(/payment processing/i);
    expect(response.error.message).toMatch(/support/i);
  });
});

describe('service registry with NO Stripe key bound (WP-12 no-regression)', () => {
  /**
   * The Stripe-backed getters, and the runtime field each one stores the lazy
   * proxy in. WP-12 made resolution lazy so these could be CONSTRUCTED without
   * a key; Codex-1g5lh.1 must not undo that.
   */
  const stripeBackedGetters = [
    'purchase',
    'subscription',
    'tier',
    'connect',
    'courseSubscription',
  ] as const;

  it.each(
    stripeBackedGetters
  )('constructs ctx.services.%s without throwing', async (name) => {
    const { registry, cleanup } = createServiceRegistry(
      envWithoutStripeKey(),
      undefined,
      'org-1'
    );

    try {
      // A brand-new creator's Connect status, earnings summary and tier LIST
      // are all pure DB reads. Before WP-12 the getter itself threw, turning
      // them into 500s. That must stay fixed.
      expect(() => registry[name]).not.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('throws the TYPED error the moment a Stripe call is actually attempted', async () => {
    const { registry, cleanup } = createServiceRegistry(
      envWithoutStripeKey(),
      undefined,
      'org-1'
    );

    try {
      // `TierService` stores the lazy proxy privately; reaching it through the
      // real registry is what proves the whole chain — getter -> lazy proxy ->
      // requireStripeSecretKey -> typed throw — rather than the guard alone.
      const tier = registry.tier as unknown as {
        stripe: Record<string, unknown>;
      };

      let thrown: unknown;
      try {
        // `createTier`'s first real Stripe touch is `stripe.products.create`.
        void tier.stripe.products;
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ServiceError);
      expect((thrown as ServiceError).code).toBe('STRIPE_NOT_CONFIGURED');
    } finally {
      await cleanup();
    }
  });
});
