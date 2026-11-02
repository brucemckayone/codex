/**
 * Route-layer tests for the account page's new subscription endpoints:
 *
 *   - POST /subscriptions/keep-current-plan                     (Codex-2hxff.16)
 *   - GET  /subscriptions/courses/mine                          (Codex-2hxff.52)
 *   - POST /subscriptions/courses/:courseSubscriptionId/cancel     (.52)
 *   - POST /subscriptions/courses/:courseSubscriptionId/reactivate (.52)
 *
 * They pin the HTTP contract, not the service (that is
 * `packages/subscription`'s tier-move and course-subscription-account
 * integration tests): the policy each route declares, its input validation,
 * the caller's id reaching the service, the envelope, and the error codes
 * the web reads (`details.code` via mapErrorToResponse).
 *
 * Harness: the `procedure` mock of agreements-routes.test.ts (auth gate,
 * body/query/params validation, the real mapErrorToResponse), which also
 * records each route's declared policy so the rate-limit preset is pinned.
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks (before the route module import) ───────────────────────────

vi.mock('@codex/subscription', async () => ({
  invalidateForUser: vi.fn(),
  SubscriptionService: vi.fn(),
}));

vi.mock('@codex/access', () => ({
  AccessRevocation: vi.fn().mockImplementation(() => ({
    revoke: vi.fn(),
    isRevoked: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

interface ProcedureConfig {
  policy?: { auth?: string; rateLimit?: string };
  input?: {
    body?: { safeParse: (v: unknown) => unknown };
    query?: { safeParse: (v: unknown) => unknown };
    params?: { safeParse: (v: unknown) => unknown };
  };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

/** The policy of the route that served the last request. */
const served: { policy?: ProcedureConfig['policy'] } = {};

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  type Parsed = {
    success: boolean;
    data?: unknown;
    error?: { issues: unknown };
  };
  const invalid = (
    c: { json: (body: unknown, status?: number) => unknown },
    parsed: Parsed
  ) =>
    c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error?.issues,
        },
      },
      400
    );
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: {
          json: () => Promise<unknown>;
          query: () => Record<string, string>;
          param: () => Record<string, string>;
        };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        served.policy = config.policy;
        const testUser = c.get('__testUser') as { id: string } | null;
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
        const parse = (schema: unknown, raw: unknown) =>
          (schema as { safeParse: (v: unknown) => Parsed }).safeParse(raw);

        let body: unknown = {};
        if (config.input?.body) {
          const parsed = parse(
            config.input.body,
            await c.req.json().catch(() => ({}))
          );
          if (!parsed.success) return invalid(c, parsed);
          body = parsed.data;
        }
        let query: unknown = {};
        if (config.input?.query) {
          const parsed = parse(config.input.query, c.req.query());
          if (!parsed.success) return invalid(c, parsed);
          query = parsed.data;
        }
        let params: unknown = {};
        if (config.input?.params) {
          const parsed = parse(config.input.params, c.req.param());
          if (!parsed.success) return invalid(c, parsed);
          params = parsed.data;
        }

        try {
          const result = await config.handler({
            user: testUser,
            input: { body, query, params },
            services: c.get('__testServices'),
          });
          if (result instanceof actual.PaginatedResult) {
            return c.json(
              { items: result.items, pagination: result.pagination },
              200
            );
          }
          return c.json(
            { data: result },
            (config.successStatus ?? 200) as 200 | 201
          );
        } catch (error) {
          const { statusCode, response } = mapErrorToResponse(error, {
            logError: false,
          });
          return c.json(
            response,
            statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
          );
        }
      };
    },
  };
});

// ─── Imports (after the mocks) ───────────────────────────────────────────────

import { ConflictError, NotFoundError } from '@codex/service-errors';
import { Hono } from 'hono';
import subscriptions from '../subscriptions';

const USER_ID = 'memberusid9999999999999999999';
const ORG_ID = '323e4567-e89b-12d3-a456-426614174002';
const COURSE_SUB_ID = '11111111-1111-4111-9111-111111111111';

const CARD = {
  id: COURSE_SUB_ID,
  status: 'cancelling',
  billingInterval: 'month',
  amountCents: 5000,
  currentPeriodEnd: '2026-11-30T00:00:00.000Z',
  cancelAtPeriodEnd: true,
  disputedAt: null,
  canReactivate: true,
  course: { id: 'c1', title: 'Breathwork', slug: 'breathwork', offSale: false },
  organization: null,
};

function services() {
  return {
    subscription: {
      keepCurrentPlan: vi.fn().mockResolvedValue(undefined),
      getSubscription: vi.fn().mockResolvedValue({
        id: 'sub-row',
        heldAmountCents: null,
        pendingTierChange: null,
      }),
    },
    courseSubscription: {
      listForUser: vi.fn().mockResolvedValue({
        items: [CARD],
        pagination: { page: 2, limit: 5, total: 6, totalPages: 2 },
      }),
      cancelForUser: vi.fn().mockResolvedValue(CARD),
      reactivateForUser: vi
        .fn()
        .mockResolvedValue({ ...CARD, status: 'active' }),
    },
  };
}

function buildApp(user: { id: string } | null = { id: USER_ID }) {
  const mocks = services();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('__testUser', user);
    c.set('__testServices', mocks);
    await next();
  });
  (app as unknown as { route: (path: string, r: unknown) => void }).route(
    '/subscriptions',
    subscriptions
  );
  return { app, mocks };
}

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  served.policy = undefined;
});

// ─── POST /subscriptions/keep-current-plan ────────────────────────────────────

describe('POST /subscriptions/keep-current-plan', () => {
  it('keeps the plan for the caller and answers with their subscription', async () => {
    const { app, mocks } = buildApp();

    const res = await app.request(
      post('/subscriptions/keep-current-plan', { organizationId: ORG_ID })
    );

    expect(res.status).toBe(200);
    expect(mocks.subscription.keepCurrentPlan).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID
    );
    expect(mocks.subscription.getSubscription).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID
    );
    expect(await res.json()).toEqual({
      data: { id: 'sub-row', heldAmountCents: null, pendingTierChange: null },
    });
    // A Stripe write: the strict preset, as change-tier and its preview.
    expect(served.policy).toEqual({ auth: 'required', rateLimit: 'strict' });
  });

  it('no session: 401, the service untouched', async () => {
    const { app, mocks } = buildApp(null);

    const res = await app.request(
      post('/subscriptions/keep-current-plan', { organizationId: ORG_ID })
    );

    expect(res.status).toBe(401);
    expect(mocks.subscription.keepCurrentPlan).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['an organisation that is not a uuid', { organizationId: 'hollow-oak' }],
  ])('%s: 400, the service untouched', async (_, body) => {
    const { app, mocks } = buildApp();

    const res = await app.request(
      post('/subscriptions/keep-current-plan', body)
    );

    expect(res.status).toBe(400);
    expect(mocks.subscription.keepCurrentPlan).not.toHaveBeenCalled();
  });

  it('after the renewal it lands on: 409 with details.code MOVE_ALREADY_LANDED', async () => {
    const { app, mocks } = buildApp();
    mocks.subscription.keepCurrentPlan.mockRejectedValueOnce(
      new ConflictError('Your plan change has already happened', {
        code: 'MOVE_ALREADY_LANDED',
        organizationId: ORG_ID,
      })
    );

    const res = await app.request(
      post('/subscriptions/keep-current-plan', { organizationId: ORG_ID })
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { details?: { code?: string } };
    };
    expect(body.error.details?.code).toBe('MOVE_ALREADY_LANDED');
  });
});

// ─── GET /subscriptions/courses/mine ──────────────────────────────────────────

describe('GET /subscriptions/courses/mine', () => {
  it("lists the caller's course subscriptions in the list envelope, the page and limit passed on", async () => {
    const { app, mocks } = buildApp();

    const res = await app.request(
      'http://localhost/subscriptions/courses/mine?page=2&limit=5'
    );

    expect(res.status).toBe(200);
    expect(mocks.courseSubscription.listForUser).toHaveBeenCalledWith(USER_ID, {
      page: 2,
      limit: 5,
    });
    expect(await res.json()).toEqual({
      items: [CARD],
      pagination: { page: 2, limit: 5, total: 6, totalPages: 2 },
    });
    expect(served.policy).toEqual({ auth: 'required' });
  });

  it('no session: 401', async () => {
    const { app, mocks } = buildApp(null);

    const res = await app.request(
      'http://localhost/subscriptions/courses/mine'
    );

    expect(res.status).toBe(401);
    expect(mocks.courseSubscription.listForUser).not.toHaveBeenCalled();
  });

  it('a page below 1: 400', async () => {
    const { app, mocks } = buildApp();

    const res = await app.request(
      'http://localhost/subscriptions/courses/mine?page=0'
    );

    expect(res.status).toBe(400);
    expect(mocks.courseSubscription.listForUser).not.toHaveBeenCalled();
  });
});

// ─── POST /subscriptions/courses/:id/cancel and /reactivate ───────────────────

describe.each([
  ['cancel', 'cancelForUser'],
  ['reactivate', 'reactivateForUser'],
] as const)('POST /subscriptions/courses/:courseSubscriptionId/%s', (action, method) => {
  const path = `/subscriptions/courses/${COURSE_SUB_ID}/${action}`;

  it('acts for the caller on that course subscription and answers with its card', async () => {
    const { app, mocks } = buildApp();

    const res = await app.request(post(path));

    expect(res.status).toBe(200);
    expect(mocks.courseSubscription[method]).toHaveBeenCalledWith(
      USER_ID,
      COURSE_SUB_ID
    );
    expect(((await res.json()) as { data: { id: string } }).data.id).toBe(
      COURSE_SUB_ID
    );
    // A Stripe write per toggle: the strict preset, as keep-current-plan.
    expect(served.policy).toEqual({ auth: 'required', rateLimit: 'strict' });
  });

  it('no session: 401', async () => {
    const { app, mocks } = buildApp(null);

    const res = await app.request(post(path));

    expect(res.status).toBe(401);
    expect(mocks.courseSubscription[method]).not.toHaveBeenCalled();
  });

  it('an id that is not a uuid: 400', async () => {
    const { app, mocks } = buildApp();

    const res = await app.request(
      post(`/subscriptions/courses/sub_1Abc/${action}`)
    );

    expect(res.status).toBe(400);
    expect(mocks.courseSubscription[method]).not.toHaveBeenCalled();
  });

  it("another user's: 404 COURSE_SUBSCRIPTION_NOT_FOUND", async () => {
    const { app, mocks } = buildApp();
    mocks.courseSubscription[method].mockRejectedValueOnce(
      new NotFoundError('Course subscription not found', {
        code: 'COURSE_SUBSCRIPTION_NOT_FOUND',
        courseSubscriptionId: COURSE_SUB_ID,
      })
    );

    const res = await app.request(post(path));

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { details?: { code?: string } };
    };
    expect(body.error.details?.code).toBe('COURSE_SUBSCRIPTION_NOT_FOUND');
  });
});

it('reactivate off sale: 409 with details.code COURSE_NOT_ON_SALE', async () => {
  const { app, mocks } = buildApp();
  mocks.courseSubscription.reactivateForUser.mockRejectedValueOnce(
    new ConflictError('This course is no longer offered', {
      code: 'COURSE_NOT_ON_SALE',
      courseSubscriptionId: COURSE_SUB_ID,
    })
  );

  const res = await app.request(
    post(`/subscriptions/courses/${COURSE_SUB_ID}/reactivate`)
  );

  expect(res.status).toBe(409);
  const body = (await res.json()) as {
    error: { details?: { code?: string } };
  };
  expect(body.error.details?.code).toBe('COURSE_NOT_ON_SALE');
});
