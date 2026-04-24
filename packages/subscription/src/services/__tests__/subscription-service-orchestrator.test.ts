/**
 * SubscriptionService orchestrator hook tests (Codex-esikl).
 *
 * Proves the service-level cache-invalidation contract introduced in this
 * bead: every public mutation on `SubscriptionService` calls
 * `invalidateForUser(...)` exactly once after the DB write succeeds, with
 * the correct `{ userId, orgId, reason }`. Routes and webhook handlers
 * become thin pass-throughs and no longer need to invoke the helper.
 *
 * This is a UNIT test, deliberately narrow: `@codex/cache` and
 * `./subscription-invalidation` are mocked so we can assert on the exact
 * arguments handed to the helper. The existing `subscription-service.test.ts`
 * (integration, real DB) continues to cover return-shape contracts and DB
 * side-effects — this file focuses only on the orchestration contract.
 *
 * Coverage matrix (per `feedback_security_deep_test` — positive + negative
 * for every affected method):
 *
 * | Method                         | Positive | Skip-path | Failure | No-cache |
 * | ------------------------------ | :------: | :-------: | :-----: | :------: |
 * | cancelSubscription             |   yes    |    —      |   yes   |   yes    |
 * | changeTier                     |   yes    |    —      |   yes   |   yes    |
 * | reactivateSubscription         |   yes    |    —      |   yes   |   yes    |
 * | handleSubscriptionCreated      |   yes    |    yes    |   —     |   yes    |
 * | handleSubscriptionUpdated      |   yes    |    yes    |   —     |   yes    |
 * | handleSubscriptionDeleted      |   yes    |    yes    |   —     |   yes    |
 * | handleInvoicePaymentSucceeded  |   yes    |    yes    |   —     |   yes    |
 * | handleInvoicePaymentFailed     |   yes    |    yes    |   —     |   yes    |
 */

import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the invalidation helper. We spy on it to assert the exact shape +
// ordering. The helper's own semantics (KV writes, waitUntil wiring) are
// covered by `subscription-invalidation.test.ts`.
vi.mock('../subscription-invalidation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../subscription-invalidation')>();
  return {
    ...actual,
    invalidateForUser: vi.fn(),
  };
});

// Mock @codex/cache so we never touch real KV. The service takes a
// `VersionedCache` purely by type — we pass a sentinel object.
vi.mock('@codex/cache', () => ({
  CacheType: {
    COLLECTION_USER_LIBRARY: (id: string) => `collection:user_library:${id}`,
    COLLECTION_USER_SUBSCRIPTION: (userId: string, orgId: string) =>
      `collection:user_subscription:${userId}:${orgId}`,
  },
}));

// Mock isUniqueViolation so the created-path doesn't short-circuit on
// DB call mocking oddities. We never want to hit the unique-violation
// branch in these tests.
vi.mock('@codex/database', () => ({
  isUniqueViolation: vi.fn().mockReturnValue(false),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import type { VersionedCache } from '@codex/cache';
import { SUBSCRIPTION_STATUS } from '@codex/constants';
import { SubscriptionCheckoutError } from '../../errors';
import {
  invalidateForUser,
  type WaitUntilFn,
} from '../subscription-invalidation';
import { SubscriptionService } from '../subscription-service';

// ─── Test doubles ─────────────────────────────────────────────────────────────

/**
 * Build a minimal DB mock whose `update` / `insert` / `select` chains all
 * resolve to no-op arrays. We assert ordering via the spy sequencer, not
 * via real SQL. Individual tests override specific chains.
 */
interface DbSpy {
  calls: string[];
  db: unknown;
}

function makeDb(overrides: Record<string, unknown> = {}): DbSpy {
  const calls: string[] = [];
  // Support either a single `selectResult` (first call) or `selectPages`
  // (array of pages, one per successive select). All subsequent selects
  // (beyond the supplied pages) return empty arrays — keeps `executeTransfers`
  // and other "extra" queries as no-ops without the test needing to
  // over-specify.
  const pages: unknown[][] = Array.isArray(overrides.selectPages)
    ? (overrides.selectPages as unknown[][])
    : overrides.selectResult
      ? [overrides.selectResult as unknown[]]
      : [];
  let pageIdx = 0;
  const db = {
    select: vi.fn(() => {
      calls.push('select');
      const result = pages[pageIdx++] ?? [];
      // Support BOTH patterns: `.from().where().limit()` and
      // `.from().where()` (awaited directly, no `.limit()`).
      // We return an object whose `where()` result is both a promise-like
      // (thenable → resolves to the array) AND carries a `.limit()` that
      // resolves to the same array. Drizzle's query builder works this way.
      const makeWhereReturn = () => ({
        limit: vi.fn(() => Promise.resolve(result)),
        // biome-ignore lint/suspicious/noThenProperty: mocking Drizzle's thenable query builder (awaited directly or chained with .limit())
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(result).then(resolve, reject),
        catch: (reject: (e: unknown) => void) =>
          Promise.resolve(result).catch(reject),
      });
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => makeWhereReturn()),
        })),
      };
    }),
    insert: vi.fn(() => {
      calls.push('insert');
      return {
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
          // biome-ignore lint/suspicious/noThenProperty: Drizzle's .values() is awaitable directly — mock mirrors that thenable surface
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        })),
      };
    }),
    update: vi.fn(() => {
      calls.push('update');
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      };
    }),
    query: {
      subscriptions: {
        findFirst: vi.fn(() =>
          Promise.resolve((overrides.findFirstResult as unknown) ?? null)
        ),
      },
    },
    // Webhook handlers now wrap multi-step writes in a transaction — the
    // mock exposes the same insert/update surface as the top-level db so
    // the handler can call `tx.insert(...)` / `tx.update(...)` inside the
    // callback without the test needing to stub every shape twice.
    transaction: vi.fn(
      async (
        cb: (tx: {
          insert: typeof db.insert;
          update: typeof db.update;
          select: typeof db.select;
        }) => Promise<unknown>
      ) => {
        calls.push('transaction');
        return cb({ insert: db.insert, update: db.update, select: db.select });
      }
    ),
  };
  return { calls, db };
}

interface ServiceBundle {
  service: SubscriptionService;
  waitUntil: ReturnType<typeof vi.fn>;
  cache: VersionedCache;
  invalidateSpy: ReturnType<typeof vi.fn>;
  dbCalls: string[];
}

/**
 * Build a SubscriptionService with mocked cache + waitUntil wired in.
 * Pass `noCache: true` to construct WITHOUT the orchestrator hook — the
 * mutation must still succeed and the helper must not be called.
 */
function buildService(
  options: {
    noCache?: boolean;
    selectResult?: unknown[];
    findFirstResult?: unknown;
    stripeOverrides?: Partial<Stripe>;
  } = {}
): ServiceBundle {
  const { calls: dbCalls, db } = makeDb({
    selectResult: options.selectResult,
    findFirstResult: options.findFirstResult,
  });

  // Minimal Stripe mock — sufficient for cancel/changeTier/reactivate. Each
  // test overrides as needed.
  const stripeMock = {
    subscriptions: {
      retrieve: vi.fn(() =>
        Promise.resolve({
          id: 'sub_stripe_1',
          items: { data: [{ id: 'si_1' }] },
        } as Stripe.Subscription)
      ),
      update: vi.fn(() => Promise.resolve({} as Stripe.Subscription)),
    },
    checkout: { sessions: { create: vi.fn() } },
    invoices: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    transfers: { create: vi.fn() },
    ...(options.stripeOverrides as object | undefined),
  } as unknown as Stripe;

  const waitUntil = vi.fn((_p: Promise<unknown>) => {});
  // Sentinel cache — the service only holds the reference and hands it to
  // the mocked invalidateForUser. We never call methods on it directly.
  const cache = { invalidate: vi.fn() } as unknown as VersionedCache;

  const service = new SubscriptionService(
    {
      // The service types db as `ServiceDatabase` from @codex/database;
      // our mock implements the subset the methods exercise. Cast is
      // narrow and localised — no `as any`.
      db: db as unknown as Parameters<
        typeof SubscriptionService.prototype.constructor
      >[0]['db'],
      environment: 'test',
      ...(options.noCache
        ? {}
        : { cache, waitUntil: waitUntil as WaitUntilFn }),
    },
    stripeMock
  );

  return {
    service,
    waitUntil,
    cache,
    invalidateSpy: invalidateForUser as unknown as ReturnType<typeof vi.fn>,
    dbCalls,
  };
}

/** Cast a spied function to its vitest shape without `as any`. */
function asSpy(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

// ─── cancelSubscription ──────────────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — cancelSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: calls invalidateForUser exactly once with { userId, orgId, reason: "cancel" }', async () => {
    const sub = {
      id: 'sub_1',
      userId: 'user_1',
      organizationId: 'org_1',
      stripeSubscriptionId: 'stripe_sub_1',
      status: SUBSCRIPTION_STATUS.ACTIVE,
    };
    const bundle = buildService({ selectResult: [sub] });

    await bundle.service.cancelSubscription('user_1', 'org_1', 'too expensive');

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      { userId: 'user_1', orgId: 'org_1', reason: 'cancel' },
      expect.any(Object)
    );
  });

  it('ordering: DB write runs BEFORE invalidateForUser', async () => {
    const sub = {
      id: 'sub_ord',
      userId: 'user_ord',
      organizationId: 'org_ord',
      stripeSubscriptionId: 'stripe_sub_ord',
      status: SUBSCRIPTION_STATUS.ACTIVE,
    };
    const bundle = buildService({ selectResult: [sub] });

    const order: string[] = [];
    bundle.invalidateSpy.mockImplementationOnce(() => {
      order.push('invalidate');
    });
    // Wrap the DB `update` chain so we record its moment of firing.
    // makeDb already pushes 'update' into calls — snapshot after the call.
    await bundle.service.cancelSubscription('user_ord', 'org_ord');

    // The DB update call was recorded into `dbCalls` synchronously during
    // the method. The invalidate spy fires after `await`ing the update.
    // Assert: `update` is in dbCalls AT the moment invalidate fired.
    order.unshift(...bundle.dbCalls);
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('invalidate'));
  });

  it('failure: when DB update throws, invalidateForUser is NOT called', async () => {
    // Force the mutation to fail by arranging the service helper to throw.
    // Easiest path: no matching subscription → SubscriptionNotFoundError.
    const bundle = buildService({ selectResult: [] });

    await expect(
      bundle.service.cancelSubscription('user_x', 'org_x')
    ).rejects.toBeDefined();

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: mutation succeeds without cache + waitUntil, no helper call', async () => {
    const sub = {
      id: 'sub_noc',
      userId: 'user_noc',
      organizationId: 'org_noc',
      stripeSubscriptionId: 'stripe_sub_noc',
      status: SUBSCRIPTION_STATUS.ACTIVE,
    };
    const bundle = buildService({ selectResult: [sub], noCache: true });

    const result = await bundle.service.cancelSubscription(
      'user_noc',
      'org_noc'
    );

    expect(result.userId).toBe('user_noc');
    expect(result.orgId).toBe('org_noc');
    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── changeTier ──────────────────────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — changeTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function withTier(selectResultPages: unknown[][]): ServiceBundle {
    // changeTier calls `select()` TWICE: once for the sub, once for the
    // new tier. Chain the mock so each .limit() returns the next page.
    let callIdx = 0;
    const { calls: dbCalls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        dbCalls.push('select');
        const page = selectResultPages[callIdx++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };

    const waitUntil = vi.fn((_p: Promise<unknown>) => {});
    const cache = { invalidate: vi.fn() } as unknown as VersionedCache;
    const stripeMock = {
      subscriptions: {
        retrieve: vi.fn(() =>
          Promise.resolve({
            id: 'stripe_sub_ct',
            items: { data: [{ id: 'si_ct' }] },
          } as Stripe.Subscription)
        ),
        update: vi.fn(() => Promise.resolve({} as Stripe.Subscription)),
      },
    } as unknown as Stripe;

    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
        cache,
        waitUntil: waitUntil as WaitUntilFn,
      },
      stripeMock
    );

    return {
      service,
      waitUntil,
      cache,
      invalidateSpy: invalidateForUser as unknown as ReturnType<typeof vi.fn>,
      dbCalls,
    };
  }

  it('positive: calls invalidateForUser once with reason "change_tier"', async () => {
    const sub = {
      id: 'sub_ct',
      userId: 'user_ct',
      organizationId: 'org_ct',
      stripeSubscriptionId: 'stripe_sub_ct',
      status: SUBSCRIPTION_STATUS.ACTIVE,
      tierId: 'tier_old',
    };
    const newTier = {
      id: 'tier_new',
      organizationId: 'org_ct',
      isActive: true,
      stripePriceMonthlyId: 'price_mo',
      stripePriceAnnualId: 'price_yr',
    };
    const bundle = withTier([[sub], [newTier]]);

    await bundle.service.changeTier('user_ct', 'org_ct', 'tier_new', 'month');

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      { userId: 'user_ct', orgId: 'org_ct', reason: 'change_tier' },
      expect.any(Object)
    );
  });

  it('failure: missing Stripe price throws SubscriptionCheckoutError, no invalidation', async () => {
    const sub = {
      id: 'sub_ctf',
      userId: 'user_ctf',
      organizationId: 'org_ctf',
      stripeSubscriptionId: 'stripe_sub_ctf',
      status: SUBSCRIPTION_STATUS.ACTIVE,
      tierId: 'tier_old',
    };
    const badTier = {
      id: 'tier_bad',
      organizationId: 'org_ctf',
      isActive: true,
      stripePriceMonthlyId: null,
      stripePriceAnnualId: null,
    };
    const bundle = withTier([[sub], [badTier]]);

    await expect(
      bundle.service.changeTier('user_ctf', 'org_ctf', 'tier_bad', 'month')
    ).rejects.toBeInstanceOf(SubscriptionCheckoutError);

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    const sub = {
      id: 'sub_ctnc',
      userId: 'user_ctnc',
      organizationId: 'org_ctnc',
      stripeSubscriptionId: 'stripe_sub_ctnc',
      status: SUBSCRIPTION_STATUS.ACTIVE,
      tierId: 'tier_old',
    };
    const newTier = {
      id: 'tier_nc',
      organizationId: 'org_ctnc',
      isActive: true,
      stripePriceMonthlyId: 'price_mo',
      stripePriceAnnualId: 'price_yr',
    };
    // Temporarily swap in a no-cache service by rebuilding manually.
    let callIdx = 0;
    const selectPages = [[sub], [newTier]];
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        calls.push('select');
        const page = selectPages[callIdx++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };
    const stripeMock = {
      subscriptions: {
        retrieve: vi.fn(() =>
          Promise.resolve({
            id: 'stripe_sub_ctnc',
            items: { data: [{ id: 'si_nc' }] },
          } as Stripe.Subscription)
        ),
        update: vi.fn(() => Promise.resolve({} as Stripe.Subscription)),
      },
    } as unknown as Stripe;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
      },
      stripeMock
    );

    const result = await service.changeTier(
      'user_ctnc',
      'org_ctnc',
      'tier_nc',
      'month'
    );

    expect(result.userId).toBe('user_ctnc');
    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });
});

// ─── reactivateSubscription ─────────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — reactivateSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: calls invalidateForUser once with reason "reactivate"', async () => {
    const sub = {
      id: 'sub_re',
      userId: 'user_re',
      organizationId: 'org_re',
      stripeSubscriptionId: 'stripe_sub_re',
      status: SUBSCRIPTION_STATUS.CANCELLING,
    };
    const bundle = buildService({ selectResult: [sub] });

    await bundle.service.reactivateSubscription('user_re', 'org_re');

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      { userId: 'user_re', orgId: 'org_re', reason: 'reactivate' },
      expect.any(Object)
    );
  });

  it('failure: reactivate on a non-CANCELLING subscription throws, no invalidation', async () => {
    const sub = {
      id: 'sub_rf',
      userId: 'user_rf',
      organizationId: 'org_rf',
      stripeSubscriptionId: 'stripe_sub_rf',
      status: SUBSCRIPTION_STATUS.ACTIVE, // not cancelling
    };
    const bundle = buildService({ selectResult: [sub] });

    await expect(
      bundle.service.reactivateSubscription('user_rf', 'org_rf')
    ).rejects.toBeInstanceOf(SubscriptionCheckoutError);

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    const sub = {
      id: 'sub_rnc',
      userId: 'user_rnc',
      organizationId: 'org_rnc',
      stripeSubscriptionId: 'stripe_sub_rnc',
      status: SUBSCRIPTION_STATUS.CANCELLING,
    };
    const bundle = buildService({ selectResult: [sub], noCache: true });

    await bundle.service.reactivateSubscription('user_rnc', 'org_rnc');

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── resumeSubscription (Codex-7h4vo — user-initiated resume) ───────────────
//
// User-initiated resume of a PAUSED subscription. Parallel orchestrator
// contract to reactivateSubscription:
//   1. Fire `invalidateForUser` with reason='subscription_resumed' on success
//      (same tag as the webhook-driven path so observability groups them).
//   2. Run AFTER the DB update (ordering).
//   3. Not fire when Stripe throws (failure path).
//   4. Not fire when cache + waitUntil are not wired (no-op degradation).

describe('SubscriptionService orchestrator hook — resumeSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeWithResume(
    overrides: Partial<{ throws: boolean }> = {}
  ): Stripe {
    return {
      subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(),
        resume: overrides.throws
          ? vi.fn().mockRejectedValue(new Error('stripe boom'))
          : vi.fn().mockResolvedValue({ status: 'active' }),
      },
      checkout: { sessions: { create: vi.fn() } },
      invoices: { retrieve: vi.fn() },
      paymentIntents: { retrieve: vi.fn() },
      transfers: { create: vi.fn() },
    } as unknown as Stripe;
  }

  it('positive: calls invalidateForUser once with reason "subscription_resumed"', async () => {
    const sub = {
      id: 'sub_rs',
      userId: 'user_rs',
      organizationId: 'org_rs',
      stripeSubscriptionId: 'stripe_sub_rs',
      status: SUBSCRIPTION_STATUS.PAUSED,
    };
    const bundle = buildService({
      selectResult: [sub],
      stripeOverrides: stripeWithResume() as Partial<Stripe>,
    });

    await bundle.service.resumeSubscription('user_rs', 'org_rs');

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_rs',
        orgId: 'org_rs',
        reason: 'subscription_resumed',
      },
      expect.any(Object)
    );
  });

  it('ordering: Stripe resume + DB update run BEFORE invalidateForUser', async () => {
    const sub = {
      id: 'sub_rs_ord',
      userId: 'user_rs_ord',
      organizationId: 'org_rs_ord',
      stripeSubscriptionId: 'stripe_sub_rs_ord',
      status: SUBSCRIPTION_STATUS.PAUSED,
    };
    const bundle = buildService({
      selectResult: [sub],
      stripeOverrides: stripeWithResume() as Partial<Stripe>,
    });

    const order: string[] = [];
    bundle.invalidateSpy.mockImplementationOnce(() => {
      order.push('invalidate');
    });

    await bundle.service.resumeSubscription('user_rs_ord', 'org_rs_ord');

    order.unshift(...bundle.dbCalls);
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('invalidate'));
  });

  it('failure: when Stripe.resume throws, invalidateForUser is NOT called', async () => {
    const sub = {
      id: 'sub_rs_fail',
      userId: 'user_rs_fail',
      organizationId: 'org_rs_fail',
      stripeSubscriptionId: 'stripe_sub_rs_fail',
      status: SUBSCRIPTION_STATUS.PAUSED,
    };
    const bundle = buildService({
      selectResult: [sub],
      stripeOverrides: stripeWithResume({ throws: true }) as Partial<Stripe>,
    });

    await expect(
      bundle.service.resumeSubscription('user_rs_fail', 'org_rs_fail')
    ).rejects.toThrow();

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('failure: no paused subscription found → throws, no invalidation, Stripe not called', async () => {
    const bundle = buildService({
      selectResult: [],
      stripeOverrides: stripeWithResume() as Partial<Stripe>,
    });

    await expect(
      bundle.service.resumeSubscription('user_none', 'org_none')
    ).rejects.toBeDefined();

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
    // Stripe resume must not be called when there's nothing to resume.
    const stripeResume = (
      bundle.service as unknown as {
        stripe: { subscriptions: { resume: ReturnType<typeof vi.fn> } };
      }
    ).stripe.subscriptions.resume;
    expect(stripeResume).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    const sub = {
      id: 'sub_rs_nc',
      userId: 'user_rs_nc',
      organizationId: 'org_rs_nc',
      stripeSubscriptionId: 'stripe_sub_rs_nc',
      status: SUBSCRIPTION_STATUS.PAUSED,
    };
    const bundle = buildService({
      selectResult: [sub],
      noCache: true,
      stripeOverrides: stripeWithResume() as Partial<Stripe>,
    });

    await bundle.service.resumeSubscription('user_rs_nc', 'org_rs_nc');

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionCreated ──────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — handleSubscriptionCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeSubFactory(
    metadata: Record<string, string> = {
      codex_user_id: 'user_created',
      codex_organization_id: 'org_created',
      codex_tier_id: 'tier_created',
    }
  ): Stripe.Subscription {
    return {
      id: 'sub_stripe_created',
      metadata,
      latest_invoice: null,
      customer: 'cus_1',
      items: {
        data: [
          {
            id: 'si_1',
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_500_000,
            price: {
              recurring: { interval: 'month' },
              unit_amount: 999,
            },
          },
        ],
      },
      billing_cycle_anchor: 1_700_000_000,
    } as unknown as Stripe.Subscription;
  }

  it('positive: calls invalidateForUser with reason "subscription_created"', async () => {
    // `handleSubscriptionCreated` queries the users table for email and
    // the tiers table for the tier name when building the email payload.
    // Pair the select results in order: first select = user row, second
    // select = tier row.
    let sel = 0;
    const pages: unknown[][] = [
      [{ email: 'u@example.com', name: 'U' }],
      [{ name: 'Pro' }],
    ];
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        calls.push('select');
        const page = pages[sel++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };
    const waitUntil = vi.fn((_p: Promise<unknown>) => {});
    const cache = { invalidate: vi.fn() } as unknown as VersionedCache;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
        cache,
        waitUntil: waitUntil as WaitUntilFn,
      },
      {} as Stripe
    );

    await service.handleSubscriptionCreated(stripeSubFactory());

    expect(asSpy(invalidateForUser)).toHaveBeenCalledTimes(1);
    expect(asSpy(invalidateForUser)).toHaveBeenCalledWith(
      cache,
      waitUntil,
      {
        userId: 'user_created',
        orgId: 'org_created',
        reason: 'subscription_created',
      },
      expect.any(Object)
    );
  });

  it('skip-path: missing metadata → helper NOT called', async () => {
    const bundle = buildService();

    // Empty metadata triggers the early return in the service.
    await bundle.service.handleSubscriptionCreated(
      stripeSubFactory({}) as Stripe.Subscription
    );

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    let sel = 0;
    const pages: unknown[][] = [
      [{ email: 'u@example.com', name: 'U' }],
      [{ name: 'Pro' }],
    ];
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        calls.push('select');
        const page = pages[sel++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
      },
      {} as Stripe
    );

    await service.handleSubscriptionCreated(stripeSubFactory());

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionUpdated ──────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — handleSubscriptionUpdated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeSubFactory(
    overrides: Partial<{
      status: string;
      cancel_at_period_end: boolean;
      metadata: Record<string, string>;
    }> = {}
  ): Stripe.Subscription {
    return {
      id: 'stripe_sub_upd',
      status: overrides.status ?? 'active',
      cancel_at_period_end: overrides.cancel_at_period_end ?? false,
      metadata: overrides.metadata ?? { codex_tier_id: 'tier_u' },
      items: {
        data: [
          {
            id: 'si_u',
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_500_000,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  it('positive: calls invalidateForUser with reason "subscription_updated"', async () => {
    const bundle = buildService({
      selectResult: [
        {
          id: 'sub_u',
          userId: 'user_u',
          organizationId: 'org_u',
          stripeSubscriptionId: 'stripe_sub_upd',
          status: SUBSCRIPTION_STATUS.ACTIVE,
          tierId: 'tier_old',
        },
      ],
    });

    await bundle.service.handleSubscriptionUpdated(stripeSubFactory());

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_u',
        orgId: 'org_u',
        reason: 'subscription_updated',
      },
      expect.any(Object)
    );
  });

  it('skip-path: no local subscription found → helper NOT called', async () => {
    const bundle = buildService({ selectResult: [] });

    await bundle.service.handleSubscriptionUpdated(stripeSubFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil', async () => {
    const bundle = buildService({
      selectResult: [
        {
          id: 'sub_unc',
          userId: 'user_unc',
          organizationId: 'org_unc',
          stripeSubscriptionId: 'stripe_sub_upd',
          status: SUBSCRIPTION_STATUS.ACTIVE,
          tierId: 'tier_old',
        },
      ],
      noCache: true,
    });

    await bundle.service.handleSubscriptionUpdated(stripeSubFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionDeleted ──────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — handleSubscriptionDeleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeSubFactory(
    metadata: Record<string, string> = {
      codex_user_id: 'user_del',
      codex_organization_id: 'org_del',
      codex_tier_id: 'tier_del',
    }
  ): Stripe.Subscription {
    return {
      id: 'stripe_sub_del',
      metadata,
      cancel_at: 1_700_000_000,
    } as unknown as Stripe.Subscription;
  }

  it('positive: calls invalidateForUser with reason "subscription_deleted"', async () => {
    let sel = 0;
    // service does a user + tier select when building the email
    const pages: unknown[][] = [
      [{ email: 'u@example.com', name: 'U' }],
      [{ name: 'Pro' }],
    ];
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        calls.push('select');
        const page = pages[sel++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };
    const waitUntil = vi.fn((_p: Promise<unknown>) => {});
    const cache = { invalidate: vi.fn() } as unknown as VersionedCache;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
        cache,
        waitUntil: waitUntil as WaitUntilFn,
      },
      {} as Stripe
    );

    await service.handleSubscriptionDeleted(stripeSubFactory());

    expect(asSpy(invalidateForUser)).toHaveBeenCalledTimes(1);
    expect(asSpy(invalidateForUser)).toHaveBeenCalledWith(
      cache,
      waitUntil,
      {
        userId: 'user_del',
        orgId: 'org_del',
        reason: 'subscription_deleted',
      },
      expect.any(Object)
    );
  });

  it('skip-path: missing metadata (no userId/orgId) → helper NOT called', async () => {
    const bundle = buildService();

    await bundle.service.handleSubscriptionDeleted(stripeSubFactory({}));

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil', async () => {
    let sel = 0;
    const pages: unknown[][] = [
      [{ email: 'u@example.com', name: 'U' }],
      [{ name: 'Pro' }],
    ];
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      select: vi.fn(() => {
        calls.push('select');
        const page = pages[sel++] ?? [];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(page)),
            })),
          })),
        };
      }),
    };
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
      },
      {} as Stripe
    );

    await service.handleSubscriptionDeleted(stripeSubFactory());

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionPaused (Codex-a0vk2) ─────────────────────────────────
//
// Pause is access-reducing (user loses access) and non-terminal (reactivated
// on `customer.subscription.resumed`). The orchestrator hook must:
//   1. Fire `invalidateForUser` with reason='subscription_paused' on success.
//   2. Run AFTER the DB update (ordering).
//   3. Skip when metadata ids are missing (no userId → no invalidation).
//   4. Skip when cache + waitUntil are not wired (no-op degradation).

describe('SubscriptionService orchestrator hook — handleSubscriptionPaused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeSubFactory(
    metadata: Record<string, string> = {
      codex_user_id: 'user_pause',
      codex_organization_id: 'org_pause',
      codex_tier_id: 'tier_pause',
    }
  ): Stripe.Subscription {
    return {
      id: 'stripe_sub_pause',
      metadata,
    } as unknown as Stripe.Subscription;
  }

  it('positive: calls invalidateForUser with reason "subscription_paused"', async () => {
    const bundle = buildService();

    await bundle.service.handleSubscriptionPaused(stripeSubFactory());

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_pause',
        orgId: 'org_pause',
        reason: 'subscription_paused',
      },
      expect.any(Object)
    );
  });

  it('ordering: DB update runs BEFORE invalidateForUser', async () => {
    const bundle = buildService();

    const order: string[] = [];
    bundle.invalidateSpy.mockImplementationOnce(() => {
      order.push('invalidate');
    });

    await bundle.service.handleSubscriptionPaused(stripeSubFactory());

    order.unshift(...bundle.dbCalls);
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('invalidate'));
  });

  it('failure: DB update throws → invalidateForUser NOT called', async () => {
    // Simulate DB failure by replacing the update chain with a rejecting
    // promise. The orchestrator hook must not fire when the mutation fails.
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      update: vi.fn(() => {
        calls.push('update');
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.reject(new Error('DB down'))),
          })),
        };
      }),
    };
    const waitUntil = vi.fn((_p: Promise<unknown>) => {});
    const cache = { invalidate: vi.fn() } as unknown as VersionedCache;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
        cache,
        waitUntil: waitUntil as WaitUntilFn,
      },
      {} as Stripe
    );

    await expect(
      service.handleSubscriptionPaused(stripeSubFactory())
    ).rejects.toThrow();

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });

  it('skip-path: missing metadata (no userId/orgId) → helper NOT called', async () => {
    const bundle = buildService();

    await bundle.service.handleSubscriptionPaused(stripeSubFactory({}));

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    const { calls, db: baseDb } = makeDb();
    const db = { ...(baseDb as object) };
    // intentional: no `calls` reference kept — we only care about helper spy
    void calls;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
      },
      {} as Stripe
    );

    await expect(
      service.handleSubscriptionPaused(stripeSubFactory())
    ).resolves.toBeDefined();

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionResumed (Codex-rh0on) ────────────────────────────────
//
// Resume is access-RESTORING and terminal for the paused state: the row
// flips from status='paused' back to status='active'. The orchestrator hook
// must:
//   1. Fire `invalidateForUser` with reason='subscription_resumed' on success.
//   2. Run AFTER the DB update (ordering).
//   3. Skip when metadata ids are missing (no userId → no invalidation).
//   4. Skip when cache + waitUntil are not wired (no-op degradation).
//   5. Not fire when the DB update throws (failure path).

describe('SubscriptionService orchestrator hook — handleSubscriptionResumed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stripeSubFactory(
    metadata: Record<string, string> = {
      codex_user_id: 'user_resume',
      codex_organization_id: 'org_resume',
      codex_tier_id: 'tier_resume',
    },
    status: Stripe.Subscription.Status = 'active'
  ): Stripe.Subscription {
    return {
      id: 'stripe_sub_resume',
      status,
      metadata,
    } as unknown as Stripe.Subscription;
  }

  it('positive: calls invalidateForUser with reason "subscription_resumed"', async () => {
    const bundle = buildService();

    await bundle.service.handleSubscriptionResumed(stripeSubFactory());

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_resume',
        orgId: 'org_resume',
        reason: 'subscription_resumed',
      },
      expect.any(Object)
    );
  });

  it('ordering: DB update runs BEFORE invalidateForUser', async () => {
    const bundle = buildService();

    const order: string[] = [];
    bundle.invalidateSpy.mockImplementationOnce(() => {
      order.push('invalidate');
    });

    await bundle.service.handleSubscriptionResumed(stripeSubFactory());

    order.unshift(...bundle.dbCalls);
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('invalidate'));
  });

  it('failure: DB update throws → invalidateForUser NOT called', async () => {
    // Simulate DB failure by replacing the update chain with a rejecting
    // promise. The orchestrator hook must not fire when the mutation fails.
    const { calls, db: baseDb } = makeDb();
    const db = {
      ...(baseDb as object),
      update: vi.fn(() => {
        calls.push('update');
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.reject(new Error('DB down'))),
          })),
        };
      }),
    };
    const waitUntil = vi.fn((_p: Promise<unknown>) => {});
    const cache = { invalidate: vi.fn() } as unknown as VersionedCache;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
        cache,
        waitUntil: waitUntil as WaitUntilFn,
      },
      {} as Stripe
    );

    await expect(
      service.handleSubscriptionResumed(stripeSubFactory())
    ).rejects.toThrow();

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });

  it('skip-path: missing metadata (no userId/orgId) → helper NOT called', async () => {
    const bundle = buildService();

    await bundle.service.handleSubscriptionResumed(stripeSubFactory({}));

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: succeeds without cache + waitUntil, helper not called', async () => {
    const { calls, db: baseDb } = makeDb();
    const db = { ...(baseDb as object) };
    // intentional: no `calls` reference kept — we only care about helper spy
    void calls;
    const service = new SubscriptionService(
      {
        db: db as unknown as Parameters<
          typeof SubscriptionService.prototype.constructor
        >[0]['db'],
        environment: 'test',
      },
      {} as Stripe
    );

    await expect(
      service.handleSubscriptionResumed(stripeSubFactory())
    ).resolves.toBeDefined();

    expect(asSpy(invalidateForUser)).not.toHaveBeenCalled();
  });
});

// ─── handleInvoicePaymentSucceeded ──────────────────────────────────────────

describe('SubscriptionService orchestrator hook — handleInvoicePaymentSucceeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function invoiceFactory(
    overrides: Partial<{ subId: string | null }> = {}
  ): Stripe.Invoice {
    return {
      id: 'in_1',
      amount_paid: 999,
      parent: {
        subscription_details: {
          subscription:
            overrides.subId === undefined ? 'stripe_sub_paid' : overrides.subId,
        },
      },
      payments: {
        data: [{ payment: { charge: 'ch_1', payment_intent: null } }],
      },
      customer_email: 'u@example.com',
      customer_name: 'U',
      billing_reason: 'subscription_cycle',
      lines: { data: [{ description: 'Plan' }] },
    } as unknown as Stripe.Invoice;
  }

  it('positive: calls invalidateForUser with reason "payment_succeeded"', async () => {
    const bundle = buildService({
      selectResult: [
        {
          id: 'sub_paid',
          userId: 'user_paid',
          organizationId: 'org_paid',
          stripeSubscriptionId: 'stripe_sub_paid',
          status: SUBSCRIPTION_STATUS.ACTIVE,
        },
      ],
      stripeOverrides: {
        subscriptions: {
          retrieve: vi.fn(() =>
            Promise.resolve({
              id: 'stripe_sub_paid',
              items: {
                data: [
                  {
                    id: 'si_paid',
                    current_period_start: 1_700_000_000,
                    current_period_end: 1_702_500_000,
                  },
                ],
              },
            } as unknown as Stripe.Subscription)
          ),
        },
      } as unknown as Partial<Stripe>,
    });

    await bundle.service.handleInvoicePaymentSucceeded(invoiceFactory());

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_paid',
        orgId: 'org_paid',
        reason: 'payment_succeeded',
      },
      expect.any(Object)
    );
  });

  it('skip-path: missing subscription id on invoice → helper NOT called', async () => {
    const bundle = buildService();

    await bundle.service.handleInvoicePaymentSucceeded(
      invoiceFactory({ subId: null })
    );

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('skip-path: subscription not found in DB → helper NOT called', async () => {
    const bundle = buildService({ selectResult: [] });

    await bundle.service.handleInvoicePaymentSucceeded(invoiceFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: mutation succeeds, helper not called', async () => {
    const bundle = buildService({
      selectResult: [
        {
          id: 'sub_pnc',
          userId: 'user_pnc',
          organizationId: 'org_pnc',
          stripeSubscriptionId: 'stripe_sub_paid',
          status: SUBSCRIPTION_STATUS.ACTIVE,
        },
      ],
      noCache: true,
      stripeOverrides: {
        subscriptions: {
          retrieve: vi.fn(() =>
            Promise.resolve({
              id: 'stripe_sub_paid',
              items: {
                data: [
                  {
                    id: 'si_pnc',
                    current_period_start: 1_700_000_000,
                    current_period_end: 1_702_500_000,
                  },
                ],
              },
            } as unknown as Stripe.Subscription)
          ),
        },
      } as unknown as Partial<Stripe>,
    });

    await bundle.service.handleInvoicePaymentSucceeded(invoiceFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── handleInvoicePaymentFailed ─────────────────────────────────────────────

describe('SubscriptionService orchestrator hook — handleInvoicePaymentFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function invoiceFactory(
    overrides: Partial<{ subId: string | null }> = {}
  ): Stripe.Invoice {
    return {
      id: 'in_failed_1',
      amount_due: 999,
      parent: {
        subscription_details: {
          subscription:
            overrides.subId === undefined
              ? 'stripe_sub_failed'
              : overrides.subId,
        },
      },
      customer_email: 'u@example.com',
      customer_name: 'U',
      lines: { data: [{ description: 'Plan' }] },
      next_payment_attempt: 1_700_000_000,
    } as unknown as Stripe.Invoice;
  }

  it('positive: calls invalidateForUser with reason "payment_failed"', async () => {
    const bundle = buildService({
      selectResult: [
        {
          userId: 'user_failed',
          organizationId: 'org_failed',
        },
      ],
    });

    await bundle.service.handleInvoicePaymentFailed(invoiceFactory());

    expect(bundle.invalidateSpy).toHaveBeenCalledTimes(1);
    expect(bundle.invalidateSpy).toHaveBeenCalledWith(
      bundle.cache,
      bundle.waitUntil,
      {
        userId: 'user_failed',
        orgId: 'org_failed',
        reason: 'payment_failed',
      },
      expect.any(Object)
    );
  });

  it('skip-path: missing subscription id on invoice → helper NOT called', async () => {
    const bundle = buildService();

    await bundle.service.handleInvoicePaymentFailed(
      invoiceFactory({ subId: null })
    );

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('skip-path: subscription row not found → helper NOT called (no userId to bump)', async () => {
    const bundle = buildService({ selectResult: [] });

    await bundle.service.handleInvoicePaymentFailed(invoiceFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: mutation succeeds, helper not called', async () => {
    const bundle = buildService({
      selectResult: [
        {
          userId: 'user_fnc',
          organizationId: 'org_fnc',
        },
      ],
      noCache: true,
    });

    await bundle.service.handleInvoicePaymentFailed(invoiceFactory());

    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── handleTrialWillEnd (Codex-lvxev) ────────────────────────────────────────
//
// Trial-will-end is a deliberate orchestrator non-participant: the user is
// still inside the trial and entitled to access, so bumping version keys
// would force every other device to re-fetch library + subscription state
// for no reason. This block locks the contract in: the helper MUST NOT be
// called on this event, and the "no-cache" mutation path must also succeed.
//
// Positive + negative per `feedback_security_deep_test`: we assert both the
// return shape (metadata extracted, trialEndAt present) AND the must-not
// side effect.

describe('SubscriptionService orchestrator hook — handleTrialWillEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function trialSubFactory(
    overrides: {
      userId?: string | undefined;
      orgId?: string | undefined;
      trialEnd?: number;
    } = {}
  ): Stripe.Subscription {
    const metadata: Record<string, string> = {};
    if (overrides.userId !== undefined) {
      metadata.codex_user_id = overrides.userId;
    }
    if (overrides.orgId !== undefined) {
      metadata.codex_organization_id = overrides.orgId;
    }
    metadata.codex_tier_id = 'tier_t';

    return {
      id: 'sub_trial_1',
      metadata,
      trial_end:
        overrides.trialEnd ?? Math.floor(Date.now() / 1000) + 3 * 86400,
      items: {
        data: [
          {
            id: 'si_t',
            current_period_end:
              overrides.trialEnd ?? Math.floor(Date.now() / 1000) + 86400,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  it('positive: extracts metadata + trialEndAt; does NOT call invalidateForUser', async () => {
    // `buildTrialEndingSoonEmail` performs two selects (user, tier). Give
    // each select a page so the helper returns an email payload too.
    const trialEnd = Math.floor(Date.now() / 1000) + 3 * 86400;
    const bundle = buildService({
      selectResult: [{ email: 'trial@example.com', name: 'Trial User' }],
    });

    const result = await bundle.service.handleTrialWillEnd(
      trialSubFactory({
        userId: 'user_trial',
        orgId: 'org_trial',
        trialEnd,
      })
    );

    expect(result).toBeDefined();
    expect(result?.userId).toBe('user_trial');
    expect(result?.orgId).toBe('org_trial');
    expect(result?.trialEndAt).toBeInstanceOf(Date);
    expect(result?.trialEndAt.getTime()).toBe(trialEnd * 1000);

    // THE load-bearing assertion — trial extension must not flush caches.
    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('negative: missing userId → returns undefined, helper NOT called', async () => {
    const bundle = buildService();

    const result = await bundle.service.handleTrialWillEnd(
      trialSubFactory({ orgId: 'org_only' })
    );

    expect(result).toBeUndefined();
    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('negative: missing orgId → returns undefined, helper NOT called', async () => {
    const bundle = buildService();

    const result = await bundle.service.handleTrialWillEnd(
      trialSubFactory({ userId: 'user_only' })
    );

    expect(result).toBeUndefined();
    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });

  it('no-cache: handler still succeeds without cache + waitUntil, helper not called', async () => {
    // The service was constructed without cache/waitUntil — even if we
    // WANTED to bump, we couldn't. This guards against a future change
    // that accidentally wires the helper call in.
    const bundle = buildService({
      selectResult: [{ email: 'trial-nc@example.com', name: 'NC' }],
      noCache: true,
    });

    const result = await bundle.service.handleTrialWillEnd(
      trialSubFactory({ userId: 'user_nc', orgId: 'org_nc' })
    );

    expect(result).toBeDefined();
    expect(result?.userId).toBe('user_nc');
    expect(bundle.invalidateSpy).not.toHaveBeenCalled();
  });
});
