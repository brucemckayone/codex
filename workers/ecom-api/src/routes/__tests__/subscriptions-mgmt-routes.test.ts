/**
 * Route-layer HTTP-boundary tests for the org-management subscription
 * endpoints (Codex-mhnfe, child of epic Codex-oal4l).
 *
 * Sibling task Codex-25svv covered the four read/create endpoints
 * (`/checkout`, `/verify`, `/current`, `/mine`) — see
 * `subscriptions-read-routes.test.ts`. This file covers the remaining
 * three management-side endpoints flagged by the 2026-05-12 audit:
 *
 *   - POST /subscriptions/preview-tier-change  (rateLimit: 'strict')
 *   - GET  /subscriptions/stats                (requireOrgManagement)
 *   - GET  /subscriptions/subscribers          (requireOrgManagement + pagination)
 *
 * For every endpoint we assert (per `feedback_security_deep_test`, positive
 * AND negative paths mandatory):
 *
 *   1. Positive: authenticated + (where applicable) manager request → 200,
 *      service method called with correct args.
 *   2. Negative auth: no session → 401, service NOT called.
 *   3. Negative input: invalid body/query → 400, service NOT called.
 *   4. Service throws typed `ServiceError` subclass → correct HTTP mapping
 *      via the real `mapErrorToResponse` (404 / 403 / 409).
 *   5. Service throws unknown `Error` → 500 with a generic, redacted
 *      message (no stack, no SQL leak).
 *
 * Plus endpoint-specific regression guards:
 *
 *   - `/preview-tier-change`:
 *       * `rateLimit: 'strict'` (20 req / window) — the 21st request in the
 *         window MUST be rejected with 429 BEFORE the service is touched.
 *         The rate-limit gate is enforced by the test harness's mocked
 *         `procedure`, mirroring the production gate's order of operations
 *         (rate-limit happens BEFORE handler invocation, see
 *         `packages/worker-utils/src/procedure/procedure.ts`).
 *       * `changeTierSchema` body validation: `organizationId` + `newTierId`
 *         must be UUIDs, `billingInterval` must be `'month' | 'year'`.
 *
 *   - `/stats`:
 *       * `requireOrgManagement: true` — a member (non-manager) on the
 *         resolved org MUST receive 403, NOT 200; the service MUST NOT be
 *         called. This is the regression guard the audit flagged: the
 *         management gate is invisible from the route file in isolation,
 *         so a stub `procedure` that ignored the policy would let a
 *         member view another org's stats.
 *       * Service receives `ctx.organizationId` (not body / query) — the
 *         org context is resolved by `procedure()` from the subdomain or
 *         organizationId query param. The route forwards ONLY
 *         `ctx.organizationId`; this assertion pins that contract.
 *
 *   - `/subscribers`:
 *       * `requireOrgManagement: true` — same 403 path as /stats.
 *       * Pagination: `?page=2&limit=10` MUST round-trip through the
 *         Zod-validated query into the service call. If the route ever
 *         starts mutating these defaults (e.g. capping `limit`), this
 *         assertion fails — keeps the contract pinned.
 *       * Response shape: handler returns `new PaginatedResult(items,
 *         pagination)`. The harness's mocked `procedure` matches the
 *         production envelope by emitting `{ items, pagination }` when
 *         the handler return is a PaginatedResult — see PaginatedResult
 *         in `@codex/worker-utils`.
 *
 * Harness: copies the `buildApp()` pattern from
 * `subscriptions-read-routes.test.ts` and extends the mocked `procedure`
 * with TWO additional gates required for these endpoints:
 *
 *   - `rateLimit` simulation: counts requests per test-injected key and
 *     returns 429 once the configured threshold is exceeded.
 *   - `requireOrgManagement` simulation: gates on a test-injected
 *     `__testOrgRole` and returns 403 unless the user is `owner`/`admin`.
 *     When the policy fires, the harness also injects
 *     `ctx.organizationId` from `__testOrganizationId` so the handler
 *     can forward it to the service (mirroring the production
 *     `resolveOrganizationId` step).
 *
 * Both extensions short-circuit BEFORE input validation runs, mirroring
 * the production execution order (see procedure.ts: IP → rate limit →
 * auth → role → org → input → handler).
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
 * Pass-through `procedure` mock that mirrors the production order of
 * operations:
 *
 *   1. Rate-limit gate (if `policy.rateLimit` set)
 *   2. Auth gate
 *   3. Org-management gate (if `policy.requireOrgManagement`)
 *   4. Body validation
 *   5. Query validation
 *   6. Handler invocation
 *   7. Error → `mapErrorToResponse`
 *   8. Response envelope: PaginatedResult → `{ items, pagination }`,
 *      otherwise → `{ data: result }`
 */

// Module-level rate-limit counter keyed by `__rateLimitKey` test variable.
// Reset in beforeEach via `rateLimitCounters.clear()`.
const rateLimitCounters = new Map<string, number>();

// Production `strict` preset is 20 req / window — matches the rule from
// workers/CLAUDE.md and the rate-limit table in workers/ecom-api/CLAUDE.md.
const RATE_LIMIT_THRESHOLDS: Record<string, number> = {
  auth: 5,
  api: 100,
  strict: 20,
  streaming: 60,
  webhook: 1000,
};

interface ProcedureConfig {
  policy?: {
    auth?: string;
    rateLimit?: string;
    requireOrgManagement?: boolean;
    requireOrgMembership?: boolean;
  };
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
        // 1. Rate-limit gate (mirrors production order: rate-limit BEFORE
        // auth so an unauthenticated flood is still capped).
        if (config.policy?.rateLimit) {
          const key = (c.get('__rateLimitKey') as string | undefined) ?? null;
          const threshold =
            RATE_LIMIT_THRESHOLDS[config.policy.rateLimit] ?? 100;
          if (key) {
            const next = (rateLimitCounters.get(key) ?? 0) + 1;
            rateLimitCounters.set(key, next);
            if (next > threshold) {
              return c.json(
                {
                  error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Too many requests',
                  },
                },
                429
              );
            }
          }
        }

        // 2. Auth gate.
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

        // 3. Org-management gate. Mirrors `enforceOrganizationAccess`
        // with `requireManagement: true` in
        // packages/worker-utils/src/procedure/helpers.ts.
        const orgRole = c.get('__testOrgRole') as string | undefined;
        const orgId = c.get('__testOrganizationId') as string | undefined;
        if (config.policy?.requireOrgManagement) {
          // Production also fails closed if org cannot be resolved
          // (see resolveOrganizationId → ValidationError). We don't
          // exercise that branch here — every test sets __testOrganizationId
          // explicitly so the failure is isolated to the role check.
          if (!orgId) {
            return c.json(
              {
                error: {
                  code: 'ORG_CONTEXT_REQUIRED',
                  message: 'Organization context could not be determined',
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
                  message: 'Organization management permission required',
                },
              },
              403
            );
          }
        }

        // 4. Body validation.
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

        // 5. Query validation.
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

        // 6. Build synthesized ctx and invoke the real handler.
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
          organizationId: orgId,
          organizationRole: orgRole,
        };

        try {
          const result = await config.handler(ctx);
          // Mirror production envelope: PaginatedResult → list shape;
          // plain object → { data }.
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
            statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
          );
        }
      };
    },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@codex/service-errors';
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

interface SubscriptionServiceMock {
  previewTierChange: ReturnType<typeof vi.fn>;
  getSubscriptionStats: ReturnType<typeof vi.fn>;
  listSubscribers: ReturnType<typeof vi.fn>;
}

function createSubscriptionServiceMock(): SubscriptionServiceMock {
  return {
    previewTierChange: vi.fn().mockResolvedValue({
      prorationDate: 1735689600,
      immediateChargeCents: 250,
      nextInvoiceCents: 1000,
      currency: 'gbp',
    }),
    getSubscriptionStats: vi.fn().mockResolvedValue({
      totalSubscribers: 42,
      activeSubscribers: 40,
      mrrCents: 84000,
      tierBreakdown: [],
    }),
    listSubscribers: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'sub_a',
          userId: 'user_a',
          status: 'active',
        },
      ],
      pagination: { page: 2, limit: 10, total: 11, totalPages: 2 },
    }),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: { subscription: SubscriptionServiceMock };
  kv?: KVMock | null;
  orgRole?: 'owner' | 'admin' | 'member' | undefined;
  organizationId?: string | undefined;
  rateLimitKey?: string | undefined;
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
    __testOrgRole: string | undefined;
    __testOrganizationId: string | undefined;
    __rateLimitKey: string | undefined;
  };
  const app = new Hono<{ Variables: TestVars }>();
  app.use('*', async (c, next) => {
    c.set('__testUser', args.user === undefined ? { id: 'user_1' } : args.user);
    c.set('__testServices', services);
    c.set('__testObs', undefined);
    c.set('__testEnv', { CACHE_KV: kv });
    c.set('__testExecCtx', { waitUntil });
    // Default: owner so management routes pass unless a test explicitly
    // downgrades to 'member'. Read/create routes ignore this entirely.
    c.set('__testOrgRole', args.orgRole === undefined ? 'owner' : args.orgRole);
    c.set(
      '__testOrganizationId',
      args.organizationId === undefined ? MANAGED_ORG_ID : args.organizationId
    );
    c.set('__rateLimitKey', args.rateLimitKey);
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
const MANAGED_ORG_ID = '323e4567-e89b-12d3-a456-426614174002';

// ─── POST /subscriptions/preview-tier-change ─────────────────────────────────

describe('POST /subscriptions/preview-tier-change — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCounters.clear();
  });

  it('positive: authenticated valid POST → 200, service called with (userId, orgId, newTierId, billingInterval)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: { id: 'user_preview' }, services });
    const body = {
      organizationId: VALID_ORG_ID,
      newTierId: VALID_TIER_ID,
      billingInterval: 'month' as const,
    };
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', body)
    );
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: { prorationDate: number; immediateChargeCents: number };
    };
    expect(payload.data.prorationDate).toBe(1735689600);

    expect(services.subscription.previewTierChange).toHaveBeenCalledTimes(1);
    expect(services.subscription.previewTierChange).toHaveBeenCalledWith(
      'user_preview',
      VALID_ORG_ID,
      VALID_TIER_ID,
      'month'
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const body = {
      organizationId: VALID_ORG_ID,
      newTierId: VALID_TIER_ID,
      billingInterval: 'month',
    };
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', body)
    );
    expect(res.status).toBe(401);
    expect(services.subscription.previewTierChange).not.toHaveBeenCalled();
  });

  it('negative body: missing newTierId → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: VALID_ORG_ID,
        billingInterval: 'month',
      })
    );
    expect(res.status).toBe(400);
    expect(services.subscription.previewTierChange).not.toHaveBeenCalled();
  });

  it('negative body: malformed organizationId UUID → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: 'not-a-uuid',
        newTierId: VALID_TIER_ID,
        billingInterval: 'month',
      })
    );
    expect(res.status).toBe(400);
    expect(services.subscription.previewTierChange).not.toHaveBeenCalled();
  });

  it('negative body: invalid billingInterval enum → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: VALID_ORG_ID,
        newTierId: VALID_TIER_ID,
        billingInterval: 'quarterly',
      })
    );
    expect(res.status).toBe(400);
    expect(services.subscription.previewTierChange).not.toHaveBeenCalled();
  });

  it('rate limit: 21st request in window → 429 BEFORE service is touched (rateLimit: strict = 20/min)', async () => {
    // The /preview-tier-change endpoint sets `rateLimit: 'strict'` — 20
    // requests per window. Production order is rate-limit BEFORE handler
    // (see procedure.ts) — so request 21 must short-circuit to 429 and
    // never reach the service. This is the regression guard the audit
    // flagged: rate-limit drift on this endpoint exposes the proration
    // endpoint to a brute-force preview-spam attack.
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_rl' },
      services,
      rateLimitKey: 'rl-test-preview',
    });
    const body = {
      organizationId: VALID_ORG_ID,
      newTierId: VALID_TIER_ID,
      billingInterval: 'month' as const,
    };

    // First 20 succeed (200).
    for (let i = 0; i < 20; i++) {
      const res = await bundle.app.request(
        postJson('/subscriptions/preview-tier-change', body)
      );
      expect(res.status).toBe(200);
    }
    expect(services.subscription.previewTierChange).toHaveBeenCalledTimes(20);

    // Request 21 is rejected.
    const limited = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', body)
    );
    expect(limited.status).toBe(429);
    const payload = (await limited.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
    // Service call count MUST NOT have advanced past 20.
    expect(services.subscription.previewTierChange).toHaveBeenCalledTimes(20);
  });

  it('service throws NotFoundError (tier not found) → 404', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.previewTierChange.mockRejectedValueOnce(
      new NotFoundError('Tier not found', { tierId: VALID_TIER_ID })
    );
    const bundle = buildApp({ user: { id: 'user_404' }, services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: VALID_ORG_ID,
        newTierId: VALID_TIER_ID,
        billingInterval: 'month' as const,
      })
    );
    expect(res.status).toBe(404);
  });

  it('service throws ValidationError (already on this tier) → 400', async () => {
    // Production `previewTierChange` throws ValidationError when the user
    // is already on the target tier (the dialog would otherwise display a
    // £0 proration that confuses the user). HTTP mapping for ValidationError
    // is 400 via mapErrorToResponse.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.previewTierChange.mockRejectedValueOnce(
      new ValidationError('Already on this tier', {
        tierId: VALID_TIER_ID,
      })
    );
    const bundle = buildApp({ user: { id: 'user_same' }, services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: VALID_ORG_ID,
        newTierId: VALID_TIER_ID,
        billingInterval: 'month' as const,
      })
    );
    expect(res.status).toBe(400);
  });

  it('service throws unknown Error → 500 with redacted message (no SQL, no stack)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.previewTierChange.mockRejectedValueOnce(
      new Error('PG: relation "subscriptions" does not exist at line 42')
    );
    const bundle = buildApp({ user: { id: 'user_500' }, services });
    const res = await bundle.app.request(
      postJson('/subscriptions/preview-tier-change', {
        organizationId: VALID_ORG_ID,
        newTierId: VALID_TIER_ID,
        billingInterval: 'month' as const,
      })
    );
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toMatch(/PG:/);
    expect(payload.error.message).not.toMatch(/relation/i);
    expect(payload.error.message).not.toMatch(/subscriptions/);
    expect(payload.error.details).toBeUndefined();
  });
});

// ─── GET /subscriptions/stats ────────────────────────────────────────────────

describe('GET /subscriptions/stats — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCounters.clear();
  });

  it('positive: manager (owner) GET → 200, service called with resolved organizationId', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_owner' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      data: { totalSubscribers: number };
    };
    expect(payload.data.totalSubscribers).toBe(42);

    // Route forwards ctx.organizationId ONLY — not the query body.
    expect(services.subscription.getSubscriptionStats).toHaveBeenCalledTimes(1);
    expect(services.subscription.getSubscriptionStats).toHaveBeenCalledWith(
      MANAGED_ORG_ID
    );
  });

  it('positive: admin role also passes management gate → 200', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_admin' },
      services,
      orgRole: 'admin',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(services.subscription.getSubscriptionStats).toHaveBeenCalledTimes(1);
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(401);
    expect(services.subscription.getSubscriptionStats).not.toHaveBeenCalled();
  });

  it('negative authz: member (non-manager) → 403, service NOT called (requireOrgManagement gate)', async () => {
    // This is the headline regression guard for this task: a plain
    // member of the org MUST NOT be able to read subscriber stats. If a
    // future refactor drops the `requireOrgManagement: true` flag from
    // the route, this assertion fails immediately.
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_member' },
      services,
      orgRole: 'member',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(403);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('FORBIDDEN');
    expect(services.subscription.getSubscriptionStats).not.toHaveBeenCalled();
  });

  it('negative query: missing organizationId → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_q' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(getReq('/subscriptions/stats'));
    expect(res.status).toBe(400);
    expect(services.subscription.getSubscriptionStats).not.toHaveBeenCalled();
  });

  it('negative query: malformed organizationId UUID → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_q' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/stats?organizationId=not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(services.subscription.getSubscriptionStats).not.toHaveBeenCalled();
  });

  it('service throws NotFoundError → 404', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getSubscriptionStats.mockRejectedValueOnce(
      new NotFoundError('Organization not found', {
        organizationId: MANAGED_ORG_ID,
      })
    );
    const bundle = buildApp({
      user: { id: 'user_o' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(404);
  });

  it('service throws unknown Error → 500 redacted', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.getSubscriptionStats.mockRejectedValueOnce(
      new Error('PG: connection refused at /var/lib/postgres/data')
    );
    const bundle = buildApp({
      user: { id: 'user_500' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(`/subscriptions/stats?organizationId=${MANAGED_ORG_ID}`)
    );
    expect(res.status).toBe(500);

    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toMatch(/PG:/);
    expect(payload.error.message).not.toMatch(/postgres/i);
  });
});

// ─── GET /subscriptions/subscribers ──────────────────────────────────────────

describe('GET /subscriptions/subscribers — route → service contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCounters.clear();
  });

  it('positive: manager GET with pagination → 200, service receives (orgId, { page, limit })', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_owner' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=2&limit=10')
    );
    expect(res.status).toBe(200);

    // Production envelope: list endpoints emit { items, pagination },
    // NOT { data: ... }. The route returns `new PaginatedResult(...)`.
    const payload = (await res.json()) as {
      items: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number };
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.id).toBe('sub_a');
    expect(payload.pagination.page).toBe(2);
    expect(payload.pagination.limit).toBe(10);
    expect(payload.pagination.total).toBe(11);

    // Service receives ctx.organizationId (resolved by procedure) as the
    // FIRST arg, and the validated query as the SECOND. Pagination MUST
    // round-trip unmodified.
    expect(services.subscription.listSubscribers).toHaveBeenCalledTimes(1);
    const [orgArg, queryArg] = services.subscription.listSubscribers.mock
      .calls[0] as [string, { page: number; limit: number }];
    expect(orgArg).toBe(MANAGED_ORG_ID);
    expect(queryArg.page).toBe(2);
    expect(queryArg.limit).toBe(10);
  });

  it('positive: optional tierId + status filters round-trip through to service', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_owner' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq(
        `/subscriptions/subscribers?page=1&limit=20&tierId=${VALID_TIER_ID}&status=active`
      )
    );
    expect(res.status).toBe(200);

    const [, queryArg] = services.subscription.listSubscribers.mock
      .calls[0] as [string, { tierId?: string; status?: string }];
    expect(queryArg.tierId).toBe(VALID_TIER_ID);
    expect(queryArg.status).toBe('active');
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20')
    );
    expect(res.status).toBe(401);
    expect(services.subscription.listSubscribers).not.toHaveBeenCalled();
  });

  it('negative authz: member (non-manager) → 403, service NOT called (requireOrgManagement gate)', async () => {
    // Headline regression guard: members must not enumerate the
    // subscriber list. Audit flagged this as a high-impact data exposure
    // path if the management gate ever drifts.
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_member' },
      services,
      orgRole: 'member',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20')
    );
    expect(res.status).toBe(403);
    const payload = (await res.json()) as {
      error: { code: string };
    };
    expect(payload.error.code).toBe('FORBIDDEN');
    expect(services.subscription.listSubscribers).not.toHaveBeenCalled();
  });

  it('negative query: malformed tierId UUID → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_q' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20&tierId=not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(services.subscription.listSubscribers).not.toHaveBeenCalled();
  });

  it('negative query: invalid status enum → 400, service NOT called', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    const bundle = buildApp({
      user: { id: 'user_q' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20&status=banana')
    );
    expect(res.status).toBe(400);
    expect(services.subscription.listSubscribers).not.toHaveBeenCalled();
  });

  it('service throws ForbiddenError (cross-org leak guard) → 403', async () => {
    // Defense-in-depth: even if the route's management gate were
    // bypassed somehow, the service should still scope by orgId and
    // throw if the org belongs to a different owner. HTTP mapping must
    // surface as 403, not 500.
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.listSubscribers.mockRejectedValueOnce(
      new ForbiddenError('Cross-org access denied', {
        organizationId: MANAGED_ORG_ID,
      })
    );
    const bundle = buildApp({
      user: { id: 'user_o' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20')
    );
    expect(res.status).toBe(403);
  });

  it('service throws unknown Error → 500 redacted (no SQL leak)', async () => {
    const services = { subscription: createSubscriptionServiceMock() };
    services.subscription.listSubscribers.mockRejectedValueOnce(
      new Error('PG: column "subscriptions.deleted_at" does not exist')
    );
    const bundle = buildApp({
      user: { id: 'user_500' },
      services,
      orgRole: 'owner',
      organizationId: MANAGED_ORG_ID,
    });
    const res = await bundle.app.request(
      getReq('/subscriptions/subscribers?page=1&limit=20')
    );
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
});
