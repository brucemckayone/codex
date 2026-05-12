/**
 * Route-layer HTTP-boundary tests for the read/create subscription endpoints
 * (Codex-25svv, child of epic Codex-oal4l).
 *
 * The audit on 2026-05-12 noted that 7 of the 11 routes registered in
 * `workers/ecom-api/src/routes/subscriptions.ts` had no route-level test —
 * `subscriptions-route-invalidation.test.ts` covers only the 4 mutations
 * (cancel / change-tier / reactivate / resume).
 *
 * This file covers the four read/create endpoints:
 *   - POST /subscriptions/checkout
 *   - GET  /subscriptions/verify
 *   - GET  /subscriptions/current
 *   - GET  /subscriptions/mine
 *
 * (Sibling task Codex-mhnfe owns `/preview-tier-change`, `/stats`,
 * `/subscribers`; they are NOT in this file.)
 *
 * For every endpoint we assert (per `feedback_security_deep_test`, positive
 * AND negative paths mandatory):
 *
 *   1. Positive: authenticated valid request → success status, service
 *      method called with the correct args.
 *   2. Negative auth: no session → 401, service NOT called.
 *   3. Negative body / query: invalid input (missing required UUID,
 *      malformed UUID) → 400, service NOT called.
 *   4. Service throws a typed `ServiceError` subclass → correct HTTP
 *      mapping via `mapErrorToResponse` (404 / 403 / 409).
 *   5. Service throws an unknown `Error` → 500 with a generic, redacted
 *      message (no stack, no SQL leak).
 *
 * Plus endpoint-specific regression guards:
 *   - /verify: session belongs to a different user → ForbiddenError → 403
 *     (HTTP mapping for the throw asserted at service level in
 *     `packages/subscription/src/services/__tests__/subscription-service.test.ts:461`).
 *   - /current: service returns `null` → response is `{ data: null }`
 *     (the apps/web `getCurrentSubscription` remote relies on this shape
 *     to differentiate "no active sub" from "fetch failed").
 *   - /mine: only `userId` is forwarded; soft-deleted / inactive rows are
 *     filtered inside the service (see `getUserSubscriptions` —
 *     `inArray(status, [ACTIVE, CANCELLING, PAST_DUE])`). The route MUST
 *     NOT pass any extra args, otherwise the service's status filter
 *     contract changes silently.
 *
 * Harness: copies the `buildApp()` + mocked-`procedure` pattern from
 * `subscriptions-route-invalidation.test.ts`. The mocked `procedure`
 * synthesizes a ctx (user, services, env, executionCtx) and invokes the
 * real handler. We extend the harness to:
 *   - read query input via `c.req.query()` so /verify and /current can
 *     exercise their query schema, and
 *   - delegate caught handler errors to the real `mapErrorToResponse` so
 *     ServiceError subclasses map to their canonical status codes (the
 *     existing invalidation test never needed this — it only checked
 *     "not 200" — but for this bead we need 404 / 403 / 409 / 500 to
 *     differentiate cases).
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (must be declared before route module import) ─────────────────────

vi.mock('@codex/subscription', async () => {
  return {
    invalidateForUser: vi.fn(),
    // SubscriptionService is constructed by the service registry. We bypass
    // that by passing a hand-built services object, but import resolution
    // still needs the symbol.
    SubscriptionService: vi.fn(),
  };
});

const mockClear = vi.fn().mockResolvedValue(undefined);
vi.mock('@codex/access', () => ({
  AccessRevocation: vi.fn().mockImplementation(() => ({
    revoke: vi.fn(),
    isRevoked: vi.fn(),
    clear: mockClear,
  })),
}));

/**
 * Pass-through `procedure` mock that:
 *   - rejects requests with no test user when auth is required (401)
 *   - validates body via the config's Zod schema (400 on failure)
 *   - validates query via the config's Zod schema (400 on failure)
 *   - invokes the real handler with a synthesized ctx
 *   - delegates caught errors to the real `mapErrorToResponse` so typed
 *     ServiceError subclasses produce their canonical HTTP status. This
 *     mirrors what the production `procedure` does (see
 *     packages/worker-utils/src/procedure/procedure.ts:23 — it imports
 *     and calls `mapErrorToResponse` from `@codex/service-errors`).
 */
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: {
      policy?: { auth?: string };
      input?: {
        body?: { safeParse: (v: unknown) => unknown };
        query?: { safeParse: (v: unknown) => unknown };
      };
      handler: (ctx: unknown) => Promise<unknown>;
      successStatus?: number;
    }) => {
      return async (c: {
        req: {
          json: () => Promise<unknown>;
          query: () => Record<string, string>;
        };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        // 1. Auth gate.
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

        // 2. Body validation.
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

        // 3. Query validation.
        let query: unknown = {};
        if (config.input?.query) {
          const raw = c.req.query();
          const parsed = (
            config.input.query as unknown as {
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
          query = parsed.data;
        }

        // 4. Build synthesized ctx and invoke the real handler.
        const services = c.get('__testServices');
        const obs = c.get('__testObs');
        const testEnv = c.get('__testEnv');
        const testExecCtx = c.get('__testExecCtx');
        const ctx = {
          user: testUser,
          session: null,
          input: { body, query },
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
          // Delegate to the real mapper so ServiceError subclasses map to
          // their canonical status code (404 / 403 / 409 / 422), and
          // unknown errors map to a redacted 500. This mirrors what
          // production `procedure` does — see procedure.ts:23.
          const { statusCode, response } = mapErrorToResponse(error, {
            logError: false,
          });
          return c.json(response, statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500);
        }
      };
    },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';
import { Hono } from 'hono';
import subscriptions from '../subscriptions';

// We hand-build an AlreadySubscribedError equivalent rather than importing
// from `@codex/subscription` (which we've mocked above to a hollow shape).
// Functionally identical for the test: it's a `ConflictError` → 409 mapping
// we are asserting at the HTTP boundary.
import { ConflictError } from '@codex/service-errors';

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

interface SubscriptionServiceMock {
  createCheckoutSession: ReturnType<typeof vi.fn>;
  verifyCheckoutSession: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
  getUserSubscriptions: ReturnType<typeof vi.fn>;
}

function createSubscriptionServiceMock(): SubscriptionServiceMock {
  return {
    createCheckoutSession: vi.fn().mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.com/session_stub',
      sessionId: 'cs_stub',
    }),
    verifyCheckoutSession: vi.fn().mockResolvedValue({
      sessionStatus: 'complete',
      subscription: {
        id: 'sub_stub',
        organizationId: '123e4567-e89b-12d3-a456-426614174000',
        tierId: '223e4567-e89b-12d3-a456-426614174001',
        tierName: 'Pro',
        organizationName: 'Studio',
        organizationSlug: 'studio',
        startedAt: '2026-05-12T00:00:00.000Z',
      },
    }),
    getSubscription: vi
      .fn()
      .mockResolvedValue({ id: 'sub_stub', status: 'active' }),
    getUserSubscriptions: vi.fn().mockResolvedValue([
      {
        id: 'sub_stub_a',
        organizationId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'active',
      },
    ]),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: { subscription: SubscriptionServiceMock };
  kv?: KVMock | null;
}

interface AppBundle {
  app: Hono<{ Variables: Record<string, unknown> }>;
  waitUntil: ReturnType<typeof vi.fn>;
  kv: KVMock | null;
  services: { subscription: SubscriptionServiceMock };
}

function buildApp(args: BuildAppArgs = {}): AppBundle {
  const waitUntil = vi.fn((_p: Promise<unknown>) => {});
  const kv = args.kv === null ? null : (args.kv ?? createKVStub());
  const services = args.services ?? {
    subscription: createSubscriptionServiceMock(),
  };

  type TestVars = {
    __testUser: { id: string } | null | undefined;
    __testServices: { subscription: SubscriptionServiceMock };
    __testObs: undefined;
    __testEnv: { CACHE_KV: KVMock | null };
    __testExecCtx: { waitUntil: typeof waitUntil };
  };
  const app = new Hono<{ Variables: TestVars }>();
  app.use('*', async (c, next) => {
    c.set(
      '__testUser',
      args.user === undefined ? { id: 'user_1' } : args.user
    );
    c.set('__testServices', services);
    c.set('__testObs', undefined);
    c.set('__testEnv', { CACHE_KV: kv });
    c.set('__testExecCtx', { waitUntil });
    await next();
  });
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

function getReq(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_ORG_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_TIER_ID = '223e4567-e89b-12d3-a456-426614174001';
// `checkoutRedirectUrlSchema` whitelists localhost / lvh.me / revelations.studio.
const VALID_REDIRECT = 'https://lvh.me/success';
const VALID_CANCEL = 'https://lvh.me/cancel';

// ─── POST /subscriptions/checkout ────────────────────────────────────────────

describe('POST /subscriptions/checkout — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: authenticated valid POST → 201, service called with correct args', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: { id: 'user_pos' }, services });
    const body = {
      organizationId: VALID_ORG_ID,
      tierId: VALID_TIER_ID,
      billingInterval: 'month' as const,
      successUrl: VALID_REDIRECT,
      cancelUrl: VALID_CANCEL,
    };
    const res = await bundle.app.request(postJson('/subscriptions/checkout', body));
    expect(res.status).toBe(201);

    const payload = (await res.json()) as { data: { checkoutUrl: string } };
    expect(payload.data.checkoutUrl).toBe(
      'https://checkout.stripe.com/session_stub'
    );

    expect(services.subscription.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(services.subscription.createCheckoutSession).toHaveBeenCalledWith(
      'user_pos',
      VALID_ORG_ID,
      VALID_TIER_ID,
      'month',
      VALID_REDIRECT,
      VALID_CANCEL
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const body = {
      organizationId: VALID_ORG_ID,
      tierId: VALID_TIER_ID,
      billingInterval: 'month',
      successUrl: VALID_REDIRECT,
      cancelUrl: VALID_CANCEL,
    };
    const res = await bundle.app.request(postJson('/subscriptions/checkout', body));
    expect(res.status).toBe(401);
    expect(services.subscription.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('negative body: missing tierId → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/checkout', {
        organizationId: VALID_ORG_ID,
        billingInterval: 'month',
        successUrl: VALID_REDIRECT,
        cancelUrl: VALID_CANCEL,
      })
    );
    expect(res.status).toBe(400);
    expect(services.subscription.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('negative body: malformed UUID → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/checkout', {
        organizationId: 'not-a-uuid',
        tierId: VALID_TIER_ID,
        billingInterval: 'month',
        successUrl: VALID_REDIRECT,
        cancelUrl: VALID_CANCEL,
      })
    );
    expect(res.status).toBe(400);
    expect(services.subscription.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('service throws AlreadySubscribedError (ConflictError) → 409 with code surfaced', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.createCheckoutSession.mockRejectedValueOnce(
      new ConflictError('User is already subscribed to this organization', {
        userId: 'user_dup',
        organizationId: VALID_ORG_ID,
        code: 'ALREADY_SUBSCRIBED',
      })
    );
    const bundle = buildApp({ user: { id: 'user_dup' }, services });
    const body = {
      organizationId: VALID_ORG_ID,
      tierId: VALID_TIER_ID,
      billingInterval: 'month' as const,
      successUrl: VALID_REDIRECT,
      cancelUrl: VALID_CANCEL,
    };
    const res = await bundle.app.request(postJson('/subscriptions/checkout', body));
    expect(res.status).toBe(409);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('CONFLICT');
    expect(payload.error.message).toMatch(/already subscribed/i);
  });

  it('service throws unknown Error → 500 with redacted generic message (no stack, no SQL)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.createCheckoutSession.mockRejectedValueOnce(
      new Error('PG: relation "subscriptions" does not exist at line 42')
    );
    const bundle = buildApp({ services });
    const body = {
      organizationId: VALID_ORG_ID,
      tierId: VALID_TIER_ID,
      billingInterval: 'month' as const,
      successUrl: VALID_REDIRECT,
      cancelUrl: VALID_CANCEL,
    };
    const res = await bundle.app.request(postJson('/subscriptions/checkout', body));
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    // Internal details MUST NOT leak.
    expect(payload.error.message).not.toMatch(/PG:/);
    expect(payload.error.message).not.toMatch(/relation/i);
    expect(payload.error.message).not.toMatch(/subscriptions/);
    expect(payload.error.details).toBeUndefined();
  });
});

// ─── GET /subscriptions/verify ───────────────────────────────────────────────

describe('GET /subscriptions/verify — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: authenticated valid GET → 200, service called with (sessionId, userId)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: { id: 'user_verify' }, services });
    const res = await bundle.app.request(
      getReq('/subscriptions/verify?session_id=cs_test_123')
    );
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: { sessionStatus: string };
    };
    expect(payload.data.sessionStatus).toBe('complete');

    expect(services.subscription.verifyCheckoutSession).toHaveBeenCalledTimes(1);
    expect(services.subscription.verifyCheckoutSession).toHaveBeenCalledWith(
      'cs_test_123',
      'user_verify'
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      getReq('/subscriptions/verify?session_id=cs_test_123')
    );
    expect(res.status).toBe(401);
    expect(services.subscription.verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('negative query: missing session_id → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/subscriptions/verify'));
    expect(res.status).toBe(400);
    expect(services.subscription.verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('regression: session belongs to different user → ForbiddenError → 403 (HTTP mapping for the throw)', async () => {
    // Service-level throw is asserted in
    // packages/subscription/src/services/__tests__/subscription-service.test.ts:461.
    // This is the HTTP-boundary mapping for that throw — Codex-25svv design
    // calls this out as the most important regression guard on /verify.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.verifyCheckoutSession.mockRejectedValueOnce(
      new ForbiddenError(
        'Checkout session does not belong to authenticated user',
        { sessionId: 'cs_other_user' }
      )
    );
    const bundle = buildApp({ user: { id: 'user_attacker' }, services });
    const res = await bundle.app.request(
      getReq('/subscriptions/verify?session_id=cs_other_user')
    );
    expect(res.status).toBe(403);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('FORBIDDEN');
    expect(payload.error.message).toMatch(/does not belong/i);
  });

  it('service throws NotFoundError → 404', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.verifyCheckoutSession.mockRejectedValueOnce(
      new NotFoundError('Checkout session not found', {
        sessionId: 'cs_missing',
      })
    );
    const bundle = buildApp({ user: { id: 'user_v' }, services });
    const res = await bundle.app.request(
      getReq('/subscriptions/verify?session_id=cs_missing')
    );
    expect(res.status).toBe(404);
  });

  it('service throws unknown Error → 500 redacted', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.verifyCheckoutSession.mockRejectedValueOnce(
      new Error('PG: connection refused at /var/lib/postgres/data')
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq('/subscriptions/verify?session_id=cs_x')
    );
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toMatch(/postgres/i);
    expect(payload.error.message).not.toMatch(/PG:/);
  });
});

// ─── GET /subscriptions/current ──────────────────────────────────────────────

describe('GET /subscriptions/current — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: authenticated valid GET with active sub → 200, service called with (userId, organizationId)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: { id: 'user_curr' }, services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/current?organizationId=${VALID_ORG_ID}`)
    );
    expect(res.status).toBe(200);

    const payload = (await res.json()) as { data: unknown };
    expect(payload.data).toEqual({ id: 'sub_stub', status: 'active' });

    expect(services.subscription.getSubscription).toHaveBeenCalledTimes(1);
    expect(services.subscription.getSubscription).toHaveBeenCalledWith(
      'user_curr',
      VALID_ORG_ID
    );
  });

  it('shape: service returns null → response is { data: null } (consumed by apps/web getCurrentSubscription)', async () => {
    // The remote function at apps/web/src/lib/remote/subscription.remote.ts:63
    // expects `null` to mean "no active subscription" — anything else would
    // break the conditional rendering on the account/subscriptions page.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getSubscription.mockResolvedValueOnce(null);
    const bundle = buildApp({ user: { id: 'user_null' }, services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/current?organizationId=${VALID_ORG_ID}`)
    );
    expect(res.status).toBe(200);

    const payload = (await res.json()) as { data: unknown };
    expect(payload).toHaveProperty('data');
    expect(payload.data).toBeNull();
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/current?organizationId=${VALID_ORG_ID}`)
    );
    expect(res.status).toBe(401);
    expect(services.subscription.getSubscription).not.toHaveBeenCalled();
  });

  it('negative query: missing organizationId → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/subscriptions/current'));
    expect(res.status).toBe(400);
    expect(services.subscription.getSubscription).not.toHaveBeenCalled();
  });

  it('negative query: malformed UUID → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq('/subscriptions/current?organizationId=not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(services.subscription.getSubscription).not.toHaveBeenCalled();
  });

  it('service throws NotFoundError → 404', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getSubscription.mockRejectedValueOnce(
      new NotFoundError('Organization not found', {
        organizationId: VALID_ORG_ID,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/current?organizationId=${VALID_ORG_ID}`)
    );
    expect(res.status).toBe(404);
  });

  it('service throws unknown Error → 500 redacted', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getSubscription.mockRejectedValueOnce(
      new Error('PG: relation "subscriptions" does not exist')
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/current?organizationId=${VALID_ORG_ID}`)
    );
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toMatch(/PG:/);
    expect(payload.error.message).not.toMatch(/relation/i);
  });
});

// ─── GET /subscriptions/mine ─────────────────────────────────────────────────

describe('GET /subscriptions/mine — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('positive: authenticated GET → 200, service called with ONLY userId (status filter lives in service)', async () => {
    // Route handler (subscriptions.ts:170-172) calls
    // `getUserSubscriptions(ctx.user.id)` with no extra args. The
    // soft-delete / inactive-status filtering is implemented inside the
    // service via `inArray(status, [ACTIVE, CANCELLING, PAST_DUE])`
    // (subscription-service.ts:2098). If the route ever starts forwarding
    // status / pagination params, this assertion fails — keeps the service
    // contract pinned.
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: { id: 'user_mine' }, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(200);

    expect(services.subscription.getUserSubscriptions).toHaveBeenCalledTimes(1);
    expect(services.subscription.getUserSubscriptions).toHaveBeenCalledWith(
      'user_mine'
    );
    // No second arg — assert the call arity, not just the prefix.
    const firstCall =
      services.subscription.getUserSubscriptions.mock.calls[0] ?? [];
    expect(firstCall.length).toBe(1);
  });

  it('positive: response wraps the service result in { data: [...] }', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getUserSubscriptions.mockResolvedValueOnce([
      { id: 'sub_a', status: 'active' },
      { id: 'sub_b', status: 'cancelling' },
    ]);
    const bundle = buildApp({ user: { id: 'user_list' }, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(200);

    const payload = (await res.json()) as { data: Array<{ id: string }> };
    expect(payload.data).toHaveLength(2);
    expect(payload.data.map((s) => s.id)).toEqual(['sub_a', 'sub_b']);
  });

  it('soft-delete contract: service filters inactive rows; route does not see them', async () => {
    // Simulate the service's status filter: it already excludes
    // soft-deleted / non-active rows. The route must surface exactly
    // what the service returns, untouched.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getUserSubscriptions.mockResolvedValueOnce([
      { id: 'sub_active', status: 'active' },
      // No `expired` / `incomplete_expired` / soft-deleted rows here —
      // they were filtered inside the service.
    ]);
    const bundle = buildApp({ user: { id: 'user_filter' }, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: Array<{ id: string; status: string }>;
    };
    expect(payload.data).toEqual([{ id: 'sub_active', status: 'active' }]);
    // And the route forwarded NO additional filtering args — the service
    // owns the filter contract end-to-end.
    expect(services.subscription.getUserSubscriptions).toHaveBeenCalledWith(
      'user_filter'
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(401);
    expect(services.subscription.getUserSubscriptions).not.toHaveBeenCalled();
  });

  it('service throws unknown Error → 500 redacted (no SQL, no stack)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getUserSubscriptions.mockRejectedValueOnce(
      new Error('PG: column "subscriptions.deleted_at" does not exist')
    );
    const bundle = buildApp({ user: { id: 'user_500' }, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toMatch(/PG:/);
    expect(payload.error.message).not.toMatch(/deleted_at/);
    expect(payload.error.message).not.toMatch(/column/i);
    expect(payload.error.details).toBeUndefined();
  });

  it('service throws typed ForbiddenError → 403 (regression guard for cross-user scoping leaks)', async () => {
    // Should never happen with current route — handler only passes
    // ctx.user.id — but if the service ever grows a cross-user query
    // path, this assertion forces the mapping to surface as 403, not 500.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getUserSubscriptions.mockRejectedValueOnce(
      new ForbiddenError('Cannot list another user\'s subscriptions', {
        userId: 'user_attacker',
      })
    );
    const bundle = buildApp({ user: { id: 'user_attacker' }, services });
    const res = await bundle.app.request(getReq('/subscriptions/mine'));
    expect(res.status).toBe(403);
  });
});
