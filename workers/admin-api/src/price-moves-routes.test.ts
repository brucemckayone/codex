/**
 * Route → service contract for support's Queue › Price moves
 * (Codex-2hxff.85, .86; batch C1 Part B data design §3): the held moves and
 * stopped changes lists, Retry, Close and Restart.
 *
 * What this file pins:
 *   - the policy on every route: anonymous 401, a creator 403, the platform
 *     owner 200; every route is `cache: 'fresh'`, and the three POSTs read the
 *     `strict` preset;
 *   - Retry and Restart declare no body (a declared body is mandatory), and
 *     Close's body is validated before the service (a note is required);
 *   - who pressed is the session's user, never the client's;
 *   - the lists answer the list envelope, and the actions 200, not 201.
 *
 * Harness: a procedure() shim that applies the route's DECLARED policy, as in
 * support-routes.test.ts. The real procedure()'s 401 is pinned through SELF
 * in index.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Policy {
  auth?: string;
  cache?: string;
  rateLimit?: string;
}

interface ProcedureConfig {
  policy?: Policy;
  input?: { query?: unknown; params?: unknown; body?: unknown };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

type SafeParse = (v: unknown) => { success: boolean; data?: unknown };

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  services: {} as Record<string, unknown>,
  /** The policy and input parts the last request's route declared. */
  policy: undefined as Policy | undefined,
  declared: [] as string[],
}));

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
        };
        env: unknown;
        executionCtx: unknown;
        json: (body: unknown, status?: number) => Response;
        body: (body: null, status: number) => Response;
      }) => {
        state.policy = config.policy;
        state.declared = Object.keys(config.input ?? {}).sort();
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

        const input: Record<string, unknown> = {};
        for (const [part, read] of [
          ['query', () => c.req.query()],
          ['params', () => c.req.param()],
          ['body', () => c.req.json()],
        ] as const) {
          const schema = config.input?.[part];
          if (!schema) continue;
          const parsed = (schema as { safeParse: SafeParse }).safeParse(
            await read()
          );
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

const MOVE_ID = '823e4567-e89b-12d3-a456-426614174007';
const CHANGE_ID = '923e4567-e89b-12d3-a456-426614174008';
const PLATFORM_OWNER = { id: 'support_user', role: 'platform_owner' };
const PAGE = { page: 1, limit: 20, total: 1, totalPages: 1 };
const NEXT_RUN = '2026-11-04T11:00:00.000Z';
const QUEUED = { moveId: MOVE_ID, status: 'queued', queuedFor: NEXT_RUN };

function supportMock() {
  return {
    listHeldPriceMoves: vi.fn().mockResolvedValue({
      items: [{ moveId: MOVE_ID }],
      pagination: PAGE,
    }),
    listStoppedPriceChanges: vi.fn().mockResolvedValue({
      items: [{ changeId: CHANGE_ID }],
      pagination: PAGE,
    }),
    retryPriceMove: vi
      .fn()
      .mockResolvedValue({ move: QUEUED, nextRunAt: NEXT_RUN }),
    closePriceMove: vi
      .fn()
      .mockResolvedValue({ moveId: MOVE_ID, status: 'closed' }),
    restartPriceChange: vi.fn().mockResolvedValue({
      change: { changeId: CHANGE_ID },
      nextRunAt: NEXT_RUN,
    }),
  };
}

let support: ReturnType<typeof supportMock>;

beforeEach(() => {
  support = supportMock();
  state.user = PLATFORM_OWNER;
  state.services = { support };
  state.policy = undefined;
  state.declared = [];
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

const RETRY = `/api/admin/support/price-moves/${MOVE_ID}/retry`;
const CLOSE = `/api/admin/support/price-moves/${MOVE_ID}/close`;
const RESTART = `/api/admin/support/price-changes/${CHANGE_ID}/restart`;
const CLOSE_BODY = { resolution: 'not_needed', note: 'Leah cancelled Pro' };

const READ = { auth: 'platform_owner', cache: 'fresh' };
const WRITE = { ...READ, rateLimit: 'strict' };

const routes = [
  {
    name: 'held price moves',
    method: 'GET' as const,
    path: '/api/admin/support/queue/price-moves',
    policy: READ,
    declared: ['query'],
    called: () => support.listHeldPriceMoves,
  },
  {
    name: 'stopped price changes',
    method: 'GET' as const,
    path: '/api/admin/support/queue/price-changes-stopped',
    policy: READ,
    declared: ['query'],
    called: () => support.listStoppedPriceChanges,
  },
  {
    name: 'retry',
    method: 'POST' as const,
    path: RETRY,
    policy: WRITE,
    declared: ['params'],
    called: () => support.retryPriceMove,
  },
  {
    name: 'close',
    method: 'POST' as const,
    path: CLOSE,
    body: CLOSE_BODY,
    policy: WRITE,
    declared: ['body', 'params'],
    called: () => support.closePriceMove,
  },
  {
    name: 'restart',
    method: 'POST' as const,
    path: RESTART,
    policy: WRITE,
    declared: ['params'],
    called: () => support.restartPriceChange,
  },
];

describe('the policy on every price-move route', () => {
  it.each(
    routes
  )('$name: anonymous 401, creator 403, platform owner 200', async (route) => {
    state.user = null;
    expect((await call(route.method, route.path, route.body)).status).toBe(401);
    state.user = { id: 'org_owner_user', role: 'creator' };
    expect((await call(route.method, route.path, route.body)).status).toBe(403);
    expect(route.called()).not.toHaveBeenCalled();

    state.user = PLATFORM_OWNER;
    expect((await call(route.method, route.path, route.body)).status).toBe(200);
    expect(route.called()).toHaveBeenCalledTimes(1);
  });

  it.each(
    routes
  )('$name: declares its policy and its input parts exactly', async (route) => {
    await call(route.method, route.path, route.body);
    expect(state.policy).toEqual(route.policy);
    expect(state.declared).toEqual(route.declared);
  });
});

describe('Queue › Price moves', () => {
  it('the lists answer the list envelope, with the validated page', async () => {
    const res = await call(
      'GET',
      '/api/admin/support/queue/price-moves?page=2&limit=10'
    );
    expect(await res.json()).toEqual({
      items: [{ moveId: MOVE_ID }],
      pagination: PAGE,
    });
    expect(support.listHeldPriceMoves).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
    });
    expect(
      (await call('GET', '/api/admin/support/queue/price-changes-stopped'))
        .status
    ).toBe(200);
    expect(support.listStoppedPriceChanges).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
  });

  it('refuses a page of more than 50 with 400, before the service', async () => {
    expect(
      (await call('GET', '/api/admin/support/queue/price-moves?limit=51'))
        .status
    ).toBe(400);
    expect(support.listHeldPriceMoves).not.toHaveBeenCalled();
  });

  it('Retry takes no body, names who pressed, and answers { move, nextRunAt } with 200', async () => {
    const res = await call('POST', RETRY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { move: QUEUED, nextRunAt: NEXT_RUN },
    });
    expect(support.retryPriceMove).toHaveBeenCalledWith(
      MOVE_ID,
      PLATFORM_OWNER.id
    );
  });

  it('Restart takes no body, names who pressed, and answers { change, nextRunAt }', async () => {
    const res = await call('POST', RESTART);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { change: { changeId: CHANGE_ID }, nextRunAt: NEXT_RUN },
    });
    expect(support.restartPriceChange).toHaveBeenCalledWith(
      CHANGE_ID,
      PLATFORM_OWNER.id
    );
  });

  it('Close passes the trimmed note, its resolution and who closed it', async () => {
    const res = await call('POST', CLOSE, {
      resolution: 'moved_by_hand',
      note: '  Phoned, then moved in Stripe  ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { moveId: MOVE_ID, status: 'closed' },
    });
    expect(support.closePriceMove).toHaveBeenCalledWith(
      MOVE_ID,
      { resolution: 'moved_by_hand', note: 'Phoned, then moved in Stripe' },
      PLATFORM_OWNER.id
    );
  });

  it.each([
    ['no note', { resolution: 'not_needed' }],
    ['a blank note', { resolution: 'not_needed', note: '   ' }],
    ['the run’s own resolution', { resolution: 'retried_ok', note: 'Ok' }],
    ['another field', { ...CLOSE_BODY, resolvedByUserId: 'someone_else' }],
  ])('Close refuses %s with 400, before the service', async (_label, body) => {
    expect((await call('POST', CLOSE, body)).status).toBe(400);
    expect(support.closePriceMove).not.toHaveBeenCalled();
  });

  it.each([
    ['Retry', '/api/admin/support/price-moves/not-a-uuid/retry'],
    ['Restart', '/api/admin/support/price-changes/not-a-uuid/restart'],
  ])('%s refuses an id that is not one', async (_label, path) => {
    expect((await call('POST', path)).status).toBe(400);
    expect(support.retryPriceMove).not.toHaveBeenCalled();
    expect(support.restartPriceChange).not.toHaveBeenCalled();
  });

  it('a 409 from the service passes through', async () => {
    support.retryPriceMove.mockRejectedValueOnce(
      Object.assign(new Error('not held'), {
        statusCode: 409,
        code: 'CONFLICT',
      })
    );
    expect((await call('POST', RETRY)).status).toBe(409);
  });
});
