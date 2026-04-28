/**
 * Characterization tests for `enforcePolicyInline`.
 *
 * These tests lock down the observable behavior of the policy-enforcement
 * function before it is refactored into per-phase helpers. Every branch must
 * stay green both before and after the refactor.
 *
 * Covered branches:
 *  - IP whitelist (3 paths)
 *  - auth: 'none' | 'optional' | 'required' | 'worker' | 'platform_owner'
 *  - role-based access control
 *  - org membership resolution (URL param UUID → subdomain → query param)
 *  - org management check (owner/admin only)
 *  - platform-owner bypass of membership check
 */
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ------------------------------------------------------------------
// `createSessionMiddleware` is a static import in helpers.ts — we can mock it
// at module scope. Each test supplies the behavior it needs.
vi.mock('../../auth-middleware', () => ({
  createSessionMiddleware: vi.fn(),
}));

// `./org-helpers` and `@codex/security` and `@codex/database` are dynamic
// imports inside `enforcePolicyInline`. vi.mock intercepts those too.
vi.mock('../org-helpers', () => ({
  extractOrganizationFromSubdomain: vi.fn(),
  checkOrganizationMembership: vi.fn(),
  membershipCacheKey: (orgId: string, userId: string) =>
    `membership:${orgId}:${userId}`,
}));

vi.mock('@codex/security', () => ({
  workerAuth: vi.fn(),
}));

vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(),
  schema: {
    organizationMemberships: {
      userId: 'userId-col-sentinel',
    },
  },
}));

// Import after mocks so that helpers.ts resolves to mocked modules.
import { createSessionMiddleware } from '../../auth-middleware';
import { enforcePolicyInline } from '../helpers';

// Import the mocked modules lazily in each test via `vi.mocked(await import(...))`
// rather than top-level so vitest's hoisting doesn't collide.

// --- Mock Context builder ---------------------------------------------------

interface MockCtxOptions {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  env?: Record<string, unknown>;
  vars?: Record<string, unknown>;
}

function makeCtx(opts: MockCtxOptions = {}): {
  ctx: Context<HonoEnv>;
  vars: Record<string, unknown>;
} {
  const vars: Record<string, unknown> = { ...opts.vars };
  const headers = opts.headers ?? {};
  const params = opts.params ?? {};
  const query = opts.query ?? {};

  const ctx = {
    req: {
      header(name?: string): string | undefined | Record<string, string> {
        if (name === undefined) return headers;
        // Hono is case-insensitive on header names
        const lower = name.toLowerCase();
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === lower) return headers[k];
        }
        return undefined;
      },
      param(name?: string): string | Record<string, string> | undefined {
        return name === undefined ? params : params[name];
      },
      query(name?: string): string | Record<string, string> | undefined {
        return name === undefined ? query : query[name];
      },
    },
    env: opts.env ?? {},
    get(key: string): unknown {
      return vars[key];
    },
    set(key: string, value: unknown): void {
      vars[key] = value;
    },
  } as unknown as Context<HonoEnv>;

  return { ctx, vars };
}

// Helper to build a session middleware that either authenticates a user or
// returns a 401 Response (mimicking the real createSessionMiddleware shape).
function makeSessionMiddleware(opts: {
  user?: Record<string, unknown>;
  session?: Record<string, unknown>;
  authFails?: boolean;
}) {
  return async (c: Context<HonoEnv>, next: () => Promise<void>) => {
    if (opts.authFails) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
      });
    }
    if (opts.user) c.set('user', opts.user as never);
    if (opts.session) c.set('session', opts.session as never);
    await next();
    return undefined;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// IP Whitelist
// ============================================================================
describe('enforcePolicyInline · IP whitelist', () => {
  it('passes when allowedIPs is empty (default)', async () => {
    const { ctx } = makeCtx({ headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'none', allowedIPs: [] })
    ).resolves.toBeUndefined();
  });

  it('passes when client IP is in whitelist', async () => {
    const { ctx } = makeCtx({ headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'none', allowedIPs: ['1.2.3.4'] })
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenError when client IP is not in whitelist', async () => {
    const { ctx } = makeCtx({ headers: { 'CF-Connecting-IP': '9.9.9.9' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'none', allowedIPs: ['1.2.3.4'] })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================================
// Auth: 'none'
// ============================================================================
describe("enforcePolicyInline · auth: 'none'", () => {
  it('returns without any checks', async () => {
    const { ctx } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'none' })
    ).resolves.toBeUndefined();
    expect(createSessionMiddleware).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Auth: 'worker'
// ============================================================================
describe("enforcePolicyInline · auth: 'worker'", () => {
  it('returns immediately when workerAuth flag already set in context', async () => {
    const { ctx } = makeCtx({ vars: { workerAuth: true } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'worker' })
    ).resolves.toBeUndefined();
  });

  it('throws UnauthorizedError when WORKER_SHARED_SECRET is missing', async () => {
    const { ctx } = makeCtx({ env: {} });
    await expect(
      enforcePolicyInline(ctx, { auth: 'worker' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('passes when workerAuth middleware authenticates successfully', async () => {
    const sec = await import('@codex/security');
    vi.mocked(sec.workerAuth).mockReturnValue(
      async (_c: Context, next: () => Promise<void>) => {
        await next();
        return undefined;
      }
    );
    const { ctx } = makeCtx({ env: { WORKER_SHARED_SECRET: 'secret' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'worker' })
    ).resolves.toBeUndefined();
  });

  it('throws UnauthorizedError when workerAuth middleware returns a 401 Response', async () => {
    const sec = await import('@codex/security');
    vi.mocked(sec.workerAuth).mockReturnValue(async () => {
      return new Response(JSON.stringify({ error: 'bad signature' }), {
        status: 401,
      });
    });
    const { ctx } = makeCtx({ env: { WORKER_SHARED_SECRET: 'secret' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'worker' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError when workerAuth middleware rejects', async () => {
    const sec = await import('@codex/security');
    vi.mocked(sec.workerAuth).mockReturnValue(async () => {
      throw new Error('internal boom');
    });
    const { ctx } = makeCtx({ env: { WORKER_SHARED_SECRET: 'secret' } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'worker' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

// ============================================================================
// Auth: 'required'
// ============================================================================
describe("enforcePolicyInline · auth: 'required'", () => {
  it('throws UnauthorizedError when session middleware returns 401', async () => {
    vi.mocked(createSessionMiddleware).mockReturnValue(
      makeSessionMiddleware({ authFails: true })
    );
    const { ctx } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'required' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError when no user is set after middleware', async () => {
    vi.mocked(createSessionMiddleware).mockReturnValue(
      makeSessionMiddleware({}) // no user, no fail
    );
    const { ctx } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'required' })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('passes when session middleware sets a user', async () => {
    vi.mocked(createSessionMiddleware).mockReturnValue(
      makeSessionMiddleware({ user: { id: 'u1', role: 'user' } })
    );
    const { ctx, vars } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'required' })
    ).resolves.toBeUndefined();
    expect(vars.user).toMatchObject({ id: 'u1' });
  });

  it('skips session middleware when user is already in context', async () => {
    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'user' } } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'required' })
    ).resolves.toBeUndefined();
    expect(createSessionMiddleware).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Auth: 'optional'
// ============================================================================
describe("enforcePolicyInline · auth: 'optional'", () => {
  it('passes with no user (session middleware optional-mode)', async () => {
    vi.mocked(createSessionMiddleware).mockReturnValue(
      makeSessionMiddleware({})
    );
    const { ctx } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'optional' })
    ).resolves.toBeUndefined();
  });

  it('passes with user set', async () => {
    vi.mocked(createSessionMiddleware).mockReturnValue(
      makeSessionMiddleware({ user: { id: 'u1', role: 'user' } })
    );
    const { ctx } = makeCtx();
    await expect(
      enforcePolicyInline(ctx, { auth: 'optional' })
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// Auth: 'platform_owner'
// ============================================================================
describe("enforcePolicyInline · auth: 'platform_owner'", () => {
  it('throws ForbiddenError when user role is not platform_owner', async () => {
    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'user' } } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'platform_owner' })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('passes and auto-resolves organizationId from membership for platform_owner', async () => {
    const { createDbClient } = await import('@codex/database');
    vi.mocked(createDbClient).mockReturnValue({
      query: {
        organizationMemberships: {
          findFirst: vi.fn().mockResolvedValue({ organizationId: 'org-42' }),
        },
      },
    } as never);

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'owner-1', role: 'platform_owner' } },
    });
    await expect(
      enforcePolicyInline(ctx, { auth: 'platform_owner' })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe('org-42');
    expect(vars.organizationRole).toBe('platform_owner');
  });

  it('does not overwrite organizationId if already set', async () => {
    const { ctx, vars } = makeCtx({
      vars: {
        user: { id: 'owner-1', role: 'platform_owner' },
        organizationId: 'preset-org',
      },
    });
    await expect(
      enforcePolicyInline(ctx, { auth: 'platform_owner' })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe('preset-org');
  });
});

// ============================================================================
// Role-based access control
// ============================================================================
describe('enforcePolicyInline · roles', () => {
  it('throws ForbiddenError when user role is not in allowed list', async () => {
    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'user' } } });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        roles: ['creator', 'admin'],
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('passes when user role matches allowed list', async () => {
    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'creator' } } });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        roles: ['creator', 'admin'],
      })
    ).resolves.toBeUndefined();
  });

  it('passes when roles is empty (no role requirement)', async () => {
    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'user' } } });
    await expect(
      enforcePolicyInline(ctx, { auth: 'required', roles: [] })
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// Organization membership
// ============================================================================
describe('enforcePolicyInline · requireOrgMembership', () => {
  const UUID_A = '11111111-1111-4111-8111-111111111111';
  const UUID_B = '22222222-2222-4222-8222-222222222222';

  it('resolves org from UUID path param and runs membership check', async () => {
    const { checkOrganizationMembership, extractOrganizationFromSubdomain } =
      await import('../org-helpers');
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'member',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe(UUID_A);
    expect(vars.organizationRole).toBe('member');
    expect(extractOrganizationFromSubdomain).not.toHaveBeenCalled();
  });

  it('falls back to subdomain extraction when no UUID param', async () => {
    const { checkOrganizationMembership, extractOrganizationFromSubdomain } =
      await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(UUID_B);
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      headers: { host: 'acme.revelations.studio' },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe(UUID_B);
  });

  it('falls back to organizationId query param when subdomain yields nothing', async () => {
    const { checkOrganizationMembership, extractOrganizationFromSubdomain } =
      await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(null);
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'member',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      query: { organizationId: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe(UUID_A);
  });

  // ----- Invalid-UUID rejection on query-param path (Codex-d3g6 sub-item 1) -----
  // The query-param fallback must reject malformed UUIDs the same way the path-
  // param fallback does — otherwise an attacker could bypass scope by injecting
  // an arbitrary string. The current implementation falls through to the
  // ValidationError ('ORG_CONTEXT_REQUIRED') when no valid UUID is resolvable.

  it('rejects non-UUID query-param value with ValidationError when no other resolution path', async () => {
    const { extractOrganizationFromSubdomain } = await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(null);

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      query: { organizationId: 'not-a-uuid' },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects numeric-string query-param value (123) with ValidationError', async () => {
    const { extractOrganizationFromSubdomain } = await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(null);

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      query: { organizationId: '123' },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects empty-string query-param value with ValidationError', async () => {
    const { extractOrganizationFromSubdomain } = await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(null);

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      query: { organizationId: '' },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError (ORG_CONTEXT_REQUIRED) when no org can be resolved', async () => {
    const { extractOrganizationFromSubdomain } = await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(null);

    const { ctx } = makeCtx({ vars: { user: { id: 'u1', role: 'user' } } });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ForbiddenError when user is not a member', async () => {
    const { checkOrganizationMembership } = await import('../org-helpers');
    vi.mocked(checkOrganizationMembership).mockResolvedValue(null);

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('skips membership check for platform_owner accessing via UUID param', async () => {
    const { checkOrganizationMembership } = await import('../org-helpers');

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'owner-1', role: 'platform_owner' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).resolves.toBeUndefined();
    expect(checkOrganizationMembership).not.toHaveBeenCalled();
    expect(vars.organizationId).toBe(UUID_A);
    expect(vars.organizationRole).toBe('platform_owner');
  });

  it('ignores non-UUID path param and falls back to subdomain', async () => {
    const { extractOrganizationFromSubdomain, checkOrganizationMembership } =
      await import('../org-helpers');
    vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(UUID_B);
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'member',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx, vars } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: 'not-a-uuid' },
      headers: { host: 'acme.revelations.studio' },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgMembership: true,
      })
    ).resolves.toBeUndefined();
    expect(vars.organizationId).toBe(UUID_B);
  });
});

// ============================================================================
// Organization management
// ============================================================================
describe('enforcePolicyInline · requireOrgManagement', () => {
  const UUID_A = '11111111-1111-4111-8111-111111111111';

  it("throws ForbiddenError when member role is 'member'", async () => {
    const { checkOrganizationMembership } = await import('../org-helpers');
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'member',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgManagement: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("passes when member role is 'owner'", async () => {
    const { checkOrganizationMembership } = await import('../org-helpers');
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgManagement: true,
      })
    ).resolves.toBeUndefined();
  });

  it("passes when member role is 'admin'", async () => {
    const { checkOrganizationMembership } = await import('../org-helpers');
    vi.mocked(checkOrganizationMembership).mockResolvedValue({
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
    });

    const { ctx } = makeCtx({
      vars: { user: { id: 'u1', role: 'user' } },
      params: { id: UUID_A },
    });
    await expect(
      enforcePolicyInline(ctx, {
        auth: 'required',
        requireOrgManagement: true,
      })
    ).resolves.toBeUndefined();
  });
});
