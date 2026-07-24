/**
 * Route-layer HTTP-boundary tests for the studio journey-insights endpoint
 * (Codex-2pryk · Round-D · Codex-776gg · WP-7).
 *
 * What this file pins:
 *   - GET /api/journeys/insights requires auth + requireOrgManagement
 *     (401 no session, 403 non-manager, 200 owner AND admin).
 *   - The handler forwards `ctx.organizationId` to the aggregation service,
 *     NEVER the client-supplied `query.organizationId` — a client cannot
 *     redirect the money query to another org's course (the money-scoping IDOR
 *     is the key risk this route guards).
 *   - Response envelope is `{ data }`.
 *   - Service-layer errors propagate through `mapErrorToResponse` — e.g. the
 *     cross-org course guard's `NotFoundError` → 404, no revenue leak.
 *
 * Harness mirrors the procedure() shim from `sales-routes.test.ts` (the sibling
 * requireOrgManagement studio route): the shim simulates the real policy phases
 * (auth → org-management → validation) so the route→service contract is tested
 * without a Neon-backed membership lookup. The aggregation service is mocked
 * (bd memory implement/tests-must-be-able-to-fail): every assertion is
 * unconditional — the auth/role tests fail if the policy is dropped, and the
 * cross-org test fails if the handler ever forwards `query.organizationId`.
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  policy?: { auth?: string; requireOrgManagement?: boolean };
  input?: {
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
        req: { query: () => Record<string, string> };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        const testUser = c.get('__testUser') as
          | { id: string }
          | null
          | undefined;
        if (config.policy?.auth === 'required' && !testUser) {
          return c.json(
            { error: { code: 'UNAUTHORIZED', message: 'Auth required' } },
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
              { error: { code: 'FORBIDDEN', message: 'Management required' } },
              403
            );
          }
        }

        let query: unknown = {};
        if (config.input?.query) {
          const parsed = (
            config.input.query as unknown as {
              safeParse: (v: unknown) => {
                success: boolean;
                data?: unknown;
                error?: { issues: unknown };
              };
            }
          ).safeParse(c.req.query());
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

        const ctx = {
          user: testUser,
          input: { query },
          services: c.get('__testServices'),
          organizationId: orgId,
          organizationRole: orgRole,
        };

        try {
          const result = await config.handler(ctx);
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
import journeyInsights from '../journey-insights';

const MANAGED_ORG_ID = '32300000-0000-4000-8000-000000000002';
const ROGUE_ORG_ID = '99900000-0000-4000-8000-000000000999';
const COURSE_ID = '2c000000-0000-4000-8000-000000000001';

const INSIGHTS_FIXTURE = {
  courseId: COURSE_ID,
  courseTitle: 'Rootwork',
  period: '30d' as const,
  financials: {
    revenueCents: { value: 12_000, previousValue: 9_000 },
    purchaseCount: { value: 4, previousValue: 3 },
    subscriptionCount: { value: 2, previousValue: 1 },
    revenueTrend: [{ date: '2026-07-01T00:00:00.000Z', value: 12_000 }],
  },
  engagement: {
    enrolledCount: { value: 10, previousValue: 6 },
    activeCount: { value: 5, previousValue: 4 },
    completedCount: { value: 2, previousValue: 1 },
  },
};

interface InsightsServiceMock {
  getInsights: ReturnType<typeof vi.fn>;
}

function createInsightsServiceMock(): InsightsServiceMock {
  return {
    getInsights: vi.fn().mockResolvedValue(INSIGHTS_FIXTURE),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: { courseInsights: InsightsServiceMock };
  orgRole?: 'owner' | 'admin' | 'member' | undefined;
  organizationId?: string | undefined;
}

function buildApp(args: BuildAppArgs = {}) {
  const services = args.services ?? {
    courseInsights: createInsightsServiceMock(),
  };
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
    '/api/journeys/insights',
    journeyInsights
  );
  return { app, services };
}

/** A fully-valid query string (org resolver value + validated course/period). */
function insightsReq(
  orgId: string = MANAGED_ORG_ID,
  courseId: string = COURSE_ID,
  period = '30d'
): Request {
  return new Request(
    `http://content-api.test/api/journeys/insights?organizationId=${orgId}&courseId=${courseId}&period=${period}`,
    { method: 'GET' }
  );
}

describe('GET /api/journeys/insights — route → service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner GET → 200, getInsights called with ctx.organizationId + courseId + period', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(insightsReq());
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: {
        courseId: string;
        financials: { revenueCents: { value: number } };
      };
    };
    expect(payload.data.courseId).toBe(COURSE_ID);
    expect(payload.data.financials.revenueCents.value).toBe(12_000);

    expect(services.courseInsights.getInsights).toHaveBeenCalledTimes(1);
    const [orgArg, courseArg, periodArg] =
      services.courseInsights.getInsights.mock.calls[0] ?? [];
    expect(orgArg).toBe(MANAGED_ORG_ID);
    expect(courseArg).toBe(COURSE_ID);
    expect(periodArg).toBe('30d');
  });

  it('positive: admin GET → 200 (requireOrgManagement = owner OR admin)', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    const bundle = buildApp({ orgRole: 'admin', services });
    const res = await bundle.app.request(insightsReq());
    expect(res.status).toBe(200);
    expect(services.courseInsights.getInsights).toHaveBeenCalledTimes(1);
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(insightsReq());
    expect(res.status).toBe(401);
    expect(services.courseInsights.getInsights).not.toHaveBeenCalled();
  });

  it('negative role: member on the org → 403, service NOT called', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    const bundle = buildApp({ orgRole: 'member', services });
    const res = await bundle.app.request(insightsReq());
    expect(res.status).toBe(403);
    expect(services.courseInsights.getInsights).not.toHaveBeenCalled();
  });

  it('cross-org safety: a manager of org A cannot query with org B — ctx.organizationId wins over query.organizationId', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    // Caller manages MANAGED_ORG_ID (set as ctx org); the client injects a
    // ROGUE org id in the query. The handler MUST forward ctx.organizationId so
    // no other org's course revenue can ever be aggregated.
    const bundle = buildApp({ services });
    const res = await bundle.app.request(insightsReq(ROGUE_ORG_ID));
    expect(res.status).toBe(200);
    const [orgArg] = services.courseInsights.getInsights.mock.calls[0] ?? [];
    expect(orgArg).toBe(MANAGED_ORG_ID);
    expect(orgArg).not.toBe(ROGUE_ORG_ID);
  });

  it('cross-org guard: service NotFoundError (course not in managed org) → 404, redacted body', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    services.courseInsights.getInsights.mockRejectedValueOnce(
      new NotFoundError('Course not found')
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(insightsReq());
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBeTruthy();
  });

  it('validation: a non-UUID courseId → 400, service NOT called', async () => {
    const services = { courseInsights: createInsightsServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      insightsReq(MANAGED_ORG_ID, 'not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(services.courseInsights.getInsights).not.toHaveBeenCalled();
  });
});
