/**
 * `enforcePolicyInline` hands a WORKING `waitUntil` to both org caches
 * (Codex-345hg).
 *
 * `org-slug-cache.test.ts` proves org-helpers uses the parameter when it is
 * given one, and `procedure-cache-control.test.ts` proves `ctx.cacheWrite`
 * reaches the runtime. Neither proves the wire between them, and that wire is
 * the whole defect: `extractOrganizationFromSubdomain(hostname, env, obs)` and
 * `checkOrganizationMembership(orgId, userId, env, obs)` take `env`, not a Hono
 * context, so on the pre-fix tree there was no path by which either could reach
 * a `waitUntil` — the parameter can exist and be threaded from nowhere, and
 * every test in both other files would still pass.
 *
 * So these assertions are specifically about the CALL `enforcePolicyInline`
 * makes: that a function arrived in the new slot, and that invoking it lands on
 * this request's `executionCtx.waitUntil`.
 */
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth-middleware', () => ({
  createSessionMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
      return undefined;
    },
}));

// Both org helpers are dynamically imported inside enforcePolicyInline; vi.mock
// intercepts those too. Stubbed here so the arguments they RECEIVE are what is
// under test.
//
// `importOriginal` rather than a closed factory, for two reasons. First,
// `membershipCacheKey` must be the REAL builder: a hand-written
// `membership:${orgId}:${userId}` here would keep passing if the production key
// format changed — the same drift that let `invalidateMembershipCache` bump a
// key nobody read for three months (Codex-rxjwp). Second, a closed factory
// breaks the moment the module gains an export, and names only the first
// missing one. Only the two functions under test are stubbed.
vi.mock('../org-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../org-helpers')>()),
  extractOrganizationFromSubdomain: vi.fn(),
  checkOrganizationMembership: vi.fn(),
}));

vi.mock('@codex/security', () => ({
  workerAuth: vi.fn(),
  RATE_LIMIT_PRESETS: {
    api: {
      store: 'binding',
      maxRequests: 100,
      periodSeconds: 60,
      bindingName: 'RATE_LIMIT_API',
      keyPrefix: 'rl:api:',
    },
  },
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
    return undefined;
  },
  combineSubjects: () => () => null,
  sessionSubject: () => () => null,
  trustedIpSubject: () => () => null,
}));

vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(),
  schema: { organizationMemberships: { userId: 'userId-col-sentinel' } },
}));

import { enforcePolicyInline } from '../helpers';
import {
  checkOrganizationMembership,
  extractOrganizationFromSubdomain,
} from '../org-helpers';

const ORG_ID = '22222222-2222-4222-8222-222222222222';

type CacheWrite = (promise: Promise<unknown>) => void;

/**
 * A context with the pieces `enforcePolicyInline` touches. `hasExecutionCtx:
 * false` reproduces a hand-mocked unit-test context — the shape the guard in
 * `cacheWriteFor` exists for.
 */
function makeCtx(opts: { hasExecutionCtx?: boolean } = {}) {
  const waitUntil = vi.fn<(p: Promise<unknown>) => void>();
  const vars: Record<string, unknown> = { user: { id: 'u1', role: 'user' } };
  const headers: Record<string, string> = { host: 'acme.revelations.studio' };

  const base = {
    req: {
      header(name?: string) {
        return name === undefined ? headers : headers[name.toLowerCase()];
      },
      param(name?: string) {
        return name === undefined ? {} : undefined;
      },
      query(name?: string) {
        return name === undefined ? {} : undefined;
      },
    },
    env: {},
    get: (key: string) => vars[key],
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    header: vi.fn(),
  };

  const c = (opts.hasExecutionCtx === false
    ? base
    : { ...base, executionCtx: { waitUntil } }) as unknown as Context<HonoEnv>;

  return { c, waitUntil };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractOrganizationFromSubdomain).mockResolvedValue(ORG_ID);
  vi.mocked(checkOrganizationMembership).mockResolvedValue({
    role: 'owner',
    status: 'active',
    joinedAt: new Date('2026-01-01T00:00:00Z'),
  });
});

describe('enforcePolicyInline · waitUntil reaches the slug -> id cache', () => {
  it('passes a cacheWrite that lands on this request executionCtx', async () => {
    const { c, waitUntil } = makeCtx();

    await enforcePolicyInline(c, {
      auth: 'required',
      requireOrgMembership: true,
    });

    // Argument 4 (index 3) is the new slot; on the pre-fix tree the call had
    // three arguments and this is `undefined`.
    const args = vi.mocked(extractOrganizationFromSubdomain).mock.calls[0];
    const cacheWrite = args?.[3] as CacheWrite | undefined;
    expect(typeof cacheWrite).toBe('function');

    // And it is wired to the RUNTIME, not to a no-op.
    const write = Promise.resolve('kv-put');
    cacheWrite?.(write);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(write);
  });
});

describe('enforcePolicyInline · waitUntil reaches the membership cache', () => {
  it('passes a cacheWrite that lands on this request executionCtx', async () => {
    const { c, waitUntil } = makeCtx();

    await enforcePolicyInline(c, {
      auth: 'required',
      requireOrgMembership: true,
    });

    const args = vi.mocked(checkOrganizationMembership).mock.calls[0];
    const cacheWrite = args?.[4] as CacheWrite | undefined;
    expect(typeof cacheWrite).toBe('function');

    const write = Promise.resolve('kv-put');
    cacheWrite?.(write);
    expect(waitUntil).toHaveBeenCalledWith(write);
  });

  it('the two caches get independently usable handles', async () => {
    const { c, waitUntil } = makeCtx();

    await enforcePolicyInline(c, {
      auth: 'required',
      requireOrgManagement: true,
    });

    const slugWrite = vi.mocked(extractOrganizationFromSubdomain).mock
      .calls[0]?.[3] as CacheWrite | undefined;
    const membershipWrite = vi.mocked(checkOrganizationMembership).mock
      .calls[0]?.[4] as CacheWrite | undefined;

    slugWrite?.(Promise.resolve('a'));
    membershipWrite?.(Promise.resolve('b'));
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });
});

describe('enforcePolicyInline · a context with no ExecutionContext', () => {
  it('does not throw when the handle is invoked', async () => {
    // Hono throws on `c.executionCtx` when there is none, and dozens of unit
    // tests across this repo pass a hand-built context object. A cache write
    // must never be the thing that turns one of those into a 500.
    const { c } = makeCtx({ hasExecutionCtx: false });

    await enforcePolicyInline(c, {
      auth: 'required',
      requireOrgMembership: true,
    });

    const cacheWrite = vi.mocked(extractOrganizationFromSubdomain).mock
      .calls[0]?.[3] as CacheWrite | undefined;
    expect(typeof cacheWrite).toBe('function');

    const write = Promise.resolve('kv-put');
    expect(() => cacheWrite?.(write)).not.toThrow();
    await expect(write).resolves.toBe('kv-put');
  });
});
