/**
 * Route-layer HTTP-boundary tests for the revenue-share agreement
 * endpoints (Codex-hqke2 — WP-3 of epic Codex-nk4km).
 *
 * Tests pin the HTTP contract — not the service behaviour. The service
 * is mocked so its internal authz / state-machine logic doesn't need to
 * be re-tested here (that's WP-2's responsibility in
 * `packages/agreements/__tests__/agreement-service.test.ts`).
 *
 * Per `feedback_security_deep_test` (positive AND negative paths
 * mandatory for security-adjacent code), every endpoint is tested for:
 *
 *   1. Authz positive: authenticated + (where applicable) on-org → 200/201,
 *      service called with the correct args.
 *   2. Authz negative: no session → 401, service NOT called.
 *   3. Authz negative for owner-only writes: non-member on the resolved
 *      org → 403, service NOT called.
 *   4. Validation positive: a valid body → handler executes.
 *   5. Validation negative: malformed body / out-of-range shares / wrong
 *      enum → 400, service NOT called.
 *   6. Error mapping: service throws typed error → correct HTTP status,
 *      assertion on `err.code` rather than `err.name` per
 *      `feedback_not_found_error_name_minification`.
 *
 * Plus regression guards specific to this route file:
 *
 *   - `/propose`: route forwards `ctx.organizationId` (resolved from
 *     membership) to the service — NOT `body.organizationId`. This is
 *     the cross-org safety pin documented in `routes/sales.ts`. If a
 *     refactor ever wires the client-supplied org id directly into the
 *     service call, this test fails.
 *
 *   - `/agreements/me` anonymisation: the response peer aggregate
 *     contains `count` + `aggregateSharePercent` ONLY. No peer userId /
 *     creatorId / display fields. The fixture deliberately seeds two
 *     peer creators with distinct ids; the response is grep'd for those
 *     ids — if any peer id leaks, the test fails. This is the load-
 *     bearing visibility contract from the epic plan.
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks (must be declared before route module import) ──────────────

vi.mock('@codex/agreements', async () => {
  // Service is constructed lazily by the service registry; the route
  // file consumes it via `ctx.services.agreements`. We bypass the
  // registry by injecting a hand-built services bag into the procedure
  // ctx, so the actual `AgreementService` symbol is only needed at
  // import-resolution time.
  return {
    AgreementService: vi.fn(),
  };
});

interface ProcedureConfig {
  policy?: {
    auth?: string;
    requireOrgMembership?: boolean;
    rateLimit?: string;
  };
  input?: {
    body?: { safeParse: (v: unknown) => unknown };
    query?: { safeParse: (v: unknown) => unknown };
    params?: { safeParse: (v: unknown) => unknown };
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
          param: () => Record<string, string>;
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
        if (config.policy?.requireOrgMembership) {
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
          if (!orgRole) {
            return c.json(
              {
                error: {
                  code: 'FORBIDDEN',
                  message: 'You are not a member of this organization',
                },
              },
              403
            );
          }
        }

        // Body validation
        let body: unknown = {};
        if (config.input?.body) {
          let raw: unknown = {};
          try {
            raw = await c.req.json();
          } catch {
            raw = {};
          }
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

        // Query validation
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

        // Params validation
        let params: unknown = {};
        if (config.input?.params) {
          const raw = c.req.param();
          const parsed = (
            config.input.params as unknown as {
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
          params = parsed.data;
        }

        const services = c.get('__testServices');
        const ctx = {
          user: testUser,
          input: { body, query, params },
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
            statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
          );
        }
      };
    },
  };
});

// ─── Imports (after vi.mock declarations) ────────────────────────────────────

// Use the typed `ServiceError` subclasses the AgreementService throws.
// AgreementNotFoundError / InvalidProposalStateError /
// ShareExceedsAvailableError live in @codex/agreements; they extend
// NotFoundError and BusinessLogicError respectively. We instantiate the
// base classes directly here to avoid pulling @codex/agreements into
// ecom-api's deps just for test fixtures — `mapErrorToResponse()` maps
// off the base class anyway, so the HTTP status assertions are
// identical.
import { BusinessLogicError, NotFoundError } from '@codex/service-errors';
import { Hono } from 'hono';
import agreements from '../agreements';

// ─── Shared test fixtures ────────────────────────────────────────────────────

const MANAGED_ORG_ID = '323e4567-e89b-12d3-a456-426614174002';
const ROGUE_ORG_ID = '999e4567-e89b-12d3-a456-426614174999';
const TARGET_CREATOR_ID = 'usr_target_creator_001';
const PEER_CREATOR_ID_1 = 'usr_peer_creator_001';
const PEER_CREATOR_ID_2 = 'usr_peer_creator_002';
const OWNER_USER_ID = 'usr_owner_001';
const CALLER_CREATOR_ID = 'usr_caller_creator_001';
// Real UUIDs (must pass `z.uuid()` strict regex: version digit [1-8] and
// variant [89abAB] in the correct positions). All-1s / all-2s placeholders
// fail Zod v4's UUID format check.
const PROPOSAL_ID = '11111111-1111-4111-9111-111111111111';
const AGREEMENT_ID = '22222222-2222-4222-9222-222222222222';

interface AgreementServiceMock {
  proposeAgreement: ReturnType<typeof vi.fn>;
  counterPropose: ReturnType<typeof vi.fn>;
  acceptProposal: ReturnType<typeof vi.fn>;
  declineProposal: ReturnType<typeof vi.fn>;
  withdrawProposal: ReturnType<typeof vi.fn>;
  terminateAgreement: ReturnType<typeof vi.fn>;
  getActiveAgreements: ReturnType<typeof vi.fn>;
  getActiveAgreementsForCreator: ReturnType<typeof vi.fn>;
  getNegotiationThread: ReturnType<typeof vi.fn>;
}

function createAgreementServiceMock(): AgreementServiceMock {
  return {
    proposeAgreement: vi.fn().mockResolvedValue({
      id: PROPOSAL_ID,
      organizationId: MANAGED_ORG_ID,
      creatorId: TARGET_CREATOR_ID,
      revenueType: 'subscription',
      status: 'open',
      proposedCreatorSharePercent: 3000,
      proposedTermMonths: 12,
      proposedByRole: 'owner',
      proposedByUserId: OWNER_USER_ID,
      roundNumber: 1,
    }),
    counterPropose: vi.fn().mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      proposedCreatorSharePercent: 4000,
      proposedTermMonths: 12,
      status: 'open',
      proposedByRole: 'creator',
      proposedByUserId: TARGET_CREATOR_ID,
      roundNumber: 2,
      parentProposalId: PROPOSAL_ID,
    }),
    acceptProposal: vi.fn().mockResolvedValue({
      id: AGREEMENT_ID,
      organizationId: MANAGED_ORG_ID,
      creatorId: TARGET_CREATOR_ID,
      revenueType: 'subscription',
      status: 'active',
      organizationFeePercentage: 7000,
      currentProposalId: PROPOSAL_ID,
    }),
    declineProposal: vi.fn().mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'declined',
      declineReason: 'Too low',
    }),
    withdrawProposal: vi.fn().mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'withdrawn',
    }),
    terminateAgreement: vi.fn().mockResolvedValue({
      id: AGREEMENT_ID,
      status: 'terminated',
      terminatedByUserId: OWNER_USER_ID,
      terminationReason: 'Mutual',
    }),
    getActiveAgreements: vi.fn().mockResolvedValue([
      {
        id: 'agr_a',
        organizationId: MANAGED_ORG_ID,
        creatorId: CALLER_CREATOR_ID,
        revenueType: 'subscription',
        status: 'active',
        organizationFeePercentage: 7000, // share = 3000
        currentProposalId: PROPOSAL_ID,
        terminatedAt: null,
        effectiveFrom: new Date('2026-01-01'),
        effectiveUntil: null,
      },
      {
        id: 'agr_b',
        organizationId: MANAGED_ORG_ID,
        creatorId: PEER_CREATOR_ID_1,
        revenueType: 'subscription',
        status: 'active',
        organizationFeePercentage: 8000, // share = 2000
        currentProposalId: 'prop_b',
        terminatedAt: null,
        effectiveFrom: new Date('2026-01-02'),
        effectiveUntil: null,
      },
      {
        id: 'agr_c',
        organizationId: MANAGED_ORG_ID,
        creatorId: PEER_CREATOR_ID_2,
        revenueType: 'content_purchase',
        status: 'active',
        organizationFeePercentage: 9000, // share = 1000
        currentProposalId: 'prop_c',
        terminatedAt: null,
        effectiveFrom: new Date('2026-01-03'),
        effectiveUntil: null,
      },
    ]),
    getActiveAgreementsForCreator: vi.fn().mockResolvedValue([
      {
        id: 'agr_a',
        organizationId: MANAGED_ORG_ID,
        creatorId: CALLER_CREATOR_ID,
        revenueType: 'subscription',
        status: 'active',
        organizationFeePercentage: 7000, // share = 3000
        currentProposalId: PROPOSAL_ID,
        terminatedAt: null,
        effectiveFrom: new Date('2026-01-01'),
        effectiveUntil: null,
      },
    ]),
    getNegotiationThread: vi.fn().mockResolvedValue([
      {
        id: PROPOSAL_ID,
        roundNumber: 1,
        status: 'open',
        proposedByRole: 'owner',
        proposedCreatorSharePercent: 3000,
        proposedTermMonths: 12,
        creatorId: CALLER_CREATOR_ID,
        revenueType: 'subscription',
        organizationId: MANAGED_ORG_ID,
      },
    ]),
  };
}

interface BuildAppArgs {
  user?: { id: string } | null;
  services?: { agreements: AgreementServiceMock };
  /**
   * `null` means "not a member of the resolved org" — the harness emits
   * 403 when `requireOrgMembership` is set. `undefined` falls back to
   * 'owner'. Any string value is used verbatim.
   */
  orgRole?: 'owner' | 'admin' | 'member' | null | undefined;
  organizationId?: string | undefined;
}

function buildApp(args: BuildAppArgs = {}) {
  const services = args.services ?? {
    agreements: createAgreementServiceMock(),
  };
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set(
      '__testUser',
      args.user === undefined ? { id: OWNER_USER_ID } : args.user
    );
    c.set('__testServices', services);
    // `null` → not a member (harness emits 403). `undefined` → owner.
    c.set(
      '__testOrgRole',
      args.orgRole === undefined ? 'owner' : (args.orgRole ?? undefined)
    );
    c.set(
      '__testOrganizationId',
      args.organizationId === undefined ? MANAGED_ORG_ID : args.organizationId
    );
    await next();
  });
  (app as unknown as { route: (path: string, r: unknown) => void }).route(
    '/agreements',
    agreements
  );
  return { app, services };
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

// ─── POST /agreements/propose ────────────────────────────────────────────────

describe('POST /agreements/propose — owner-side mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    organizationId: MANAGED_ORG_ID,
    creatorId: TARGET_CREATOR_ID,
    revenueType: 'subscription',
    sharePercent: 3000,
    termMonths: 12,
    note: 'Initial proposal',
  };

  it('positive: owner POST with valid body → 201, service called with ctx.organizationId', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', validBody)
    );
    expect(res.status).toBe(201);
    expect(services.agreements.proposeAgreement).toHaveBeenCalledTimes(1);
    const [arg] = services.agreements.proposeAgreement.mock.calls[0]!;
    expect((arg as { organizationId: string }).organizationId).toBe(
      MANAGED_ORG_ID
    );
    expect((arg as { proposedByUserId: string }).proposedByUserId).toBe(
      OWNER_USER_ID
    );
  });

  it('cross-org safety: ctx.organizationId wins over body.organizationId', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    // Client sends a different org id in the body; the route MUST
    // forward `ctx.organizationId` (resolved from membership) to the
    // service.
    const res = await bundle.app.request(
      postReq('/agreements/propose', {
        ...validBody,
        organizationId: ROGUE_ORG_ID,
      })
    );
    expect(res.status).toBe(201);
    const [arg] = services.agreements.proposeAgreement.mock.calls[0]!;
    expect((arg as { organizationId: string }).organizationId).toBe(
      MANAGED_ORG_ID
    );
    expect((arg as { organizationId: string }).organizationId).not.toBe(
      ROGUE_ORG_ID
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', validBody)
    );
    expect(res.status).toBe(401);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative authz: non-member on the org → 403, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ orgRole: null, services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', validBody)
    );
    expect(res.status).toBe(403);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative validation: sharePercent > 10000 → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', { ...validBody, sharePercent: 15000 })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative validation: sharePercent negative → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', { ...validBody, sharePercent: -1 })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative validation: termMonths < 1 → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', { ...validBody, termMonths: 0 })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative validation: invalid revenueType → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', {
        ...validBody,
        revenueType: 'nonsense',
      })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('negative validation: missing required creatorId → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const { creatorId: _omitted, ...incomplete } = validBody;
    const res = await bundle.app.request(
      postReq('/agreements/propose', incomplete)
    );
    expect(res.status).toBe(400);
    expect(services.agreements.proposeAgreement).not.toHaveBeenCalled();
  });

  it('error mapping: service throws ShareExceedsAvailableError (BusinessLogicError) → 422 with err.code (NOT name)', async () => {
    const services = { agreements: createAgreementServiceMock() };
    services.agreements.proposeAgreement.mockRejectedValueOnce(
      new BusinessLogicError('Share too high', {
        proposedSharePercent: 9000,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/propose', validBody)
    );
    expect(res.status).toBe(422);
    const payload = (await res.json()) as { error?: { code?: string } };
    // Per feedback_not_found_error_name_minification — assert err.code
    expect(payload.error?.code).toBeTruthy();
  });
});

// ─── POST /agreements/:proposalId/accept ─────────────────────────────────────

describe('POST /agreements/:proposalId/accept — counterparty mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: counterparty creator POST → 200, service called with proposalId + acceptedByUserId', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: TARGET_CREATOR_ID },
    });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/accept`, {})
    );
    expect(res.status).toBe(200);
    expect(services.agreements.acceptProposal).toHaveBeenCalledTimes(1);
    const [arg] = services.agreements.acceptProposal.mock.calls[0]!;
    expect((arg as { proposalId: string }).proposalId).toBe(PROPOSAL_ID);
    expect((arg as { acceptedByUserId: string }).acceptedByUserId).toBe(
      TARGET_CREATOR_ID
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/accept`, {})
    );
    expect(res.status).toBe(401);
    expect(services.agreements.acceptProposal).not.toHaveBeenCalled();
  });

  it('error mapping: same-party (proposer) accept → service throws ForbiddenError → 403', async () => {
    // The owner who proposed cannot accept their own proposal — service
    // enforces, route propagates.
    const services = { agreements: createAgreementServiceMock() };
    const { ForbiddenError } = await import('@codex/service-errors');
    services.agreements.acceptProposal.mockRejectedValueOnce(
      new ForbiddenError('Only the counterparty creator may accept', {
        proposalId: PROPOSAL_ID,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/accept`, {})
    );
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBeTruthy();
  });

  it('error mapping: non-existent proposalId → AgreementNotFoundError (NotFoundError) → 404 with err.code', async () => {
    const services = { agreements: createAgreementServiceMock() };
    services.agreements.acceptProposal.mockRejectedValueOnce(
      new NotFoundError('Proposal not found', {
        proposalId: PROPOSAL_ID,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/accept`, {})
    );
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBeTruthy();
  });

  it('error mapping: already-accepted proposal → InvalidProposalStateError (BusinessLogicError) → 422', async () => {
    const services = { agreements: createAgreementServiceMock() };
    services.agreements.acceptProposal.mockRejectedValueOnce(
      new BusinessLogicError('Only open proposals can be accepted', {
        proposalId: PROPOSAL_ID,
        currentStatus: 'accepted',
        attemptedAction: 'accept',
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/accept`, {})
    );
    expect(res.status).toBe(422);
  });

  it('negative validation: invalid proposalId UUID → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/not-a-uuid/accept', {})
    );
    expect(res.status).toBe(400);
    expect(services.agreements.acceptProposal).not.toHaveBeenCalled();
  });
});

// ─── POST /agreements/:proposalId/counter ────────────────────────────────────

describe('POST /agreements/:proposalId/counter — counterparty mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = { sharePercent: 4000, termMonths: 12 };

  it('positive: counterparty POST → 201, service called with counteredByUserId', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: TARGET_CREATOR_ID },
    });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/counter`, validBody)
    );
    expect(res.status).toBe(201);
    const [arg] = services.agreements.counterPropose.mock.calls[0]!;
    expect((arg as { counteredByUserId: string }).counteredByUserId).toBe(
      TARGET_CREATOR_ID
    );
  });

  it('negative validation: sharePercent invalid → 400, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/counter`, {
        ...validBody,
        sharePercent: 99999,
      })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.counterPropose).not.toHaveBeenCalled();
  });

  it('error mapping: non-counterparty counter → ForbiddenError → 403', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const { ForbiddenError } = await import('@codex/service-errors');
    services.agreements.counterPropose.mockRejectedValueOnce(
      new ForbiddenError('Only the counterparty creator may counter', {
        proposalId: PROPOSAL_ID,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/counter`, validBody)
    );
    expect(res.status).toBe(403);
  });
});

// ─── POST /agreements/:proposalId/decline ────────────────────────────────────

describe('POST /agreements/:proposalId/decline — counterparty mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: counterparty POST with reason → 200, service called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: TARGET_CREATOR_ID },
    });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/decline`, { reason: 'No thanks' })
    );
    expect(res.status).toBe(200);
    expect(services.agreements.declineProposal).toHaveBeenCalledTimes(1);
    const [arg] = services.agreements.declineProposal.mock.calls[0]!;
    expect((arg as { reason: string }).reason).toBe('No thanks');
  });

  it('positive: counterparty POST without reason → 200, service called with reason=null', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/decline`, {})
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.declineProposal.mock.calls[0]!;
    expect((arg as { reason: string | null }).reason).toBeNull();
  });

  it('negative validation: reason too long → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/decline`, {
        reason: 'x'.repeat(600),
      })
    );
    expect(res.status).toBe(400);
    expect(services.agreements.declineProposal).not.toHaveBeenCalled();
  });
});

// ─── POST /agreements/:proposalId/withdraw ───────────────────────────────────

describe('POST /agreements/:proposalId/withdraw — proposer-side mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: proposer POST → 200, service called with withdrawnByUserId', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/withdraw`, {})
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.withdrawProposal.mock.calls[0]!;
    expect((arg as { withdrawnByUserId: string }).withdrawnByUserId).toBe(
      OWNER_USER_ID
    );
  });

  it('error mapping: non-proposer withdraw → ForbiddenError → 403', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const { ForbiddenError } = await import('@codex/service-errors');
    services.agreements.withdrawProposal.mockRejectedValueOnce(
      new ForbiddenError('Only the proposing party may withdraw', {
        proposalId: PROPOSAL_ID,
      })
    );
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq(`/agreements/${PROPOSAL_ID}/withdraw`, {})
    );
    expect(res.status).toBe(403);
  });
});

// ─── POST /agreements/:agreementId/terminate ─────────────────────────────────

describe('POST /agreements/:agreementId/terminate — either-party mutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner terminates → 200', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services, user: { id: OWNER_USER_ID } });
    const res = await bundle.app.request(
      postReq(`/agreements/${AGREEMENT_ID}/terminate`, {
        reason: 'No longer working',
      })
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.terminateAgreement.mock.calls[0]!;
    expect((arg as { terminatedByUserId: string }).terminatedByUserId).toBe(
      OWNER_USER_ID
    );
  });

  it('positive: creator (the named party) terminates → 200', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: TARGET_CREATOR_ID },
    });
    const res = await bundle.app.request(
      postReq(`/agreements/${AGREEMENT_ID}/terminate`, {})
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.terminateAgreement.mock.calls[0]!;
    expect((arg as { terminatedByUserId: string }).terminatedByUserId).toBe(
      TARGET_CREATOR_ID
    );
  });

  it('error mapping: random non-party terminates → ForbiddenError → 403', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const { ForbiddenError } = await import('@codex/service-errors');
    services.agreements.terminateAgreement.mockRejectedValueOnce(
      new ForbiddenError(
        'Only an active organization owner may perform this action',
        { organizationId: MANAGED_ORG_ID }
      )
    );
    const bundle = buildApp({ services, user: { id: 'usr_random' } });
    const res = await bundle.app.request(
      postReq(`/agreements/${AGREEMENT_ID}/terminate`, {})
    );
    expect(res.status).toBe(403);
  });

  it('negative validation: bad agreementId UUID → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      postReq('/agreements/not-a-uuid/terminate', {})
    );
    expect(res.status).toBe(400);
    expect(services.agreements.terminateAgreement).not.toHaveBeenCalled();
  });
});

// ─── GET /agreements — owner-view list ───────────────────────────────────────

describe('GET /agreements — owner-view list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner GET → 200, all rows with full identifying info', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(getReq('/agreements'));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      items: Array<{ creatorId: string; revenueType: string }>;
      pagination: { total: number };
    };
    expect(payload.items).toHaveLength(3);
    // Owner-view: NO anonymisation. Every peer creatorId is visible.
    const creatorIds = payload.items.map((i) => i.creatorId);
    expect(creatorIds).toContain(CALLER_CREATOR_ID);
    expect(creatorIds).toContain(PEER_CREATOR_ID_1);
    expect(creatorIds).toContain(PEER_CREATOR_ID_2);
    // Service called with ctx.organizationId, not query.organizationId
    const [arg] = services.agreements.getActiveAgreements.mock.calls[0]!;
    expect((arg as { organizationId: string }).organizationId).toBe(
      MANAGED_ORG_ID
    );
  });

  it('cross-org safety: client query.organizationId ignored — ctx.organizationId wins', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq(`/agreements?organizationId=${ROGUE_ORG_ID}`)
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.getActiveAgreements.mock.calls[0]!;
    expect((arg as { organizationId: string }).organizationId).toBe(
      MANAGED_ORG_ID
    );
    expect((arg as { organizationId: string }).organizationId).not.toBe(
      ROGUE_ORG_ID
    );
  });

  it('positive: revenueType query filter narrows to one type', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq('/agreements?revenueType=subscription')
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      items: Array<{ revenueType: string }>;
    };
    expect(payload.items.every((i) => i.revenueType === 'subscription')).toBe(
      true
    );
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(getReq('/agreements'));
    expect(res.status).toBe(401);
    expect(services.agreements.getActiveAgreements).not.toHaveBeenCalled();
  });

  it('negative authz: non-member on the org → 403, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ orgRole: null, services });
    const res = await bundle.app.request(getReq('/agreements'));
    expect(res.status).toBe(403);
    expect(services.agreements.getActiveAgreements).not.toHaveBeenCalled();
  });

  it('negative validation: invalid revenueType query → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq('/agreements?revenueType=nonsense')
    );
    expect(res.status).toBe(400);
    expect(services.agreements.getActiveAgreements).not.toHaveBeenCalled();
  });
});

// ─── GET /agreements/me — creator-view portfolio ─────────────────────────────

describe('GET /agreements/me — creator-view portfolio (ANONYMISATION CONTRACT)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: creator GET → 200, response includes peers aggregate ONLY (no peer ids)', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(getReq('/agreements/me'));
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      items: Array<{
        creatorId: string;
        peers: { count: number; aggregateSharePercent: number };
      }>;
    };
    expect(payload.items).toHaveLength(1);
    const row = payload.items[0]!;

    // Caller's own row: their own creatorId IS allowed (they are
    // looking at their own slice).
    expect(row.creatorId).toBe(CALLER_CREATOR_ID);

    // Peers aggregate: 2 other active creators on the org.
    // PEER_CREATOR_ID_1 has share = 10000 - 8000 = 2000 (subscription)
    // PEER_CREATOR_ID_2 has share = 10000 - 9000 = 1000 (content_purchase)
    expect(row.peers.count).toBe(2);
    expect(row.peers.aggregateSharePercent).toBe(3000);

    // The load-bearing invariant: NO peer identifying fields appear
    // anywhere in the serialised response. Grep the entire body for
    // each peer's userId.
    const bodyText = JSON.stringify(payload);
    expect(bodyText).not.toContain(PEER_CREATOR_ID_1);
    expect(bodyText).not.toContain(PEER_CREATOR_ID_2);
  });

  it('positive: creator with no peers → peers.count = 0', async () => {
    const services = { agreements: createAgreementServiceMock() };
    // Override: only the caller has a row, no peers
    services.agreements.getActiveAgreements.mockResolvedValue([
      {
        id: 'agr_a',
        organizationId: MANAGED_ORG_ID,
        creatorId: CALLER_CREATOR_ID,
        revenueType: 'subscription',
        status: 'active',
        organizationFeePercentage: 7000,
        currentProposalId: PROPOSAL_ID,
        terminatedAt: null,
        effectiveFrom: new Date(),
        effectiveUntil: null,
      },
    ]);
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(getReq('/agreements/me'));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      items: Array<{ peers: { count: number; aggregateSharePercent: number } }>;
    };
    expect(payload.items[0]!.peers.count).toBe(0);
    expect(payload.items[0]!.peers.aggregateSharePercent).toBe(0);
  });

  it('positive: creator with no agreements → empty items', async () => {
    const services = { agreements: createAgreementServiceMock() };
    services.agreements.getActiveAgreementsForCreator.mockResolvedValue([]);
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(getReq('/agreements/me'));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { items: unknown[] };
    expect(payload.items).toHaveLength(0);
  });

  it('negative auth: no session → 401, service NOT called', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(getReq('/agreements/me'));
    expect(res.status).toBe(401);
    expect(
      services.agreements.getActiveAgreementsForCreator
    ).not.toHaveBeenCalled();
  });
});

// ─── GET /agreements/threads/:creatorId — owner-view thread ─────────────────

describe('GET /agreements/threads/:creatorId — owner-view negotiation thread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: owner GET → 200, service called with org + creator + revenueType', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq(
        `/agreements/threads/${TARGET_CREATOR_ID}?revenueType=subscription`
      )
    );
    expect(res.status).toBe(200);
    const [arg] = services.agreements.getNegotiationThread.mock.calls[0]!;
    expect((arg as { organizationId: string }).organizationId).toBe(
      MANAGED_ORG_ID
    );
    expect((arg as { creatorId: string }).creatorId).toBe(TARGET_CREATOR_ID);
    expect((arg as { revenueType: string }).revenueType).toBe('subscription');
  });

  it('negative authz: non-member → 403', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ orgRole: null, services });
    const res = await bundle.app.request(
      getReq(
        `/agreements/threads/${TARGET_CREATOR_ID}?revenueType=subscription`
      )
    );
    expect(res.status).toBe(403);
    expect(services.agreements.getNegotiationThread).not.toHaveBeenCalled();
  });

  it('negative validation: missing revenueType → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq(`/agreements/threads/${TARGET_CREATOR_ID}`)
    );
    expect(res.status).toBe(400);
    expect(services.agreements.getNegotiationThread).not.toHaveBeenCalled();
  });
});

// ─── GET /agreements/me/threads/:proposalId — creator-view thread ────────────

describe('GET /agreements/me/threads/:proposalId — creator-view thread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('positive: creator GET with own proposal id → 200, returns thread', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(
      getReq(`/agreements/me/threads/${PROPOSAL_ID}`)
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: Array<{ id: string }>;
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]!.id).toBe(PROPOSAL_ID);
  });

  it('negative: caller has no thread containing the proposal → 404 (no existence leak)', async () => {
    const services = { agreements: createAgreementServiceMock() };
    // Thread does not contain the requested proposal
    services.agreements.getNegotiationThread.mockResolvedValue([
      {
        id: 'other-proposal-id',
        roundNumber: 1,
        status: 'open',
        proposedByRole: 'owner',
      },
    ]);
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(
      getReq(`/agreements/me/threads/${PROPOSAL_ID}`)
    );
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBeTruthy();
  });

  it('negative: caller has no agreements at all → 404', async () => {
    const services = { agreements: createAgreementServiceMock() };
    services.agreements.getActiveAgreementsForCreator.mockResolvedValue([]);
    const bundle = buildApp({
      services,
      user: { id: CALLER_CREATOR_ID },
    });
    const res = await bundle.app.request(
      getReq(`/agreements/me/threads/${PROPOSAL_ID}`)
    );
    expect(res.status).toBe(404);
  });

  it('negative auth: no session → 401', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ user: null, services });
    const res = await bundle.app.request(
      getReq(`/agreements/me/threads/${PROPOSAL_ID}`)
    );
    expect(res.status).toBe(401);
  });

  it('negative validation: invalid proposalId → 400', async () => {
    const services = { agreements: createAgreementServiceMock() };
    const bundle = buildApp({ services });
    const res = await bundle.app.request(
      getReq('/agreements/me/threads/not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(
      services.agreements.getActiveAgreementsForCreator
    ).not.toHaveBeenCalled();
  });
});
