/**
 * POST /checkout/complete: the success page records the purchase on arrival
 * (Codex-2hxff.22; owner decision 2026-10-26, "Unlock on arrival").
 *
 * Two parts:
 * 1. The route's contract: who may call it, when it completes and when it
 *    only reads, and what each failure becomes.
 * 2. The race: the real webhook handler and the real route complete ONE
 *    session at once. They share a store standing in for the database, with
 *    the guards the real one has: one row per PaymentIntent, taken under a
 *    lock, and an atomic receipt claim. Those guards are proven against real
 *    Postgres in packages/purchase/src/__tests__/
 *    checkout-landing-race.integration.test.ts. This proves what the worker
 *    does around them happens once: one receipt sent, one library bump.
 *
 * Harness as in `checkout-verify-routes.test.ts`: a pass-through `procedure`
 * mock enforcing the auth gate and the body schema, invoking the real handler
 * and mapping errors through the real `mapErrorToResponse`. It records each
 * route's policy, so the rate limit is asserted too.
 */

import {
  AfterCommitError,
  ForbiddenError,
  mapErrorToResponse,
  NotFoundError,
  wrapError,
} from '@codex/service-errors';
import { createMockObservability } from '@codex/test-utils';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  policy?: { auth?: string; rateLimit?: string };
  input?: { body?: { safeParse: (v: unknown) => unknown } };
  handler: (ctx: unknown) => Promise<unknown>;
}

/** Each route handler's declared policy, keyed by the handler procedure made. */
const policyOf = vi.hoisted(
  () => new Map<unknown, ProcedureConfig['policy']>()
);

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    // The webhook gets its PurchaseService here; the route from ctx.services.
    createWebhookServices: vi.fn(),
    // The receipt: observed, never sent.
    sendEmailToWorker: vi.fn(),
    procedure: (config: ProcedureConfig) => {
      const route = async (c: {
        req: { json: () => Promise<unknown> };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        const user = c.get('__testUser') as { id: string } | null;
        if (config.policy?.auth === 'required' && !user) {
          return c.json(
            {
              error: {
                code: 'UNAUTHORIZED',
                message: 'Authentication required',
              },
            },
            401
          );
        }
        let body: unknown = {};
        if (config.input?.body) {
          const parsed = (
            config.input.body as unknown as {
              safeParse: (v: unknown) => { success: boolean; data?: unknown };
            }
          ).safeParse(await c.req.json().catch(() => undefined));
          if (!parsed.success) {
            return c.json(
              { error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
              400
            );
          }
          body = parsed.data;
        }
        try {
          const result = await config.handler({
            user,
            input: { body },
            services: c.get('__testServices'),
            env: c.get('__testEnv'),
            executionCtx: c.get('__testExecutionCtx'),
            obs: c.get('__testObs'),
          });
          return c.json({ data: result }, 200);
        } catch (error) {
          const { statusCode, response } = mapErrorToResponse(error, {
            logError: false,
          });
          return c.json(response, statusCode as 403 | 500);
        }
      };
      policyOf.set(route, config.policy);
      return route;
    },
  };
});

// The library bump: observed. Its KV write has its own tests in @codex/cache.
vi.mock('@codex/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/cache')>();
  return { ...actual, invalidateUserLibrary: vi.fn() };
});

import { invalidateUserLibrary } from '@codex/cache';
import type { Purchase } from '@codex/purchase';
import type { WebhookServices } from '@codex/worker-utils';
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
import { Hono } from 'hono';
import { handleCheckoutCompleted } from '../../handlers/checkout';
import checkout from '../checkout';

// A real user id: alphanumeric (userIdSchema), as the real metadata schema checks.
const BUYER = 'userBuyer1';
const CONTENT_ID = '7d0c9a4e-2f53-4c0e-9a1d-3b2f6a8e5c11';
const COURSE_ID = '408f94d0-5442-43d3-a56a-3491110962eb';
const ORG_ID = 'b1ea37e2-e03a-4e2d-ae70-0ac369ee2dca';
const PAYMENT_INTENT = 'pi_landing_1';
const CHARGE = 'ch_landing_1';
const EVENT_CREATED = 1_793_000_000;
const CHARGED_AT = new Date((EVENT_CREATED - 3) * 1000);

type Kind = 'content' | 'course';

function sessionFor(
  kind: Kind,
  overrides: Partial<Stripe.Checkout.Session> = {}
): Stripe.Checkout.Session {
  return {
    id: 'cs_landing_1',
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: PAYMENT_INTENT,
    amount_total: 2999,
    currency: 'gbp',
    created: EVENT_CREATED - 60,
    customer: 'cus_buyer_1',
    customer_details: { email: 'buyer@example.com', name: 'Bea' },
    metadata:
      kind === 'course'
        ? { kind: 'course', customerId: BUYER, courseId: COURSE_ID }
        : {
            customerId: BUYER,
            contentId: CONTENT_ID,
            organizationId: ORG_ID,
            contentTitle: 'Landing content',
          },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

/**
 * The database, as both callers see it: one row per PaymentIntent, written
 * under a lock (`pg_advisory_xact_lock` plus a second look), and the
 * receipt's atomic claim. `callers` makes completion wait until that many
 * callers are inside it, so neither commits before the other has started.
 */
function createStore(callers = 1) {
  let arrived = 0;
  let openBarrier: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    openBarrier = resolve;
  });
  let lock: Promise<void> = Promise.resolve();
  const store = {
    row: undefined as Purchase | undefined,
    inserts: 0,
    receipts: new Set<string>(),
    async complete(
      paymentIntentId: string,
      metadata: { customerId: string; contentId?: string; courseId?: string }
    ): Promise<Purchase> {
      arrived += 1;
      if (arrived >= callers) openBarrier();
      await barrier;
      const held = lock;
      let unlock: () => void = () => {};
      lock = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await held;
      try {
        if (!store.row) {
          store.inserts += 1;
          store.row = {
            id: 'purchase_landing_1',
            customerId: metadata.customerId,
            contentId: metadata.contentId ?? null,
            courseId: metadata.courseId ?? null,
            stripePaymentIntentId: paymentIntentId,
            status: 'completed',
            duplicateOfPurchaseId: null,
            disputedAt: null,
          } as unknown as Purchase;
        }
        return store.row;
      } finally {
        unlock();
      }
    },
    async claim(purchaseId: string): Promise<boolean> {
      if (store.receipts.has(purchaseId)) return false;
      store.receipts.add(purchaseId);
      return true;
    },
  };
  return store;
}

type Store = ReturnType<typeof createStore>;

/** One caller's PurchaseService over the shared store. */
function purchaseServiceOver(store: Store, session: Stripe.Checkout.Session) {
  const complete = vi.fn(
    (
      paymentIntentId: string,
      metadata: { customerId: string; contentId?: string; courseId?: string }
    ) => store.complete(paymentIntentId, metadata)
  );
  return {
    retrieveCheckoutSession: vi.fn(async () => session),
    readCheckoutSession: vi.fn(async () =>
      store.row
        ? {
            recorded: true,
            result: {
              sessionStatus: 'complete',
              state: 'unlocked',
              purchase: { id: store.row.id },
            },
          }
        : {
            recorded: false,
            result: { sessionStatus: 'complete', state: 'recording' },
          }
    ),
    retrievePaymentIntentCharge: vi.fn(async () => ({
      stripeChargeId: CHARGE,
      stripeApplicationFeeCents: null,
      chargedAt: CHARGED_AT,
    })),
    completePurchase: complete,
    completeCoursePurchase: complete,
    markCheckoutSessionCompleted: vi.fn(async () => undefined),
    claimReceipt: vi.fn((purchaseId: string) => store.claim(purchaseId)),
  };
}

type FakePurchaseService = ReturnType<typeof purchaseServiceOver>;

/**
 * Each path's bindings. Production shares one CACHE_KV; here each path has its
 * own handle, so a library bump can be told apart by the path that made it.
 */
const pageEnv = {
  CACHE_KV: { path: 'page' },
  WEB_APP_URL: 'https://app.test',
  ENVIRONMENT: 'test',
};
const webhookEnv = { ...pageEnv, CACHE_KV: { path: 'webhook' } };

/** The library bumps made, by the path that made them. */
function bumpsByPath() {
  const kvs = vi
    .mocked(invalidateUserLibrary)
    .mock.calls.map(([args]): unknown => args.kv);
  return {
    page: kvs.filter((kv) => kv === pageEnv.CACHE_KV).length,
    webhook: kvs.filter((kv) => kv === webhookEnv.CACHE_KV).length,
  };
}

function executionCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function buildApp(
  purchase: Partial<FakePurchaseService>,
  user: { id: string } | null = { id: BUYER }
) {
  const { obs } = createMockObservability();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('__testUser', user);
    c.set('__testServices', { purchase });
    c.set('__testEnv', pageEnv);
    c.set('__testExecutionCtx', executionCtx());
    c.set('__testObs', obs);
    await next();
  });
  app.route('/checkout', checkout as unknown as Hono);
  return { app, obs };
}

function complete(app: Hono<{ Variables: Record<string, unknown> }>) {
  return app.request('/checkout/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'cs_landing_1' }),
  });
}

/** The `state` a 200 answered with. */
async function stateOf(res: Response): Promise<string> {
  return ((await res.json()) as { data: { state: string } }).data.state;
}

/** The webhook's delivery of the same session, through its real handler. */
function deliverWebhook(session: Stripe.Checkout.Session) {
  const { obs } = createMockObservability();
  const context = {
    env: webhookEnv,
    executionCtx: executionCtx(),
    get: (key: string) => (key === 'obs' ? obs : undefined),
  };
  return handleCheckoutCompleted(
    {
      id: 'evt_landing_1',
      type: 'checkout.session.completed',
      created: EVENT_CREATED,
      data: { object: session },
    } as unknown as Stripe.Event,
    {
      paymentIntents: {
        retrieve: vi.fn(async () => ({
          application_fee_amount: null,
          latest_charge: CHARGE,
        })),
      },
    } as unknown as Stripe,
    context as never
  );
}

function webhookUses(purchase: FakePurchaseService) {
  vi.mocked(createWebhookServices).mockResolvedValue({
    services: { purchase } as unknown as WebhookServices['services'],
    background: (promise) => promise,
    release: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /checkout/complete', () => {
  it("declares auth 'required' and the 'strict' rate limit", () => {
    const route = (checkout as unknown as Hono).routes.find(
      (r) => r.method === 'POST' && r.path === '/complete'
    );
    expect(route).toBeDefined();
    expect(policyOf.get(route?.handler)).toEqual({
      auth: 'required',
      rateLimit: 'strict',
    });
  });

  it('401 without a session; nothing is read', async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    const { app } = buildApp(purchase, null);

    const res = await complete(app);

    expect(res.status).toBe(401);
    expect(purchase.retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it('400 without a sessionId; nothing is read', async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    const { app } = buildApp(purchase);

    const res = await app.request('/checkout/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(purchase.retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it("403 for another buyer's session, and completion never runs", async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.retrieveCheckoutSession.mockRejectedValueOnce(
      new ForbiddenError(
        'Checkout session does not belong to authenticated user',
        { sessionId: 'cs_landing_1' }
      )
    );
    const { app } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(403);
    expect(purchase.retrieveCheckoutSession).toHaveBeenCalledWith(
      'cs_landing_1',
      BUYER
    );
    expect(purchase.completePurchase).not.toHaveBeenCalled();
  });

  it("404 for another environment's session, and completion never runs", async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.retrieveCheckoutSession.mockRejectedValueOnce(
      new NotFoundError('Checkout session not found', {
        sessionId: 'cs_landing_1',
      })
    );
    const { app } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(404);
    expect(purchase.completePurchase).not.toHaveBeenCalled();
  });

  it.each([
    'open',
    'expired',
    'unpaid',
  ] as const)('a session that is %s is only read, never completed', async (state) => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.readCheckoutSession.mockResolvedValueOnce({
      recorded: false,
      result: {
        sessionStatus: state === 'unpaid' ? 'complete' : state,
        state,
      },
    } as never);
    const { app } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe(state);
    expect(purchase.completePurchase).not.toHaveBeenCalled();
    expect(purchase.retrievePaymentIntentCharge).not.toHaveBeenCalled();
  });

  it('our row already there: nothing is written', async () => {
    const store = createStore();
    const session = sessionFor('content');
    await store.complete(PAYMENT_INTENT, {
      customerId: BUYER,
      contentId: CONTENT_ID,
    });
    const purchase = purchaseServiceOver(store, session);
    const { app, obs } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe('unlocked');
    expect(purchase.completePurchase).not.toHaveBeenCalled();
    expect(purchase.claimReceipt).not.toHaveBeenCalled();
    expect(obs.info).toHaveBeenCalledWith(
      'Checkout completed from the success page',
      expect.objectContaining({ outcome: 'already_recorded' })
    );
  });

  it.each([
    'content',
    'course',
  ] as const)('paid with no row: the %s purchase is recorded once, at the charge time, and the receipt claimed', async (kind) => {
    const store = createStore();
    const purchase = purchaseServiceOver(store, sessionFor(kind));
    const { app, obs } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe('unlocked');
    expect(purchase.completePurchase).toHaveBeenCalledOnce();
    expect(purchase.completePurchase).toHaveBeenCalledWith(
      PAYMENT_INTENT,
      expect.objectContaining({
        customerId: BUYER,
        stripeChargeId: CHARGE,
        // No webhook event here: the charge's own `created` is the payment time.
        paidAt: CHARGED_AT,
        offerAt: new Date((EVENT_CREATED - 60) * 1000),
      })
    );
    expect(purchase.markCheckoutSessionCompleted).toHaveBeenCalledWith(
      'cs_landing_1'
    );
    expect(sendEmailToWorker).toHaveBeenCalledOnce();
    // The version the buyer's other tabs and devices read is bumped now, not
    // when the webhook finally lands.
    expect(invalidateUserLibrary).toHaveBeenCalledOnce();
    expect(invalidateUserLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: BUYER, kv: pageEnv.CACHE_KV })
    );
    expect(obs.info).toHaveBeenCalledWith(
      'Processing checkout.session.completed',
      expect.objectContaining({ trigger: 'landing' })
    );
    expect(obs.info).toHaveBeenCalledWith(
      'Checkout completed from the success page',
      expect.objectContaining({
        outcome: 'recorded',
        purchaseId: 'purchase_landing_1',
      })
    );
  });

  it('a permanent charge lookup failure still records the purchase, without the charge, as the webhook does', async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.retrievePaymentIntentCharge.mockRejectedValueOnce(
      wrapError(
        Object.assign(new Error('No such payment_intent'), {
          type: 'StripeInvalidRequestError',
          statusCode: 404,
        })
      )
    );
    const { app, obs } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(200);
    expect(purchase.completePurchase).toHaveBeenCalledWith(
      PAYMENT_INTENT,
      expect.objectContaining({ stripeChargeId: null })
    );
    expect(obs.warn).toHaveBeenCalledWith(
      'Could not retrieve PaymentIntent for fee reconciliation',
      expect.objectContaining({ paymentIntentId: PAYMENT_INTENT })
    );
  });

  it('a temporary charge lookup failure is a 503 and writes nothing', async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.retrievePaymentIntentCharge.mockRejectedValueOnce(
      wrapError(
        Object.assign(new Error('Connection to Stripe failed'), {
          type: 'StripeConnectionError',
        })
      )
    );
    const { app } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(503);
    expect(purchase.completePurchase).not.toHaveBeenCalled();
  });

  it('a temporary failure before the commit is a 503', async () => {
    const purchase = purchaseServiceOver(createStore(), sessionFor('content'));
    purchase.completePurchase.mockRejectedValueOnce(
      wrapError(
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
      )
    );
    const { app } = buildApp(purchase);

    const res = await complete(app);

    expect(res.status).toBe(503);
    expect(purchase.claimReceipt).not.toHaveBeenCalled();
  });

  describe('a failure after the purchase committed', () => {
    const transient = () =>
      Object.assign(new Error('Connection to Stripe failed'), {
        type: 'StripeConnectionError',
      });
    const permanent = () =>
      Object.assign(new Error('No such charge'), {
        type: 'StripeInvalidRequestError',
        statusCode: 404,
      });

    const FINISHED_BY = {
      temporary:
        'Recorded from the success page; the webhook finishes the rest',
      permanent: 'Recorded from the success page; support must finish the rest',
    } as const;

    it.each([
      ['temporary', transient, 0],
      ['permanent', permanent, 1],
    ] as const)('%s clawback failure: 200, the page unlocks, a warn line, and the receipt only when no retry will send it', async (label, cause, receipts) => {
      const store = createStore();
      const purchase = purchaseServiceOver(store, sessionFor('content'));
      purchase.completePurchase.mockImplementationOnce(
        async (paymentIntentId, metadata) => {
          const row = await store.complete(paymentIntentId, metadata);
          throw new AfterCommitError('clawback failed', row, cause());
        }
      );
      const { app, obs } = buildApp(purchase);

      const res = await complete(app);

      expect(res.status).toBe(200);
      expect(await stateOf(res)).toBe('unlocked');
      expect(obs.warn).toHaveBeenCalledWith(
        FINISHED_BY[label],
        expect.objectContaining({
          purchaseId: 'purchase_landing_1',
          errorId: expect.any(String),
          transient: label === 'temporary',
        })
      );
      expect(sendEmailToWorker).toHaveBeenCalledTimes(receipts);
    });

    // A payout slice that could not be written is thrown raw, not returned as
    // an AfterCommitError, after the purchase committed. The buyer still
    // gets `unlocked`, never a 503 or 500 (purchases.md, Errors).
    it.each([
      [
        'temporary',
        'ECONNRESET',
        () =>
          wrapError(
            Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
          ),
      ],
      [
        'permanent',
        '23514',
        () =>
          wrapError(
            Object.assign(new Error('violates check constraint'), {
              code: '23514',
            })
          ),
      ],
    ] as const)('%s slice-write failure: 200 unlocked, a warn with its errorId and root cause, the outcome line, and a bump', async (label, rootCode, failure) => {
      const store = createStore();
      const purchase = purchaseServiceOver(store, sessionFor('content'));
      purchase.completePurchase.mockImplementationOnce(
        async (paymentIntentId, metadata) => {
          await store.complete(paymentIntentId, metadata);
          throw failure();
        }
      );
      const { app, obs } = buildApp(purchase);

      const res = await complete(app);

      expect(res.status).toBe(200);
      expect(await stateOf(res)).toBe('unlocked');
      expect(obs.warn).toHaveBeenCalledWith(
        FINISHED_BY[label],
        expect.objectContaining({
          sessionId: 'cs_landing_1',
          purchaseId: 'purchase_landing_1',
          errorId: expect.any(String),
          transient: label === 'temporary',
          cause: expect.objectContaining({ code: rootCode }),
        })
      );
      expect(obs.info).toHaveBeenCalledWith(
        'Checkout completed from the success page',
        expect.objectContaining({
          outcome: 'recorded',
          purchaseId: 'purchase_landing_1',
        })
      );
      // The throw came before the receipt; the webhook's replay sends it.
      expect(sendEmailToWorker).not.toHaveBeenCalled();
      expect(bumpsByPath()).toEqual({ page: 1, webhook: 0 });
    });
  });
});

describe('The webhook and the success page complete one session at once', () => {
  it.each([
    'content',
    'course',
  ] as const)('a %s checkout: one purchase, one receipt sent, and the library bumped by at most one per path', async (kind) => {
    // Neither caller commits until both are inside completion.
    const store = createStore(2);
    const session = sessionFor(kind);
    const fromWebhook = purchaseServiceOver(store, session);
    const fromPage = purchaseServiceOver(store, session);
    webhookUses(fromWebhook);
    const { app } = buildApp(fromPage);

    const [, res] = await Promise.all([deliverWebhook(session), complete(app)]);

    // Both completed it; one row was written, and both end on it.
    expect(fromWebhook.completePurchase).toHaveBeenCalledOnce();
    expect(fromPage.completePurchase).toHaveBeenCalledOnce();
    expect(store.inserts).toBe(1);
    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe('unlocked');

    // Both asked for the receipt; one claim won, and one email went out.
    expect(
      fromWebhook.claimReceipt.mock.calls.length +
        fromPage.claimReceipt.mock.calls.length
    ).toBe(2);
    expect(store.receipts).toEqual(new Set(['purchase_landing_1']));
    expect(sendEmailToWorker).toHaveBeenCalledOnce();

    // The buyer's library is bumped: at least once, at most once per path.
    const bumps = bumpsByPath();
    expect(bumps.page + bumps.webhook).toBeGreaterThanOrEqual(1);
    expect(bumps.page).toBeLessThanOrEqual(1);
    expect(bumps.webhook).toBeLessThanOrEqual(1);
    for (const [args] of vi.mocked(invalidateUserLibrary).mock.calls) {
      expect(args.userId).toBe(BUYER);
    }
  });

  it.each([
    'content',
    'course',
  ] as const)('a %s checkout the page records while the webhook never arrives: the library is still bumped', async (kind) => {
    const store = createStore();
    const fromPage = purchaseServiceOver(store, sessionFor(kind));
    const { app } = buildApp(fromPage);

    const res = await complete(app);

    expect(res.status).toBe(200);
    expect(await stateOf(res)).toBe('unlocked');
    expect(store.inserts).toBe(1);
    // No webhook: the page's own bump is the only one, so the buyer's other
    // tabs and devices see the purchase now, not when Stripe's retry lands.
    expect(createWebhookServices).not.toHaveBeenCalled();
    expect(bumpsByPath()).toEqual({ page: 1, webhook: 0 });
    expect(invalidateUserLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: BUYER })
    );
  });
});
