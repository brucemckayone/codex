/**
 * Route-layer HTTP-boundary tests for the studio Sales ledger endpoints
 * (Codex-1csms / Codex-5q0i4).
 *
 * What this file pins:
 *   - GET /sales         requires auth + requireOrgManagement
 *   - GET /sales/stats   requires auth + requireOrgManagement
 *   - Both forward `ctx.organizationId` to the service, NEVER
 *     `query.organizationId` — a client-supplied org id cannot redirect
 *     the query to another org's ledger.
 *   - /sales response envelope is `{ items, pagination }` via PaginatedResult.
 *   - /sales/stats response envelope is `{ data }`.
 *   - Service-layer errors propagate through `mapErrorToResponse`.
 *
 * Harness mirrors the procedure() shim from
 * `subscriptions-mgmt-routes.test.ts`. Only the service mock differs
 * (purchase, not subscription).
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codex/purchase', async () => {
  return {
    PurchaseService: vi.fn(),
    // Other symbols re-exported from this package are not pulled in by the
    // sales route file; if a future change adds one, vitest will surface an
    // undefined import here.
  };
});

interface ProcedureConfig {
  policy?: { auth?: string; requireOrgManagement?: boolean };
  input?: {
    body?: { safeParse: (v: unknown) => unknown };
    query?: { safeParse: (v: unknown) => unknown };
  };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: {
          json: () => Promise<unknown>;
          query: () => Record<string, string>;
        };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
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

        const orgRole = c.get('__testOrgRole') as string | undefined;
        const orgId = c.get('__testOrganizationId') as string | undefined;
        if (config.policy?.requireOrgManagement) {
          if (!orgId) {
            return c.json(
              {
                error: {
                  code: 'ORG_CONTEXT_REQUIRED',
                  message: 'Org context required',
                },
              },
              400
            );
          }
          if (orgRole !== 'owner' && orgRole !== 'admin') {
            return c.json(
              {
                error: {
                  code: 'FORBIDDEN',
                  message: 'Org management required',
                },
              },
              403
            );
          }
        }

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

        const services = c.get('__testServices');
        const ctx = {
          user: testUser,
          input: { body: {}, query },
          services,
          organizationId: orgId,
          organizationRole: orgRole,
        };

        try {
          const result = await config.handler(ctx);
          if (
            result instanceof actual.PaginatedResult ||
            (result &&
              typeof result === 'object' &&
              'items' in (result as object) &&
              'pagination' in (result as object))
          ) {
            const r = result as { items: unknown; pagination: unknown };
            return c.json(
              { items: r.items, pagination: r.pagination },
              (config.successStatus ?? 200) as 200 | 201
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
            statusCode as 400 | 401 | 403 | 404 | 409 | 500
          );
        }
      };
    },
  };
});

import { NotFoundError } from '@codex/service-errors';
import { Hono } from 'hono';
import sales from '../sales';

interface PurchaseServiceMock {
  listSales: ReturnType<typeof vi.fn>;
  getSalesStats: ReturnType<typeof vi.fn>;
}

function createPurchaseServiceMock(): PurchaseServiceMock {
  return {
    listSales: vi.fn().mockResolvedValue({
      items: [{ id: 'sale_a', amountPaidCents: 1000 }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
    getSalesStats: vi.fn().mockResolvedValue({
      grossCents: 4000,
      netCents: 2700,
      refundedCents: 500,
      count: 3,
      currency: 'gbp',
    }),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: { purchase: PurchaseServiceMock };
  orgRole?: 'owner' | 'admin' | 'member' | undefined;
  organizationId?: string | undefined;
}

function buildApp(args: BuildAppArgs = {}) {
  const services = args.services ?? { purchase: createPurchaseServiceMock() };
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('__testUser', args.user === undefined ? { id: 'user_1' } : args.user);
    c.set('__testServices', services);
    c.set('__testOrgRole', args.orgRole === undefined ? 'owner' : args.orgRole);
    c.set(
      '__testOrganizationId',
      args.organizationId === undefined ? MANAGED_ORG_ID : args.organizationId
    );
    await next();
  });
  (app as unknown as { route: (path: string, r: unknown) => void }).route(
    '/sales',
    sales
  );
  return { app, services };
}

function getReq(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const MANAGED_ORG_ID = '323e4567-e89b-12d3-a456-426614174002';
const ROGUE_ORG_ID = '999e4567-e89b-12d3-a456-426614174999';

describe('GET /sales — route → service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner GET → 200, listSales called with ctx.organizationId', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/sales?page=1&limit=20'));
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      items: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(payload.items[0]!.id).toBe('sale_a');
    expect(payload.pagination.total).toBe(1);

    expect(services.purchase.listSales).toHaveBeenCalledTimes(1);
    const [orgArg] = services.purchase.listSales.mock.calls[0]!;
    expect(orgArg).toBe(MANAGED_ORG_ID);
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(getReq('/sales'));
    expect(res.status).toBe(401);
    expect(services.purchase.listSales).not.toHaveBeenCalled();
  });

  it('negative role: member on the org → 403, service NOT called', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ orgRole: 'member', services });
    const res = await bundle.app.request(getReq('/sales'));
    expect(res.status).toBe(403);
    expect(services.purchase.listSales).not.toHaveBeenCalled();
  });

  it('cross-org safety: client query.organizationId is ignored — ctx.organizationId wins', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ services });
    // Client sends a different org id in the query; the route MUST forward
    // `ctx.organizationId` (resolved from membership) to the service.
    const res = await bundle.app.request(
      getReq(`/sales?organizationId=${ROGUE_ORG_ID}`)
    );
    expect(res.status).toBe(200);
    const [orgArg] = services.purchase.listSales.mock.calls[0]!;
    expect(orgArg).toBe(MANAGED_ORG_ID);
    expect(orgArg).not.toBe(ROGUE_ORG_ID);
  });

  it('service-layer NotFoundError → 404 with redacted body', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    services.purchase.listSales.mockRejectedValueOnce(
      new NotFoundError('Org missing')
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/sales'));
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBeTruthy();
  });
});

describe('GET /sales/stats — route → service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner GET → 200, getSalesStats called with ctx.organizationId', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/sales/stats'));
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: { grossCents: number; netCents: number; refundedCents: number };
    };
    expect(payload.data.grossCents).toBe(4000);
    expect(payload.data.netCents).toBe(2700);

    const [orgArg] = services.purchase.getSalesStats.mock.calls[0]!;
    expect(orgArg).toBe(MANAGED_ORG_ID);
  });

  it('negative role: admin gets 200 (admins allowed at worker layer; UI gates owner-only)', async () => {
    // This pins the existing pattern: requireOrgManagement = owner OR admin.
    // The /studio/sales page applies the stricter owner-only gate via
    // $effect redirect (defence in depth).
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ orgRole: 'admin', services });
    const res = await bundle.app.request(getReq('/sales/stats'));
    expect(res.status).toBe(200);
  });

  it('negative role: member → 403', async () => {
    const services = { purchase: createPurchaseServiceMock() };
    const bundle = buildApp({ orgRole: 'member', services });
    const res = await bundle.app.request(getReq('/sales/stats'));
    expect(res.status).toBe(403);
    expect(services.purchase.getSalesStats).not.toHaveBeenCalled();
  });
});
