/**
 * Direct subscription mutation route tests (Codex-vblci, migrated Codex-esikl).
 *
 * Originally asserted that each of the three authenticated mutation routes
 * on `/subscriptions` calls `invalidateForUser` directly. That contract
 * moved into `SubscriptionService` itself in Codex-esikl — every public
 * mutation ends with an internal `invalidateIfConfigured(...)` call. Routes
 * are now thin pass-throughs and must NOT call `invalidateForUser` on
 * their own (doing so would double-bump the version keys).
 *
 * Assertions in this file migrated:
 *   - Positive: assert the SERVICE method is called with the correct args
 *     (the service owns cache bumping — see
 *     `packages/subscription/src/services/__tests__/subscription-service-orchestrator.test.ts`
 *     for the service-level contract).
 *   - Positive (negative of previous): assert `invalidateForUser` is NOT
 *     called at the ROUTE layer — regression guard against reintroducing
 *     the duplicated call.
 *   - Negative auth / body / service-throws: unchanged — those still apply.
 *
 * Revocation-clear (reactivate only) is a separate concern owned by the
 * route layer and its assertions are unchanged.
 *
 * Coverage matrix:
 *
 * | Endpoint                          | Service called | Helper NOT called | No session | Missing org | Service throws |
 * | --------------------------------- | :------------: | :---------------: | :--------: | :---------: | :------------: |
 * | POST /subscriptions/cancel        |      yes       |       yes         |    yes     |     yes     |      yes       |
 * | POST /subscriptions/change-tier   |      yes       |       yes         |    yes     |     yes     |      yes       |
 * | POST /subscriptions/reactivate    |      yes       |       yes         |    yes     |     yes     |      yes       |
 * | POST /subscriptions/resume        |      yes       |       yes         |    yes     |     yes     |      yes       |
 *
 * Per `feedback_security_deep_test`: positive + negative paths mandatory.
 *
 * Strategy: mock `@codex/subscription` (so we can spy on `invalidateForUser`
 * AND on SubscriptionService method calls) and mock `@codex/worker-utils`
 * `procedure` to a passthrough so we can drive the real route handler
 * functions from this test with synthesized contexts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// These mocks must be declared before the route module is imported. `vi.mock`
// is hoisted so the order inside this file is cosmetic, but keeping them
// grouped at the top makes the contract obvious.

vi.mock('@codex/subscription', async () => {
  // Keep the shape of `InvalidationReason` as a literal union; the mock only
  // needs the runtime members the route actually touches.
  return {
    invalidateForUser: vi.fn(),
    // SubscriptionService is constructed by the service registry. Since we
    // short-circuit procedure below and pass a hand-built services object,
    // we never actually instantiate this — but `import` resolution still
    // needs the symbol.
    SubscriptionService: vi.fn(),
  };
});

// Spy on AccessRevocation.clear — the reactivate route instantiates the
// class inline and calls `.clear(userId, organizationId)` fire-and-forget.
// Codex-13ml3 contract: alongside `invalidateForUser`, the reactivate
// endpoint MUST also clear the revocation key so `getStreamingUrl()`
// stops rejecting within the KV TTL window.
const mockClear = vi.fn().mockResolvedValue(undefined);
vi.mock('@codex/access', () => ({
  AccessRevocation: vi.fn().mockImplementation(() => ({
    revoke: vi.fn(),
    isRevoked: vi.fn(),
    clear: mockClear,
  })),
}));

/**
 * We mock `procedure` to a passthrough that merely records the config and
 * returns a Hono-compatible handler which invokes the real handler with a
 * synthesized ctx. This is the smallest surface that lets us drive the real
 * route code without reimplementing auth, validation, and envelope plumbing.
 *
 * The synthesized ctx carries:
 *   - `ctx.user` populated from a per-test override (or undefined to simulate
 *     a missing session — the passthrough then returns 401 as the real
 *     procedure would)
 *   - `ctx.input.body` validated via the config's Zod schema (replicates
 *     procedure's Zod failure → 400 for the "missing organizationId" case)
 *   - `ctx.services` populated from the test's mock
 *   - `ctx.executionCtx.waitUntil` spy for fire-and-forget assertions
 *   - `ctx.env.CACHE_KV` present so the helper isn't short-circuited
 *
 * This keeps the test surface focused on the cache-invalidation contract
 * the bead cares about, without pulling in a live session store.
 */
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: {
      policy?: { auth?: string };
      input?: { body?: { parse: (v: unknown) => unknown } };
      handler: (ctx: unknown) => Promise<unknown>;
      successStatus?: number;
    }) => {
      return async (c: {
        req: { json: () => Promise<unknown> };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        // 1. Auth gate — if the test context omits a user, mimic procedure's
        //    401. This covers the `feedback_security_deep_test` negative path.
        const testUser = c.get('__testUser') as
          | { id: string }
          | null
          | undefined;
        if (config.policy?.auth === 'required' && !testUser) {
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

        // 2. Body validation — match procedure's Zod 400 on parse failure.
        let body: unknown = {};
        if (config.input?.body) {
          const raw = await c.req.json().catch(() => ({}));
          const parsed = (
            config.input.body as unknown as {
              safeParse: (v: unknown) => {
                success: boolean;
                data?: unknown;
                error?: { issues: unknown };
              };
            }
          ).safeParse(raw);
          if (!parsed.success) {
            return c.json(
              {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid input',
                  details: parsed.error?.issues,
                },
              },
              400
            );
          }
          body = parsed.data;
        }

        // 3. Build the synthesized ctx and invoke the real handler.
        //    Pull env + executionCtx from ctx vars we wired up in the outer
        //    middleware (Hono's c.env / c.executionCtx are getter-only so
        //    we cannot mutate them from a test middleware).
        const services = c.get('__testServices');
        const obs = c.get('__testObs');
        const testEnv = c.get('__testEnv');
        const testExecCtx = c.get('__testExecCtx');
        const ctx = {
          user: testUser,
          session: null,
          input: { body },
          services,
          env: testEnv,
          executionCtx: testExecCtx,
          obs,
          requestId: 'test-request-id',
          clientIP: '127.0.0.1',
          userAgent: 'vitest',
          organizationId: undefined,
          organizationRole: undefined,
        };

        try {
          const result = await config.handler(ctx);
          return c.json(
            { data: result },
            (config.successStatus ?? 200) as 200 | 201
          );
        } catch (error) {
          // Route handlers propagate typed ServiceErrors; for this test we
          // only care that (a) the response is not a success and (b) the
          // helper was NOT called (assertion lives in the test body). The
          // exact status code mapping is handled by `mapErrorToResponse()`
          // in the real procedure; the test only needs a non-2xx here.
          return c.json(
            {
              error: {
                code: 'SERVICE_ERROR',
                message: error instanceof Error ? error.message : String(error),
              },
            },
            500
          );
        }
      };
    },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { AccessRevocation } from '@codex/access';
import { invalidateForUser } from '@codex/subscription';
import { Hono } from 'hono';
import subscriptions from '../subscriptions';

// ─── Test helpers ─────────────────────────────────────────────────────────────

type KVMock = {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

function createKVStub(): KVMock {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: Record<string, unknown>;
  kv?: KVMock | null;
}

interface AppBundle {
  // Hono typed with an arbitrary Variables shape — the outer test middleware
  // sets bookkeeping keys (__testUser, __testServices, etc.) that the mocked
  // procedure reads out.
  app: Hono<{ Variables: Record<string, unknown> }>;
  waitUntil: ReturnType<typeof vi.fn>;
  kv: KVMock | null;
  services: Record<string, unknown>;
}

/**
 * Build a Hono app that mounts the real `subscriptions` router and wires
 * per-test overrides onto the context via `c.set(key, value)` in a small
 * pre-handler middleware. The mocked `procedure` reads those keys.
 */
function buildApp(args: BuildAppArgs = {}): AppBundle {
  const waitUntil = vi.fn((_p: Promise<unknown>) => {});
  const kv = args.kv === null ? null : (args.kv ?? createKVStub());
  const services = args.services ?? {
    subscription: {
      cancelSubscription: vi.fn().mockResolvedValue(undefined),
      changeTier: vi.fn().mockResolvedValue(undefined),
      reactivateSubscription: vi.fn().mockResolvedValue(undefined),
      resumeSubscription: vi.fn().mockResolvedValue(undefined),
      getSubscription: vi.fn().mockResolvedValue({
        id: 'sub_stub',
        status: 'active',
      }),
    },
  };

  // Variables typing so `c.set(key, ...)` passes strict typecheck. The mocked
  // procedure reads these keys back out via `c.get(key)`.
  type TestVars = {
    __testUser: { id: string } | null | undefined;
    __testServices: Record<string, unknown>;
    __testObs: undefined;
    __testEnv: { CACHE_KV: KVMock | null };
    __testExecCtx: { waitUntil: typeof waitUntil };
  };
  const app = new Hono<{ Variables: TestVars }>();
  app.use('*', async (c, next) => {
    // Wire per-test overrides into ctx vars. Hono's `c.env` and
    // `c.executionCtx` are getter-only on the Context, so we stash the
    // test-specific env + executionCtx under `__testEnv` / `__testExecCtx`
    // and let the mocked `procedure` read them out.
    c.set('__testUser', args.user === undefined ? { id: 'user_1' } : args.user);
    c.set('__testServices', services);
    c.set('__testObs', undefined);
    c.set('__testEnv', { CACHE_KV: kv });
    c.set('__testExecCtx', { waitUntil });
    await next();
  });
  // The real sub-router is typed with HonoEnv (HonoEnv has Bindings); our
  // test app declares a Variables-only generic so `c.set` typechecks. Use
  // an untyped route registration for the boundary so both sides stay honest.
  (app as unknown as { route: (path: string, r: unknown) => void }).route(
    '/subscriptions',
    subscriptions
  );

  return {
    app: app as unknown as AppBundle['app'],
    waitUntil,
    kv,
    services,
  };
}

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Scenario matrix runner ───────────────────────────────────────────────────

interface EndpointCase {
  label: string;
  path: string;
  validBody: Record<string, unknown>;
  reason: 'cancel' | 'change_tier' | 'reactivate' | 'subscription_resumed';
  /** Which service method to spy on for the "service throws" case. */
  serviceMethod:
    | 'cancelSubscription'
    | 'changeTier'
    | 'reactivateSubscription'
    | 'resumeSubscription';
}

const VALID_ORG_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_TIER_ID = '223e4567-e89b-12d3-a456-426614174001';

const CASES: EndpointCase[] = [
  {
    label: 'POST /subscriptions/cancel',
    path: '/subscriptions/cancel',
    validBody: { organizationId: VALID_ORG_ID, reason: 'too expensive' },
    reason: 'cancel',
    serviceMethod: 'cancelSubscription',
  },
  {
    label: 'POST /subscriptions/change-tier',
    path: '/subscriptions/change-tier',
    validBody: {
      organizationId: VALID_ORG_ID,
      newTierId: VALID_TIER_ID,
      billingInterval: 'month',
    },
    reason: 'change_tier',
    serviceMethod: 'changeTier',
  },
  {
    label: 'POST /subscriptions/reactivate',
    path: '/subscriptions/reactivate',
    validBody: { organizationId: VALID_ORG_ID },
    reason: 'reactivate',
    serviceMethod: 'reactivateSubscription',
  },
  // Codex-7h4vo — user-initiated resume endpoint. Same contract as
  // /reactivate: service owns cache invalidation, route clears
  // AccessRevocation (access-RESTORING), route must NOT call
  // `invalidateForUser` itself.
  {
    label: 'POST /subscriptions/resume',
    path: '/subscriptions/resume',
    validBody: { organizationId: VALID_ORG_ID },
    reason: 'subscription_resumed',
    serviceMethod: 'resumeSubscription',
  },
];

describe.each(CASES)('$label — route → service contract', ({
  path,
  validBody,
  reason: _reason,
  serviceMethod,
}) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: authenticated valid POST → service method called with correct args, invalidateForUser NOT called at route layer', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn().mockResolvedValue(undefined),
        changeTier: vi.fn().mockResolvedValue(undefined),
        reactivateSubscription: vi.fn().mockResolvedValue(undefined),
        resumeSubscription: vi.fn().mockResolvedValue(undefined),
        getSubscription: vi
          .fn()
          .mockResolvedValue({ id: 'sub_stub', status: 'active' }),
      },
    };
    const bundle = buildApp({ user: { id: 'user_positive' }, services });
    const res = await bundle.app.request(postJson(path, validBody));
    expect(res.status).toBe(200);

    // Route must invoke the right service method (positive contract).
    const subscriptionService = services.subscription as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(subscriptionService[serviceMethod]).toHaveBeenCalledTimes(1);

    // Route must NOT call invalidateForUser itself — that moved into
    // SubscriptionService's orchestrator hook (Codex-esikl). Double
    // calls would double-bump the KV version keys and mask orchestrator
    // regressions from this test.
    expect(invalidateForUser).not.toHaveBeenCalled();

    // And getSubscription is called to return the refreshed record.
    expect(subscriptionService.getSubscription).toHaveBeenCalledWith(
      'user_positive',
      VALID_ORG_ID
    );
  });

  it('negative auth: no session → 401, no service call, no helper call', async () => {
    const bundle = buildApp({ user: null });
    const res = await bundle.app.request(postJson(path, validBody));
    expect(res.status).toBe(401);

    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(bundle.waitUntil).not.toHaveBeenCalled();
    // KV must never be touched on an unauthenticated request.
    expect(bundle.kv?.put).not.toHaveBeenCalled();
  });

  it('negative body: missing organizationId → 400 Zod validation, helper NOT called', async () => {
    const bundle = buildApp();
    // Strip organizationId from the body to force a Zod failure.
    // biome-ignore lint/correctness/noUnusedVariables: destructuring to drop key
    const { organizationId: _drop, ...rest } = validBody;
    const res = await bundle.app.request(postJson(path, rest));
    expect(res.status).toBe(400);
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(bundle.waitUntil).not.toHaveBeenCalled();
  });

  it('service throws: invalidation runs AFTER success, so helper NOT called on error', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi.fn(),
        resumeSubscription: vi.fn(),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'sub_stub',
          status: 'active',
        }),
      },
    };
    // Force the tested service method to throw.
    (services.subscription as Record<string, ReturnType<typeof vi.fn>>)[
      serviceMethod
    ] = vi.fn().mockRejectedValue(new Error('boom: service failure'));

    const bundle = buildApp({ services });
    const res = await bundle.app.request(postJson(path, validBody));
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);

    expect(invalidateForUser).not.toHaveBeenCalled();
    // And nothing leaked into waitUntil either — the cache bump must
    // only ever run after a successful mutation.
    expect(bundle.waitUntil).not.toHaveBeenCalled();
  });
});

// ─── POST /subscriptions/reactivate — access clearing (Codex-13ml3) ──────────
//
// Complements the cache-invalidation matrix above with a per-route assertion
// that the reactivate endpoint also clears the KV revocation key. Sibling
// bead to Codex-usgf7 (which handles writes on access-reducing events) and
// the webhook-side clear tests in `subscription-webhook-revocation.test.ts`.

describe('POST /subscriptions/reactivate — access clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);
  });

  it('positive: reactivate → AccessRevocation.clear called (invalidateForUser no longer called at route layer)', async () => {
    const bundle = buildApp({ user: { id: 'user_reactivate' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/reactivate', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);

    // Cache invalidation migrated into SubscriptionService — route no
    // longer calls the helper itself (Codex-esikl).
    expect(invalidateForUser).not.toHaveBeenCalled();
    // AccessRevocation.clear is a SEPARATE concern from cache invalidation
    // and still lives in the route. Must fire on reactivate.
    expect(AccessRevocation).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledWith('user_reactivate', VALID_ORG_ID);
  });

  it('negative auth: no session → 401, clear NOT called', async () => {
    const bundle = buildApp({ user: null });
    const res = await bundle.app.request(
      postJson('/subscriptions/reactivate', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(401);

    expect(mockClear).not.toHaveBeenCalled();
  });

  it('service throws: clear NOT called (runs after successful service call)', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi
          .fn()
          .mockRejectedValue(new Error('boom: not cancelling')),
        getSubscription: vi
          .fn()
          .mockResolvedValue({ id: 'sub_stub', status: 'active' }),
      },
    };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/reactivate', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).not.toBe(200);

    expect(mockClear).not.toHaveBeenCalled();
  });

  it('no CACHE_KV binding → clear NOT called, no crash', async () => {
    const bundle = buildApp({ user: { id: 'user_nokv' }, kv: null });
    const res = await bundle.app.request(
      postJson('/subscriptions/reactivate', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);

    expect(mockClear).not.toHaveBeenCalled();
  });

  it('fire-and-forget: KV clear failure does not surface on the route response', async () => {
    mockClear.mockRejectedValueOnce(new Error('KV unreachable'));
    const bundle = buildApp({ user: { id: 'user_clear_fail' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/reactivate', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('not called on /subscriptions/cancel (access-reducing, not restoring)', async () => {
    const bundle = buildApp({ user: { id: 'user_cxl' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/cancel', {
        organizationId: VALID_ORG_ID,
        reason: 'too expensive',
      })
    );
    expect(res.status).toBe(200);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('not called on /subscriptions/change-tier (user was already active)', async () => {
    const bundle = buildApp({ user: { id: 'user_tier' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/change-tier', {
        organizationId: VALID_ORG_ID,
        newTierId: VALID_TIER_ID,
        billingInterval: 'month',
      })
    );
    expect(res.status).toBe(200);
    expect(mockClear).not.toHaveBeenCalled();
  });
});

// ─── POST /subscriptions/resume — access clearing (Codex-7h4vo) ──────────────
//
// Parallel contract to /reactivate: user-initiated resume is access-RESTORING,
// so the route clears the KV revocation key fire-and-forget (idempotent,
// no-op if no key was ever written). Cache invalidation itself moved into
// the service's orchestrator hook (see Codex-esikl), so the route layer
// must NEVER call `invalidateForUser`.

describe('POST /subscriptions/resume — access clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);
  });

  it('positive: resume → AccessRevocation.clear called, invalidateForUser NOT called at route layer', async () => {
    const bundle = buildApp({ user: { id: 'user_resume' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);

    // Cache invalidation lives in SubscriptionService.
    expect(invalidateForUser).not.toHaveBeenCalled();
    // AccessRevocation.clear is a separate concern and fires at the route.
    expect(AccessRevocation).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledWith('user_resume', VALID_ORG_ID);
  });

  it('positive: resume → service.resumeSubscription called with (userId, organizationId)', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi.fn(),
        resumeSubscription: vi.fn().mockResolvedValue(undefined),
        getSubscription: vi
          .fn()
          .mockResolvedValue({ id: 'sub_stub', status: 'active' }),
      },
    };
    const bundle = buildApp({ user: { id: 'user_resume_args' }, services });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);

    const subscriptionService = services.subscription as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(subscriptionService.resumeSubscription).toHaveBeenCalledTimes(1);
    expect(subscriptionService.resumeSubscription).toHaveBeenCalledWith(
      'user_resume_args',
      VALID_ORG_ID
    );
    // Route refetches the subscription for the response envelope.
    expect(subscriptionService.getSubscription).toHaveBeenCalledWith(
      'user_resume_args',
      VALID_ORG_ID
    );
  });

  it('negative auth: no session → 401, clear NOT called, service NOT called', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi.fn(),
        resumeSubscription: vi.fn(),
        getSubscription: vi.fn(),
      },
    };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(401);

    expect(mockClear).not.toHaveBeenCalled();
    expect(
      (services.subscription as Record<string, ReturnType<typeof vi.fn>>)
        .resumeSubscription
    ).not.toHaveBeenCalled();
  });

  it('negative body: missing organizationId → 400 Zod, service NOT called', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi.fn(),
        resumeSubscription: vi.fn(),
        getSubscription: vi.fn(),
      },
    };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(postJson('/subscriptions/resume', {}));
    expect(res.status).toBe(400);

    expect(mockClear).not.toHaveBeenCalled();
    expect(
      (services.subscription as Record<string, ReturnType<typeof vi.fn>>)
        .resumeSubscription
    ).not.toHaveBeenCalled();
  });

  it('service throws: error propagates, clear NOT called, no cache writes', async () => {
    const services: Record<string, unknown> = {
      subscription: {
        cancelSubscription: vi.fn(),
        changeTier: vi.fn(),
        reactivateSubscription: vi.fn(),
        resumeSubscription: vi
          .fn()
          .mockRejectedValue(new Error('boom: not paused')),
        getSubscription: vi
          .fn()
          .mockResolvedValue({ id: 'sub_stub', status: 'active' }),
      },
    };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).not.toBe(200);

    expect(mockClear).not.toHaveBeenCalled();
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(bundle.kv?.put).not.toHaveBeenCalled();
  });

  it('no CACHE_KV binding → clear NOT called, no crash', async () => {
    const bundle = buildApp({ user: { id: 'user_resume_nokv' }, kv: null });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);

    expect(mockClear).not.toHaveBeenCalled();
  });

  it('fire-and-forget: KV clear failure does not surface on the route response', async () => {
    mockClear.mockRejectedValueOnce(new Error('KV unreachable'));
    const bundle = buildApp({ user: { id: 'user_resume_clear_fail' } });
    const res = await bundle.app.request(
      postJson('/subscriptions/resume', { organizationId: VALID_ORG_ID })
    );
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});

// ─── Env-absent regression (CACHE_KV missing) ─────────────────────────────────

describe('route invalidation — regression guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes NEVER call invalidateForUser — service owns it (CACHE_KV absent, Codex-esikl)', async () => {
    // Pre-Codex-esikl, the route called `invalidateForUser` directly and
    // guarded on `CACHE_KV`. Now the service owns invalidation — routes
    // should NEVER call it, regardless of KV binding state. This is a
    // regression guard against reintroducing a second (duplicated) call
    // site at the route layer.
    const bundle = buildApp({ kv: null });
    const res = await bundle.app.request(
      postJson('/subscriptions/cancel', {
        organizationId: VALID_ORG_ID,
        reason: 'no kv',
      })
    );
    expect(res.status).toBe(200);
    expect(invalidateForUser).not.toHaveBeenCalled();
  });

  it('routes NEVER call invalidateForUser — service owns it (CACHE_KV present, Codex-esikl)', async () => {
    const bundle = buildApp();
    const res = await bundle.app.request(
      postJson('/subscriptions/cancel', {
        organizationId: VALID_ORG_ID,
        reason: 'with kv',
      })
    );
    expect(res.status).toBe(200);
    expect(invalidateForUser).not.toHaveBeenCalled();
  });
});
