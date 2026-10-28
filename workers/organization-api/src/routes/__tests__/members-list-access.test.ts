/**
 * GET /api/organizations/:id/members is for the people who manage the team
 * (Codex-2hxff.82).
 *
 * The list carries every member's email. It was behind `requireOrgMembership`,
 * which admits ANY active membership, and subscribers hold membership rows
 * (role `subscriber`). So a subscriber could read the whole team's addresses,
 * and so could any creator or member. It is now behind
 * `requireOrgManagement`, as the invite already was. Every web caller was
 * owner or admin only already (Team, Revenue share, the dashboard nudge), so
 * nothing on screen changes.
 *
 * TEST SHAPE mirrors `members-cache-invalidation.test.ts`: the REAL
 * `procedure()` and policy enforcement run on a Hono app at the production
 * mount point. The caller's membership is a warm KV entry, so the policy
 * decides from it without Neon. `OrganizationService` is a spy, so a 200
 * proves the handler ran and a 403 proves it never did.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgSpies = {
  listMembers: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

// A membership missing from KV would fall through to this stub: "not a
// member", never a role this file did not set.
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizationMemberships: { findFirst: vi.fn(async () => undefined) },
        organizations: { findFirst: vi.fn(async () => undefined) },
      },
    })),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import { membershipCacheKey } from '@codex/worker-utils';
import members from '../members';

const ORG_ID = '5d444444-4444-4444-8444-444444444444';
const CALLER = {
  id: 'listcaller01',
  email: 'caller@test.com',
  role: 'creator',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
    store,
  };
}

/** GET the list as a caller whose membership in the org is `role`. */
async function listAs(role: string): Promise<Response> {
  const kv = makeKv();
  kv.store.set(
    membershipCacheKey(ORG_ID, CALLER.id),
    JSON.stringify({ role, status: 'active', joinedAt: '2026-01-01' })
  );
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', CALLER);
    // Its own rate-limit bucket: `singleWorker` shares one limiter.
    c.set('session', { id: 'sess_members_list_access', userId: CALLER.id });
    await next();
  });
  app.route('/api/organizations/:id/members', members);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(
      `http://organization-api.test/api/organizations/${ORG_ID}/members`
    ),
    { ...env, ENVIRONMENT: 'test', CACHE_KV: kv } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  orgSpies.listMembers.mockResolvedValue({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe('GET /members: who can read the team list (Codex-2hxff.82)', () => {
  it.each(['owner', 'admin'])('an %s gets the list', async (role) => {
    const res = await listAs(role);
    expect(res.status).toBe(200);
    expect(orgSpies.listMembers).toHaveBeenCalledTimes(1);
  });

  it.each([
    'creator',
    'member',
    'subscriber',
  ])('a %s is refused before the list is read', async (role) => {
    const res = await listAs(role);
    expect(res.status).toBe(403);
    expect(orgSpies.listMembers).not.toHaveBeenCalled();
  });
});
