/**
 * Route → service contract for dated fee changes (Codex-2hxff.33; batch C1
 * Part B data design §3): support's Fee notices (two lists and the
 * told-another-way mark), the platform owner's cancel, and the fee writes
 * that now answer with the `change` they made.
 *
 * What this file pins:
 *   - the policy on every route: anonymous 401, a creator 403, the platform
 *     owner 200; support's routes are `cache: 'fresh'`; the two POSTs read
 *     the `strict` preset;
 *   - inputs are validated before any service call (a note is required);
 *   - the mark invalidates the fee cache for the change's level, and its
 *     answer is `{ notice, change }`;
 *   - a removal answers 200 with its `change`, not 204: taking a lower fee
 *     away is a rise, and the caller needs to know it waits.
 *
 * Harness: a procedure() shim that applies the route's DECLARED policy, as
 * in support-routes.test.ts. The real procedure()'s 401 is pinned through
 * SELF in index.test.ts.
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
  policy: undefined as Policy | undefined,
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

const ORG = '11111111-1111-4111-8111-111111111111';
const CREATOR = 'user-maya';
const CHANGE_ID = '823e4567-e89b-12d3-a456-426614174007';
const NOTICE_ID = '923e4567-e89b-12d3-a456-426614174008';
const PLATFORM_OWNER = { id: 'support_user', role: 'platform_owner' };
const PAGE = { page: 1, limit: 20, total: 1, totalPages: 1 };
const LEVEL = { scope: 'org', organizationId: ORG };
const CHANGE = {
  id: CHANGE_ID,
  scope: 'org',
  organizationId: ORG,
  creatorId: null,
  kind: 'rise',
  effectiveFrom: null,
  firstRunAt: null,
  voidedAt: null,
  voidReason: null,
  replacesChangeId: null,
};
const MARKED = {
  notice: {
    noticeId: NOTICE_ID,
    state: 'told_another_way',
    toldAt: '2026-11-04T10:42:00.000Z',
    toldBy: PLATFORM_OWNER.id,
    note: 'Phoned Jonah',
  },
  change: {
    changeId: CHANGE_ID,
    effectiveFrom: '2026-12-05T00:00:00.000Z',
    waitingFor: 0,
  },
};
const written = (change: unknown) => ({
  outcome: 'rise',
  change,
  voidedChangeId: null,
  firstEmailsAt: '2026-11-03T08:00:00.000Z',
});

function supportMock() {
  return {
    listFeeChanges: vi.fn().mockResolvedValue({
      items: [{ changeId: CHANGE_ID }],
      pagination: PAGE,
    }),
    listFeeNotices: vi.fn().mockResolvedValue({
      items: [{ noticeId: NOTICE_ID }],
      pagination: PAGE,
    }),
    markToldAnotherWay: vi
      .fn()
      .mockResolvedValue({ result: MARKED, level: LEVEL }),
  };
}

function feeConfigMock() {
  return {
    cancelChange: vi.fn().mockResolvedValue({
      ...CHANGE,
      voidedAt: '2026-11-04T10:40:00.000Z',
      voidReason: 'cancelled',
    }),
    invalidateLevel: vi.fn(),
    updatePlatformFees: vi.fn().mockResolvedValue(written(CHANGE)),
    getPlatformRow: vi.fn().mockResolvedValue({ platformFeePercent: 1000 }),
    updateOrgFees: vi.fn().mockResolvedValue(written(CHANGE)),
    deleteOrgFees: vi.fn().mockResolvedValue(written(CHANGE)),
    getOrgRow: vi.fn().mockResolvedValue({ orgFeePercent: 500 }),
    upsertCreatorOverride: vi
      .fn()
      .mockResolvedValue({ ...written(null), outcome: 'unchanged' }),
    deleteCreatorOverride: vi.fn().mockResolvedValue(written(CHANGE)),
    getCreatorOverrideRow: vi.fn().mockResolvedValue(null),
  };
}

let support: ReturnType<typeof supportMock>;
let feeConfig: ReturnType<typeof feeConfigMock>;

beforeEach(() => {
  support = supportMock();
  feeConfig = feeConfigMock();
  state.user = PLATFORM_OWNER;
  state.services = { support, feeConfig };
  state.policy = undefined;
});

const testEnv = { ENVIRONMENT: 'test', CACHE_KV: {} };
const executionCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
) {
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

const MARK = `/api/admin/support/fee-notices/${NOTICE_ID}/told-another-way`;
const CANCEL = `/api/admin/fees/changes/${CHANGE_ID}/cancel`;

const routes = [
  {
    name: 'fee changes',
    method: 'GET' as const,
    path: '/api/admin/support/queue/fee-changes',
    policy: { auth: 'platform_owner', cache: 'fresh' },
    called: () => support.listFeeChanges,
  },
  {
    name: 'fee notices',
    method: 'GET' as const,
    path: '/api/admin/support/queue/fee-notices',
    policy: { auth: 'platform_owner', cache: 'fresh' },
    called: () => support.listFeeNotices,
  },
  {
    name: 'told another way',
    method: 'POST' as const,
    path: MARK,
    body: { note: 'Phoned Jonah' },
    policy: { auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' },
    called: () => support.markToldAnotherWay,
  },
  {
    name: 'cancel a fee change',
    method: 'POST' as const,
    path: CANCEL,
    policy: { auth: 'platform_owner', rateLimit: 'strict' },
    called: () => feeConfig.cancelChange,
  },
];

describe('the policy on every new fee route', () => {
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

  it.each(routes)('$name: declares its policy exactly', async (route) => {
    await call(route.method, route.path, route.body);
    expect(state.policy).toEqual(route.policy);
  });
});

describe('Queue › Fee notices', () => {
  it('the lists answer the list envelope, with the validated page', async () => {
    const res = await call(
      'GET',
      '/api/admin/support/queue/fee-notices?page=2&limit=10'
    );
    expect(await res.json()).toEqual({
      items: [{ noticeId: NOTICE_ID }],
      pagination: PAGE,
    });
    expect(support.listFeeNotices).toHaveBeenCalledWith({ page: 2, limit: 10 });
  });

  it('marking passes the trimmed note and who marked, invalidates the level, and answers { notice, change }', async () => {
    const res = await call('POST', MARK, { note: '  Phoned Jonah  ' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: MARKED });
    expect(support.markToldAnotherWay).toHaveBeenCalledWith(
      NOTICE_ID,
      { note: 'Phoned Jonah' },
      PLATFORM_OWNER.id
    );
    expect(feeConfig.invalidateLevel).toHaveBeenCalledWith(LEVEL);
  });

  it.each([
    ['no note', {}],
    ['a blank note', { note: '   ' }],
    ['a note over 500 characters', { note: 'x'.repeat(501) }],
    ['another field', { note: 'Phoned', toldAt: '2026-11-01T00:00:00Z' }],
  ])('refuses %s with 400, before the service', async (_label, body) => {
    expect((await call('POST', MARK, body)).status).toBe(400);
    expect(support.markToldAnotherWay).not.toHaveBeenCalled();
    expect(feeConfig.invalidateLevel).not.toHaveBeenCalled();
  });

  it('refuses a notice id that is not one', async () => {
    const res = await call(
      'POST',
      '/api/admin/support/fee-notices/not-a-uuid/told-another-way',
      { note: 'Phoned' }
    );
    expect(res.status).toBe(400);
    expect(support.markToldAnotherWay).not.toHaveBeenCalled();
  });

  it("a 409 from the mark passes through, and the cache isn't touched", async () => {
    support.markToldAnotherWay.mockRejectedValueOnce(
      Object.assign(new Error('already told'), {
        statusCode: 409,
        code: 'CONFLICT',
      })
    );
    expect((await call('POST', MARK, { note: 'Phoned' })).status).toBe(409);
    expect(feeConfig.invalidateLevel).not.toHaveBeenCalled();
  });
});

describe('the fee writes', () => {
  it('cancel passes the change and who cancelled, and answers the change', async () => {
    const res = await call('POST', CANCEL);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toMatchObject({
      id: CHANGE_ID,
      voidReason: 'cancelled',
    });
    expect(feeConfig.cancelChange).toHaveBeenCalledWith(
      CHANGE_ID,
      PLATFORM_OWNER.id
    );
    expect(
      (await call('POST', '/api/admin/fees/changes/x/cancel')).status
    ).toBe(400);
  });

  it('a platform or organisation write answers the row and its change', async () => {
    const platform = await call('PATCH', '/api/admin/fees/platform', {
      platformFeePercent: 1200,
    });
    expect(await platform.json()).toEqual({
      data: { config: { platformFeePercent: 1000 }, change: CHANGE },
    });
    const org = await call('PATCH', `/api/admin/fees/org/${ORG}`, {
      orgFeePercent: 1500,
    });
    expect(await org.json()).toEqual({
      data: { config: { orgFeePercent: 500 }, change: CHANGE },
    });
  });

  it('a write that changed nothing answers change: null', async () => {
    const res = await call(
      'PUT',
      `/api/admin/fees/org/${ORG}/creator/${CREATOR}`,
      { orgFeePercent: 0 }
    );
    expect(await res.json()).toEqual({
      data: { override: null, change: null },
    });
  });

  it('a removal answers 200 with its change, not 204: taking a lower fee away waits', async () => {
    const org = await call('DELETE', `/api/admin/fees/org/${ORG}`);
    expect(org.status).toBe(200);
    expect(await org.json()).toEqual({
      data: { config: { orgFeePercent: 500 }, change: CHANGE },
    });
    expect(feeConfig.deleteOrgFees).toHaveBeenCalledWith(
      ORG,
      PLATFORM_OWNER.id
    );

    const override = await call(
      'DELETE',
      `/api/admin/fees/org/${ORG}/creator/${CREATOR}`
    );
    expect(override.status).toBe(200);
    expect(await override.json()).toEqual({
      data: { override: null, change: CHANGE },
    });
  });
});
