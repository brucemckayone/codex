/**
 * Route → service contract for support grants (Codex-2hxff.21):
 *
 *   POST   /api/admin/customers/:customerId/grant-access/:contentId
 *   GET    /api/admin/customers/:customerId/grants
 *   DELETE /api/admin/customers/:customerId/grants/:entitlementId
 *
 * What this file pins:
 *   - all three declare the grant route's policy: a session AND org
 *     management (owner/admin) — a member is 403, anonymous 401;
 *   - the acting user (`ctx.user.id`) is threaded through as the granter /
 *     revoker, and `ctx.organizationId` (never a client value) scopes them;
 *   - revoke is 204 with an empty body, and the list is the
 *     `{ items, pagination }` envelope with the contract's default limit 50;
 *   - a grant, and a revoke that changed something, bump the customer's
 *     library version; an already-revoked no-op does not.
 *
 * Harness: the procedure() shim from `ecom-api`'s route tests, which applies
 * the route's DECLARED policy, so a 403 here proves the route asks for org
 * management. The worker is the real `createWorker` app with the `/api/*` rate
 * limiter made a pass-through. The real procedure()'s 401 is pinned through
 * SELF in `index.test.ts`. A thrown service error is mapped by its own
 * `statusCode` / `code` (this worker does not depend on @codex/service-errors);
 * the real mapper is tested where it lives.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  policy?: {
    auth?: string;
    requireOrgMembership?: boolean;
    requireOrgManagement?: boolean;
  };
  input?: {
    query?: { safeParse: (v: unknown) => unknown };
    params?: { safeParse: (v: unknown) => unknown };
  };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

type SafeParse = (v: unknown) => {
  success: boolean;
  data?: unknown;
  error?: { issues: unknown };
};

const state = vi.hoisted(() => ({
  user: { id: 'support_user' } as { id: string } | null,
  organizationId: '323e4567-e89b-12d3-a456-426614174002' as string | undefined,
  orgRole: 'owner' as string | undefined,
  services: {} as Record<string, unknown>,
  invalidateUserLibrary: (() => undefined) as (args: unknown) => void,
}));

vi.mock('@codex/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/cache')>();
  return {
    ...actual,
    invalidateUserLibrary: (args: unknown) => state.invalidateUserLibrary(args),
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
        };
        env: unknown;
        executionCtx: unknown;
        json: (body: unknown, status?: number) => Response;
        body: (body: null, status: number) => Response;
      }) => {
        const fail = (status: number, code: string) =>
          c.json({ error: { code, message: code } }, status);

        if (config.policy?.auth === 'required' && !state.user) {
          return fail(401, 'UNAUTHORIZED');
        }
        const needsOrg =
          config.policy?.requireOrgMembership ||
          config.policy?.requireOrgManagement;
        if (needsOrg) {
          if (!state.organizationId) return fail(400, 'ORG_CONTEXT_REQUIRED');
          if (!state.orgRole) return fail(403, 'FORBIDDEN');
          if (
            config.policy?.requireOrgManagement &&
            state.orgRole !== 'owner' &&
            state.orgRole !== 'admin'
          ) {
            return fail(403, 'FORBIDDEN');
          }
        }

        const parse = (schema: unknown, raw: unknown) =>
          (schema as { safeParse: SafeParse }).safeParse(raw);
        let query: unknown = {};
        if (config.input?.query) {
          const parsed = parse(config.input.query, c.req.query());
          if (!parsed.success) return fail(400, 'VALIDATION_ERROR');
          query = parsed.data;
        }
        let params: unknown = {};
        if (config.input?.params) {
          const parsed = parse(config.input.params, c.req.param());
          if (!parsed.success) return fail(400, 'VALIDATION_ERROR');
          params = parsed.data;
        }

        const ctx = {
          user: state.user,
          input: { body: {}, query, params },
          services: state.services,
          organizationId: state.organizationId,
          organizationRole: state.orgRole,
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

const ORG_ID = '323e4567-e89b-12d3-a456-426614174002';
const ROGUE_ORG_ID = '999e4567-e89b-12d3-a456-426614174999';
const CUSTOMER_ID = 'customer123';
const CONTENT_ID = '423e4567-e89b-12d3-a456-426614174003';
const ENTITLEMENT_ID = '523e4567-e89b-12d3-a456-426614174004';

function adminCustomerMock() {
  return {
    grantContentAccess: vi.fn().mockResolvedValue(true),
    listCustomerGrants: vi.fn().mockResolvedValue({
      items: [{ id: ENTITLEMENT_ID, contentId: CONTENT_ID }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    }),
    revokeGrant: vi
      .fn()
      .mockResolvedValue({ contentId: CONTENT_ID, revoked: true }),
  };
}

let adminCustomer: ReturnType<typeof adminCustomerMock>;
let invalidateUserLibrary: ReturnType<typeof vi.fn>;

beforeEach(() => {
  adminCustomer = adminCustomerMock();
  invalidateUserLibrary = vi.fn();
  state.user = { id: 'support_user' };
  state.organizationId = ORG_ID;
  state.orgRole = 'owner';
  state.services = { adminCustomer };
  state.invalidateUserLibrary = invalidateUserLibrary;
});

const testEnv = { ENVIRONMENT: 'test', CACHE_KV: {} };
const executionCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
};

function call(method: 'GET' | 'POST' | 'DELETE', path: string) {
  return app.request(
    `http://localhost${path}`,
    { method },
    testEnv,
    executionCtx as unknown as ExecutionContext
  );
}

/** A service-layer 404, shaped as `NotFoundError` (statusCode + code). */
function notFound(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 404,
    code: 'NOT_FOUND',
  });
}

const grantPath = `/api/admin/customers/${CUSTOMER_ID}/grant-access/${CONTENT_ID}?organizationId=${ORG_ID}`;
const listPath = `/api/admin/customers/${CUSTOMER_ID}/grants?organizationId=${ORG_ID}`;
const revokePath = `/api/admin/customers/${CUSTOMER_ID}/grants/${ENTITLEMENT_ID}?organizationId=${ORG_ID}`;

describe('POST …/grant-access/:contentId', () => {
  it('grants as the acting user, in ctx.organizationId, and bumps the customer library', async () => {
    const res = await call('POST', grantPath);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true } });
    expect(adminCustomer.grantContentAccess).toHaveBeenCalledWith(
      ORG_ID,
      CUSTOMER_ID,
      CONTENT_ID,
      'support_user'
    );
    expect(invalidateUserLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CUSTOMER_ID })
    );
  });

  it('member → 403, nothing written', async () => {
    state.orgRole = 'member';
    const res = await call('POST', grantPath);
    expect(res.status).toBe(403);
    expect(adminCustomer.grantContentAccess).not.toHaveBeenCalled();
  });
});

describe('GET …/grants', () => {
  it('lists with the default limit 50 in the list envelope', async () => {
    const res = await call('GET', listPath);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(body.items.map((g) => g.id)).toEqual([ENTITLEMENT_ID]);
    expect(body.pagination.total).toBe(1);
    expect(adminCustomer.listCustomerGrants).toHaveBeenCalledWith(
      ORG_ID,
      CUSTOMER_ID,
      { page: 1, limit: 50 }
    );
  });

  it('scopes to ctx.organizationId, never a client-supplied org', async () => {
    const res = await call(
      'GET',
      `/api/admin/customers/${CUSTOMER_ID}/grants?organizationId=${ROGUE_ORG_ID}`
    );
    expect(res.status).toBe(200);
    expect(adminCustomer.listCustomerGrants.mock.calls[0]?.[0]).toBe(ORG_ID);
  });

  it('rejects a limit over 100', async () => {
    const res = await call('GET', `${listPath}&limit=101`);
    expect(res.status).toBe(400);
    expect(adminCustomer.listCustomerGrants).not.toHaveBeenCalled();
  });

  it('member → 403, anonymous → 401', async () => {
    state.orgRole = 'member';
    expect((await call('GET', listPath)).status).toBe(403);
    state.orgRole = 'owner';
    state.user = null;
    expect((await call('GET', listPath)).status).toBe(401);
    expect(adminCustomer.listCustomerGrants).not.toHaveBeenCalled();
  });
});

describe('DELETE …/grants/:entitlementId', () => {
  it('revokes as the acting user → 204 with no body, and bumps the customer library', async () => {
    const res = await call('DELETE', revokePath);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(adminCustomer.revokeGrant).toHaveBeenCalledWith(
      ORG_ID,
      CUSTOMER_ID,
      ENTITLEMENT_ID,
      'support_user'
    );
    expect(invalidateUserLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CUSTOMER_ID })
    );
  });

  it('already revoked → 204, and no cache bump for a no-op', async () => {
    adminCustomer.revokeGrant.mockResolvedValueOnce({
      contentId: CONTENT_ID,
      revoked: false,
    });
    const res = await call('DELETE', revokePath);
    expect(res.status).toBe(204);
    expect(invalidateUserLibrary).not.toHaveBeenCalled();
  });

  it('no such grant (wrong org, a purchase, unknown id) → 404', async () => {
    adminCustomer.revokeGrant.mockRejectedValueOnce(
      notFound('Grant not found')
    );
    const res = await call('DELETE', revokePath);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(invalidateUserLibrary).not.toHaveBeenCalled();
  });

  it('a non-uuid entitlement id → 400', async () => {
    const res = await call(
      'DELETE',
      `/api/admin/customers/${CUSTOMER_ID}/grants/not-a-uuid?organizationId=${ORG_ID}`
    );
    expect(res.status).toBe(400);
    expect(adminCustomer.revokeGrant).not.toHaveBeenCalled();
  });

  it('member → 403, anonymous → 401, nothing revoked', async () => {
    state.orgRole = 'member';
    expect((await call('DELETE', revokePath)).status).toBe(403);
    state.orgRole = 'owner';
    state.user = null;
    expect((await call('DELETE', revokePath)).status).toBe(401);
    expect(adminCustomer.revokeGrant).not.toHaveBeenCalled();
  });
});
