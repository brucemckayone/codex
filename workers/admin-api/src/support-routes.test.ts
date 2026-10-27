/**
 * Route → service contract for support refunds (Codex-2hxff.28; data design
 * §1, §10): the nine `/api/admin/support/*` routes.
 *
 * What this file pins:
 *   - the policy matrix on every route: anonymous 401, a creator 403, an
 *     organisation owner 403 (org management is not platform support), the
 *     platform owner 200;
 *   - every route declares `cache: 'fresh'`, reads the default `api` preset
 *     and writes the `strict` one;
 *   - inputs are validated by the route's schemas before any service call;
 *   - the refund route answers 200, not 201: a repeat creates nothing;
 *   - lists are the `{ items, pagination }` envelope;
 *   - settling a failed refund that gave access back bumps the buyer's library
 *     and clears their streaming block; one that did not touches neither.
 *
 * Harness: a procedure() shim that applies the route's DECLARED policy, as in
 * customer-grants-routes.test.ts, so a 403 here proves the route asks for the
 * platform owner. The real procedure()'s 401 is pinned through SELF in
 * index.test.ts, and the real role gate in @codex/worker-utils.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Policy {
  auth?: string;
  cache?: string;
  rateLimit?: string;
  requireOrgMembership?: boolean;
  requireOrgManagement?: boolean;
}

interface ProcedureConfig {
  policy?: Policy;
  input?: {
    query?: unknown;
    params?: unknown;
    body?: unknown;
  };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

type SafeParse = (v: unknown) => {
  success: boolean;
  data?: unknown;
};

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  services: {} as Record<string, unknown>,
  /** The policy the last request's route declared. */
  policy: undefined as Policy | undefined,
  invalidateUserLibrary: (() => undefined) as (args: unknown) => void,
  clearRevocation: (() => Promise.resolve()) as (
    userId: string,
    orgId: string
  ) => Promise<void>,
}));

vi.mock('@codex/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/cache')>();
  return {
    ...actual,
    invalidateUserLibrary: (args: unknown) => state.invalidateUserLibrary(args),
  };
});

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    AccessRevocation: class {
      clear(userId: string, orgId: string) {
        return state.clearRevocation(userId, orgId);
      }
    },
  };
});

vi.mock('@codex/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/security')>();
  return {
    ...actual,
    rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: {
          query: () => Record<string, string>;
          param: () => Record<string, string>;
          json: () => Promise<unknown>;
          method: string;
        };
        env: unknown;
        executionCtx: unknown;
        json: (body: unknown, status?: number) => Response;
        body: (body: null, status: number) => Response;
      }) => {
        state.policy = config.policy;
        const fail = (status: number, code: string) =>
          c.json({ error: { code, message: code } }, status);

        const auth = config.policy?.auth ?? 'required';
        if (auth !== 'none' && !state.user) return fail(401, 'UNAUTHORIZED');
        if (
          auth === 'platform_owner' &&
          state.user?.role !== 'platform_owner'
        ) {
          return fail(403, 'FORBIDDEN');
        }

        const parse = (schema: unknown, raw: unknown) =>
          (schema as { safeParse: SafeParse }).safeParse(raw);
        const input: Record<string, unknown> = {};
        for (const [part, read] of [
          ['query', () => c.req.query()],
          ['params', () => c.req.param()],
          ['body', () => c.req.json()],
        ] as const) {
          const schema = config.input?.[part];
          if (!schema) continue;
          const parsed = parse(schema, await read());
          if (!parsed.success) return fail(400, 'VALIDATION_ERROR');
          input[part] = parsed.data;
        }

        const ctx = {
          user: state.user,
          input,
          services: state.services,
          env: c.env,
          executionCtx: c.executionCtx,
          obs: undefined,
        };
        try {
          const result = await config.handler(ctx);
          if (config.successStatus === 204) return c.body(null, 204);
          if (result instanceof actual.PaginatedResult) {
            return c.json({
              items: result.items,
              pagination: result.pagination,
            });
          }
          return c.json({ data: result }, config.successStatus ?? 200);
        } catch (error) {
          const { statusCode = 500, code = 'INTERNAL_ERROR' } = error as {
            statusCode?: number;
            code?: string;
          };
          return fail(statusCode, code);
        }
      };
    },
  };
});

import app from './index';

const CHARGE = 'ch_3QiC9bLk2vAbCdEf';
const REFUND_ID = '523e4567-e89b-12d3-a456-426614174004';
const REVIEW_ID = '623e4567-e89b-12d3-a456-426614174005';
const PLATFORM_OWNER = { id: 'support_user', role: 'platform_owner' };
const PAGE = { page: 1, limit: 20, total: 1, totalPages: 1 };

function supportMock() {
  return {
    searchCharges: vi
      .fn()
      .mockResolvedValue({ items: [{ chargeId: CHARGE }], pagination: PAGE }),
    getChargeDetail: vi.fn().mockResolvedValue({ charge: { id: CHARGE } }),
    previewRefund: vi.fn().mockResolvedValue({ amountCents: 500 }),
    issueRefund: vi.fn().mockResolvedValue({
      refund: { id: 're_1', amountCents: 500, status: 'succeeded' },
      replayed: false,
    }),
    getQueueCounts: vi
      .fn()
      .mockResolvedValue({ failedRefunds: 2, creatorDebts: 3 }),
    listFailedRefunds: vi.fn().mockResolvedValue({
      items: [{ refundId: REFUND_ID }],
      pagination: PAGE,
    }),
    listCreatorDebts: vi.fn().mockResolvedValue({
      items: [{ reviewId: REVIEW_ID }],
      pagination: PAGE,
    }),
    resolveFailedRefund: vi.fn().mockResolvedValue({
      settled: { refundId: REFUND_ID, resolution: 'refunded_elsewhere' },
      restoredAccess: null,
    }),
    resolveCreatorDebt: vi.fn().mockResolvedValue({
      reviewId: REVIEW_ID,
      resolution: 'creator_absorbed',
    }),
  };
}

let support: ReturnType<typeof supportMock>;
let invalidateUserLibrary: ReturnType<typeof vi.fn>;
let clearRevocation: ReturnType<typeof vi.fn>;

beforeEach(() => {
  support = supportMock();
  invalidateUserLibrary = vi.fn();
  clearRevocation = vi.fn().mockResolvedValue(undefined);
  state.user = PLATFORM_OWNER;
  state.services = { support };
  state.policy = undefined;
  state.invalidateUserLibrary = invalidateUserLibrary;
  state.clearRevocation = clearRevocation;
});

const testEnv = { ENVIRONMENT: 'test', CACHE_KV: {} };
const executionCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  return app.request(
    `http://localhost${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    },
    testEnv,
    executionCtx as unknown as ExecutionContext
  );
}

interface Route {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  service: keyof ReturnType<typeof supportMock>;
  writes: boolean;
}

const routes: Route[] = [
  {
    name: 'search',
    method: 'GET',
    path: '/api/admin/support/charges?lookup=buyer@example.com',
    service: 'searchCharges',
    writes: false,
  },
  {
    name: 'charge detail',
    method: 'GET',
    path: `/api/admin/support/charges/${CHARGE}`,
    service: 'getChargeDetail',
    writes: false,
  },
  {
    name: 'refund preview',
    method: 'GET',
    path: `/api/admin/support/charges/${CHARGE}/refund-preview?amountCents=500`,
    service: 'previewRefund',
    writes: false,
  },
  {
    name: 'issue a refund',
    method: 'POST',
    path: `/api/admin/support/charges/${CHARGE}/refunds`,
    body: {
      amountCents: 500,
      reason: 'requested_by_customer',
      expectedRefundCount: 0,
    },
    service: 'issueRefund',
    writes: true,
  },
  {
    name: 'queue counts',
    method: 'GET',
    path: '/api/admin/support/queue/counts',
    service: 'getQueueCounts',
    writes: false,
  },
  {
    name: 'failed refunds',
    method: 'GET',
    path: '/api/admin/support/queue/failed-refunds',
    service: 'listFailedRefunds',
    writes: false,
  },
  {
    name: 'creator debts',
    method: 'GET',
    path: '/api/admin/support/queue/creator-debts',
    service: 'listCreatorDebts',
    writes: false,
  },
  {
    name: 'settle a failed refund',
    method: 'POST',
    path: `/api/admin/support/refunds/${REFUND_ID}/resolve`,
    body: { resolution: 'refunded_elsewhere', note: '' },
    service: 'resolveFailedRefund',
    writes: true,
  },
  {
    name: 'settle a creator debt',
    method: 'POST',
    path: `/api/admin/support/creator-debts/${REVIEW_ID}/resolve`,
    body: { resolution: 'creator_absorbed', note: '' },
    service: 'resolveCreatorDebt',
    writes: true,
  },
];

describe('the policy matrix, on every support route', () => {
  it.each(
    routes
  )('$name: anonymous 401, creator 403, organisation owner 403, platform owner 200', async (route) => {
    state.user = null;
    expect((await call(route.method, route.path, route.body)).status).toBe(401);
    state.user = { id: 'creator_user', role: 'creator' };
    expect((await call(route.method, route.path, route.body)).status).toBe(403);
    // An organisation's owner is a creator who owns an org: still not support.
    state.user = { id: 'org_owner_user', role: 'creator' };
    expect((await call(route.method, route.path, route.body)).status).toBe(403);
    expect(support[route.service]).not.toHaveBeenCalled();

    state.user = PLATFORM_OWNER;
    const res = await call(route.method, route.path, route.body);
    expect(res.status).toBe(200);
    expect(support[route.service]).toHaveBeenCalledTimes(1);
  });

  it.each(
    routes
  )('$name: declares platform_owner, no org policy, cache fresh, and its rate limit', async (route) => {
    await call(route.method, route.path, route.body);
    expect(state.policy).toEqual({
      auth: 'platform_owner',
      cache: 'fresh',
      ...(route.writes ? { rateLimit: 'strict' } : {}),
    });
  });
});

describe('the routes', () => {
  it('search passes the validated query and answers the list envelope', async () => {
    const res = await call(
      'GET',
      '/api/admin/support/charges?lookup=%20buyer@example.com%20&page=2&limit=10'
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ chargeId: CHARGE }],
      pagination: PAGE,
    });
    expect(support.searchCharges).toHaveBeenCalledWith({
      lookup: 'buyer@example.com',
      page: 2,
      limit: 10,
    });
  });

  it.each([
    ['a two-character search', '/api/admin/support/charges?lookup=ab'],
    [
      'a page of more than 50',
      '/api/admin/support/queue/failed-refunds?limit=51',
    ],
    ['a charge id that is not one', '/api/admin/support/charges/pi_123456789'],
    [
      'a preview of nothing',
      `/api/admin/support/charges/${CHARGE}/refund-preview?amountCents=0`,
    ],
  ])('refuses %s with 400, before the service', async (_label, path) => {
    expect((await call('GET', path)).status).toBe(400);
    expect(
      Object.values(support).every((fn) => fn.mock.calls.length === 0)
    ).toBe(true);
  });

  it('the refund route answers 200, not 201, and names who asked', async () => {
    const body = {
      amountCents: 500,
      reason: 'duplicate',
      expectedRefundCount: 1,
    };
    const res = await call(
      'POST',
      `/api/admin/support/charges/${CHARGE}/refunds`,
      body
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        refund: { id: 're_1', amountCents: 500, status: 'succeeded' },
        replayed: false,
      },
    });
    expect(support.issueRefund).toHaveBeenCalledWith(
      CHARGE,
      body,
      PLATFORM_OWNER.id
    );
  });

  it.each([
    [{ amountCents: 0, reason: 'duplicate', expectedRefundCount: 0 }],
    [
      {
        amountCents: 100,
        reason: 'expired_uncaptured_charge',
        expectedRefundCount: 0,
      },
    ],
    [{ amountCents: 100, reason: 'duplicate', expectedRefundCount: -1 }],
  ])('refuses a refund body of %o with 400', async (body) => {
    const res = await call(
      'POST',
      `/api/admin/support/charges/${CHARGE}/refunds`,
      body
    );
    expect(res.status).toBe(400);
    expect(support.issueRefund).not.toHaveBeenCalled();
  });

  it('settling refuses creators_repaid without a note, and dispute_won from the client', async () => {
    const repaid = await call(
      'POST',
      `/api/admin/support/refunds/${REFUND_ID}/resolve`,
      { resolution: 'creators_repaid', note: ' ' }
    );
    const won = await call(
      'POST',
      `/api/admin/support/creator-debts/${REVIEW_ID}/resolve`,
      { resolution: 'dispute_won', note: 'won it' }
    );
    const reversed = await call(
      'POST',
      `/api/admin/support/creator-debts/${REVIEW_ID}/resolve`,
      { resolution: 'manually_reversed' }
    );
    expect([repaid.status, won.status, reversed.status]).toEqual([
      400, 400, 400,
    ]);
    expect(support.resolveFailedRefund).not.toHaveBeenCalled();
    expect(support.resolveCreatorDebt).not.toHaveBeenCalled();
  });

  it('a settlement that gave access back bumps the buyer library and clears the streaming block', async () => {
    support.resolveFailedRefund.mockResolvedValueOnce({
      settled: {
        refundId: REFUND_ID,
        resolution: 'creators_repaid',
        accessRestored: true,
      },
      restoredAccess: {
        restored: true,
        userId: 'buyer_user',
        organizationId: 'org-1',
      },
    });
    const res = await call(
      'POST',
      `/api/admin/support/refunds/${REFUND_ID}/resolve`,
      { resolution: 'creators_repaid', note: 'Buyer keeps it' }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        refundId: REFUND_ID,
        resolution: 'creators_repaid',
        accessRestored: true,
      },
    });
    expect(support.resolveFailedRefund).toHaveBeenCalledWith(
      REFUND_ID,
      { resolution: 'creators_repaid', note: 'Buyer keeps it' },
      PLATFORM_OWNER.id
    );
    expect(invalidateUserLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'buyer_user' })
    );
    expect(clearRevocation).toHaveBeenCalledWith('buyer_user', 'org-1');
  });

  it('a settlement that gave nothing back touches no cache', async () => {
    await call('POST', `/api/admin/support/refunds/${REFUND_ID}/resolve`, {
      resolution: 'refunded_elsewhere',
    });
    expect(invalidateUserLibrary).not.toHaveBeenCalled();
    expect(clearRevocation).not.toHaveBeenCalled();
  });

  it("maps a service's typed error to its status", async () => {
    support.issueRefund.mockRejectedValueOnce(
      Object.assign(new Error('changed'), {
        statusCode: 412,
        code: 'PRECONDITION_FAILED',
      })
    );
    const res = await call(
      'POST',
      `/api/admin/support/charges/${CHARGE}/refunds`,
      { amountCents: 500, reason: 'duplicate', expectedRefundCount: 0 }
    );
    expect(res.status).toBe(412);
  });
});
