/**
 * The webhook + cron composition root (Codex-2hxff.54).
 *
 * Webhooks and crons used to build services by hand with only `{ db,
 * environment }`, so configured fees, the money mailers and the web-app URL
 * never reached them (Codex-2hxff.7, .13). These pin that the factory hands
 * them the registry's full graph, uses the webhook's own Stripe client, stays
 * on the Neon driver, and closes the pool only after background work settles.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as db-background-wiring.test.ts).
 */
import type { Bindings } from '@codex/shared-types';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../procedure/service-registry';
import { createWebhookServices } from '../webhook-services';

type DeferFn = (promise: Promise<unknown>) => void;

const hyperdriveClient = vi.hoisted(() =>
  vi.fn(async () => ({ db: {}, cleanup: async () => {} }))
);
vi.mock('@codex/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codex/database')>()),
  createHyperdriveDbClient: hyperdriveClient,
}));

function testEnv(extra: Record<string, unknown> = {}): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
    ...extra,
  } as unknown as Bindings;
}

function fakeExecutionCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

/** Read private constructor deps without widening the production types. */
function depsOf(service: object) {
  return service as {
    feeConfig?: unknown;
    mailer?: unknown;
    payoutMailer?: unknown;
    webAppUrl?: unknown;
    stripe: Stripe;
  };
}

describe('createWebhookServices', () => {
  it('gives the money services the fee config, mailers and web-app URL that routes get', async () => {
    const ctx = fakeExecutionCtx();
    const { services, release } = await createWebhookServices(testEnv(), ctx);
    try {
      const purchase = depsOf(services.purchase);
      const subscription = depsOf(services.subscription);
      const courseSubscription = depsOf(services.courseSubscription);

      for (const service of [purchase, subscription, courseSubscription]) {
        expect(service.feeConfig).toBe(services.feeConfig);
        expect(service.mailer).toBeTypeOf('function');
        expect(service.webAppUrl).toBe('https://app.example.test');
      }
      expect(subscription.payoutMailer).toBeTypeOf('function');
    } finally {
      release();
    }
  });

  it("uses the webhook's own Stripe client, so no key is read from env", async () => {
    const stripe = { paymentIntents: {} } as unknown as Stripe;
    const { services, release } = await createWebhookServices(
      testEnv(), // no STRIPE_SECRET_KEY: building a client from env would throw
      fakeExecutionCtx(),
      { stripe }
    );
    try {
      expect(depsOf(services.purchase).stripe.paymentIntents).toBe(
        stripe.paymentIntents
      );
      expect(depsOf(services.subscription).stripe.paymentIntents).toBe(
        stripe.paymentIntents
      );
    } finally {
      release();
    }
  });

  it('stays on the Neon driver where Hyperdrive is bound', async () => {
    const bound = testEnv({
      HYPERDRIVE: { connectionString: 'postgres://cached' },
      HYPERDRIVE_UNCACHED: { connectionString: 'postgres://uncached' },
    });

    // Calibrate the probe: the same env through a plain registry does use it.
    hyperdriveClient.mockClear();
    const plain = await createServiceRegistry(bound);
    await plain.cleanup();
    expect(hyperdriveClient).toHaveBeenCalledOnce();

    hyperdriveClient.mockClear();
    const { release } = await createWebhookServices(bound, fakeExecutionCtx());
    release();
    expect(hyperdriveClient).not.toHaveBeenCalled();
  });

  it('closes the pool only after the background work the services registered', async () => {
    const ctx = fakeExecutionCtx();
    const { services, release } = await createWebhookServices(testEnv(), ctx);

    // A service defers DB work (an email's recipient lookup) through its own
    // hook, as in production.
    const defer = (services.organization as { waitUntil: DeferFn }).waitUntil;
    let finishTask: () => void = () => {};
    defer(
      new Promise<void>((resolve) => {
        finishTask = resolve;
      })
    );

    release();
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    const teardown = ctx.waitUntil.mock.calls[0]?.[0] as Promise<unknown>;

    let tornDown = false;
    void teardown.then(() => {
      tornDown = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tornDown).toBe(false);

    finishTask();
    await teardown;
    expect(tornDown).toBe(true);
  });
});
