/**
 * The leaving notice's admin routes (Codex-a6ofh.6): an org admin's delete
 * and Keep, and a platform admin's takedown.
 *
 * What this file pins:
 *   - the takedown's policy matrix: anonymous 401, a creator and an org
 *     admin 403, the platform owner 200. It is the one route that deletes
 *     any org's piece at once, skipping the 30 days, so it declares
 *     `platform_owner`, no org policy and the `strict` limit;
 *   - the delete and Keep declare the org-management policy, the scope
 *     their service is asked with;
 *   - what each answers, and what follows it: a cover is cleared only for a
 *     piece deleted at once (a leaving one shows it until it goes), and the
 *     refresh is given the reason for what happened.
 *
 * Harness as media-restore-routes.test.ts: a procedure() shim that applies
 * the route's DECLARED policy, so a 403 here proves what the route asks for.
 * The service and the cover cleanup are stubs; their writes are tested in
 * @codex/admin and @codex/worker-utils.
 */

import type { ServiceRegistry } from '@codex/worker-utils';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

interface Policy {
  auth?: string;
  rateLimit?: string;
  requireOrgMembership?: boolean;
  requireOrgManagement?: boolean;
}

interface ProcedureConfig {
  policy?: Policy;
  input?: { params?: unknown };
  handler: (ctx: unknown) => Promise<unknown>;
}

const ORG_ID = '3c333333-3333-4333-8333-333333333999';
const PIECE = '3c333333-3333-4333-8333-3333333330a1';

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  /** The caller's role in the org the request names, if any. */
  orgRole: null as string | null,
  services: {} as Record<string, unknown>,
  policies: [] as Array<Policy | undefined>,
  background: [] as Promise<unknown>[],
}));

const cleanupContentThumbnailOnDelete = vi.hoisted(() =>
  vi.fn(
    (
      _images: unknown,
      _contentId: string,
      _creatorId: string,
      _obs?: unknown
    ) => Promise.resolve()
  )
);

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
    cleanupContentThumbnailOnDelete,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: { param: () => Record<string, string> };
        json: (body: unknown, status?: number) => Response;
      }) => {
        state.policies.push(config.policy);
        const fail = (status: number, code: string) =>
          c.json({ error: { code, message: code } }, status);

        const policy = config.policy ?? {};
        if (!state.user) return fail(401, 'UNAUTHORIZED');
        if (
          policy.auth === 'platform_owner' &&
          state.user.role !== 'platform_owner'
        ) {
          return fail(403, 'FORBIDDEN');
        }
        if (policy.requireOrgMembership && !state.orgRole) {
          return fail(403, 'FORBIDDEN');
        }
        if (
          policy.requireOrgManagement &&
          !['owner', 'admin'].includes(state.orgRole ?? '')
        ) {
          return fail(403, 'FORBIDDEN');
        }
        const schema = config.input?.params as {
          safeParse: (v: unknown) => { success: boolean; data?: unknown };
        };
        const parsed = schema.safeParse(c.req.param());
        if (!parsed.success) return fail(400, 'VALIDATION_ERROR');

        try {
          const result = await config.handler({
            user: state.user,
            organizationId: ORG_ID,
            input: { params: parsed.data },
            services: state.services,
            obs: undefined,
            executionCtx: { waitUntil: () => undefined },
            background: (promise: Promise<unknown>) => {
              state.background.push(promise);
            },
          });
          return c.json({ data: result }, 200);
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

const PLATFORM_OWNER = { id: 'support_user', role: 'platform_owner' };
const ORG_ADMIN = { id: 'org_admin_user', role: 'creator' };
const CREATOR = { id: 'creator_user', role: 'creator' };

/** Typed by the service's own methods, so a mock the service outgrew fails typecheck. */
type AdminContent = ServiceRegistry['adminContent'];
let adminContent: {
  deleteContent: Mock<AdminContent['deleteContent']>;
  keepContent: Mock<AdminContent['keepContent']>;
  takedownContent: Mock<AdminContent['takedownContent']>;
  refreshAfterChange: Mock<AdminContent['refreshAfterChange']>;
};

beforeEach(() => {
  adminContent = {
    deleteContent: vi.fn(),
    keepContent: vi.fn(),
    takedownContent: vi.fn().mockResolvedValue({
      holders: 3,
      organizationId: ORG_ID,
      creatorId: CREATOR.id,
    }),
    refreshAfterChange: vi.fn().mockResolvedValue(undefined),
  };
  state.services = { adminContent, imageProcessing: {} };
  state.policies = [];
  state.background = [];
  cleanupContentThumbnailOnDelete.mockClear();
});

function call(method: 'DELETE' | 'POST', path: string) {
  return app.request(
    `http://localhost/api/admin/content/${PIECE}${path}?organizationId=${ORG_ID}`,
    { method },
    { ENVIRONMENT: 'test', CACHE_KV: {} },
    {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext
  );
}

// Each spy is read by the arguments that matter, never printed whole.

/** The reason each refresh was given. */
const refreshReasons = () =>
  adminContent.refreshAfterChange.mock.calls.map((args) => args[1]);

/** The piece each cover cleanup was for. */
const coversCleared = () =>
  cleanupContentThumbnailOnDelete.mock.calls.map((args) => args[1]);

describe('POST /api/admin/content/:contentId/takedown', () => {
  const takedown = () => call('POST', '/takedown');

  it('anonymous 401, a creator and an org admin 403, the platform owner 200', async () => {
    state.user = null;
    expect((await takedown()).status).toBe(401);
    state.user = CREATOR;
    state.orgRole = null;
    expect((await takedown()).status).toBe(403);
    // An org's own admin may delete its pieces with notice, never take one
    // down at once.
    state.user = ORG_ADMIN;
    state.orgRole = 'admin';
    expect((await takedown()).status).toBe(403);
    expect(adminContent.takedownContent.mock.calls).toEqual([]);

    state.user = PLATFORM_OWNER;
    state.orgRole = null;
    const res = await takedown();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { holders: 3 } });
    expect(adminContent.takedownContent.mock.calls).toEqual([[PIECE]]);
    expect(coversCleared()).toEqual([PIECE]);
    expect(refreshReasons()).toEqual(['content_deleted']);
  });

  it('declares platform_owner, no org policy and the strict limit', async () => {
    state.user = PLATFORM_OWNER;
    await takedown();

    expect(state.policies).toEqual([
      { auth: 'platform_owner', rateLimit: 'strict' },
    ]);
  });
});

describe('DELETE /api/admin/content/:contentId', () => {
  beforeEach(() => {
    state.user = ORG_ADMIN;
    state.orgRole = 'admin';
  });

  it('is an org owner or admin’s: a creator on the team is refused', async () => {
    state.orgRole = 'creator';

    expect((await call('DELETE', '')).status).toBe(403);
    expect(adminContent.deleteContent.mock.calls).toEqual([]);
    expect(state.policies).toEqual([
      {
        auth: 'required',
        requireOrgMembership: true,
        requireOrgManagement: true,
      },
    ]);
  });

  it('answers a held piece’s date and keeps its cover', async () => {
    const leavesAt = '2031-03-31T12:00:00.000Z';
    // The org's delete started the leave: its side alone holds it.
    adminContent.deleteContent.mockResolvedValue({
      outcome: 'leaving',
      leavesAt: new Date(leavesAt),
      holders: 2,
      started: true,
      leavingByCreator: false,
      leavingByOrg: true,
      creatorId: CREATOR.id,
    });

    const res = await call('DELETE', '');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        outcome: 'leaving',
        leavesAt,
        holders: 2,
        started: true,
        leavingByCreator: false,
        leavingByOrg: true,
      },
    });
    expect(adminContent.deleteContent.mock.calls).toEqual([[ORG_ID, PIECE]]);
    expect(coversCleared()).toEqual([]);
    expect(refreshReasons()).toEqual(['content_leaving']);
  });

  it('clears the cover of a piece deleted at once', async () => {
    adminContent.deleteContent.mockResolvedValue({
      outcome: 'deleted',
      leavesAt: null,
      holders: 0,
      creatorId: CREATOR.id,
    });

    const res = await call('DELETE', '');

    expect(await res.json()).toEqual({
      data: { outcome: 'deleted', leavesAt: null, holders: 0 },
    });
    expect(
      cleanupContentThumbnailOnDelete.mock.calls.map((args) => [
        args[1],
        args[2],
      ])
    ).toEqual([[PIECE, CREATOR.id]]);
    expect(refreshReasons()).toEqual(['content_deleted']);
  });
});

describe('POST /api/admin/content/:contentId/keep', () => {
  beforeEach(() => {
    state.user = ORG_ADMIN;
    state.orgRole = 'admin';
  });

  it('declares the org-management policy, and asks with the org', async () => {
    adminContent.keepContent.mockResolvedValue({
      kept: true,
      staying: 1,
      stillLeavingBy: null,
    });

    const res = await call('POST', '/keep');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { kept: true, staying: 1, stillLeavingBy: null },
    });
    expect(adminContent.keepContent.mock.calls).toEqual([[ORG_ID, PIECE]]);
    expect(state.policies).toEqual([
      {
        auth: 'required',
        requireOrgMembership: true,
        requireOrgManagement: true,
      },
    ]);
    expect(refreshReasons()).toEqual(['content_kept']);
  });

  it('refreshes nothing for a piece that was not leaving', async () => {
    adminContent.keepContent.mockResolvedValue({
      kept: false,
      staying: 0,
      stillLeavingBy: null,
    });

    await call('POST', '/keep');

    expect(refreshReasons()).toEqual([]);
  });

  it('passes on the refusal of a leave its creator started', async () => {
    // LeaveNotYoursError's shape, as the shim maps it.
    adminContent.keepContent.mockRejectedValue(
      Object.assign(new Error('Its creator deleted this'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      })
    );

    expect((await call('POST', '/keep')).status).toBe(403);
    expect(refreshReasons()).toEqual([]);
  });

  it('refuses a creator on the team', async () => {
    state.orgRole = 'creator';

    expect((await call('POST', '/keep')).status).toBe(403);
    expect(adminContent.keepContent.mock.calls).toEqual([]);
  });
});
