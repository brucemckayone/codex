/**
 * Deleting an org stales its public content list and topic list in KV
 * (Codex-osuqt review).
 *
 * content-api caches an org's public content list (every filter combination)
 * and its topic list under the org's ID, for up to 2h. Org delete invalidated
 * only its slug-keyed caches, so a deleted org's catalogue went on being
 * served from KV to direct API clients, and listPublic's live-org filter only
 * ran on a miss. The versions are read through VersionedCache's own API, so
 * this file never re-types a key format.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgSpies = {
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

const dbStub = {
  query: {
    organizationMemberships: { findFirst: vi.fn(async () => undefined) },
    organizations: { findFirst: vi.fn(async () => undefined) },
  },
};

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: vi.fn(() => dbStub) };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import { CacheType, VersionedCache } from '@codex/cache';
import { membershipCacheKey } from '@codex/worker-utils';
import organizations from '../organizations';

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
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
  };
}

const ORG_ID = '5d333333-3333-4333-8333-333333333333';
const OWNER = { id: 'owneruser0001', email: 'owner@test.com', role: 'creator' };

let kv: ReturnType<typeof makeKv>;
let testEnv: typeof env;

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', OWNER);
    c.set('session', { id: 'sess_org_delete_cache', userId: OWNER.id });
    await next();
  });
  app.route('/api/organizations', organizations);
  return app;
}

async function dispatchDelete(): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp().fetch(
    new Request(`http://organization-api.test/api/organizations/${ORG_ID}`, {
      method: 'DELETE',
    }),
    testEnv,
    ec
  );
  // Drains the fire-and-forget invalidations before the assertions.
  await waitOnExecutionContext(ec);
  return res;
}

const versionOf = (id: string) =>
  new VersionedCache({ kv: kv as never }).getVersion(id);

beforeEach(() => {
  vi.clearAllMocks();
  kv = makeKv();
  testEnv = {
    ...env,
    ENVIRONMENT: 'test',
    CACHE_KV: kv,
  } as unknown as typeof env;

  // Warm cache: the caller owns the org, so management passes without Neon.
  kv.store.set(
    membershipCacheKey(ORG_ID, OWNER.id),
    JSON.stringify({
      role: 'owner',
      status: 'active',
      joinedAt: '2026-01-01T00:00:00.000Z',
    })
  );
  orgSpies.get.mockResolvedValue({ id: ORG_ID, slug: 'doomed-org' });
  orgSpies.delete.mockResolvedValue(undefined);
});

describe('DELETE /api/organizations/:id', () => {
  it("stales the deleted org's public content list and topic list", async () => {
    const contentBefore = await versionOf(
      CacheType.COLLECTION_ORG_CONTENT(ORG_ID)
    );
    const topicsBefore = await versionOf(CacheType.CATEGORIES(ORG_ID));

    const res = await dispatchDelete();

    expect(res.status).toBe(204);
    expect(orgSpies.delete).toHaveBeenCalledWith(ORG_ID);
    const contentAfter = await versionOf(
      CacheType.COLLECTION_ORG_CONTENT(ORG_ID)
    );
    const topicsAfter = await versionOf(CacheType.CATEGORIES(ORG_ID));
    expect(contentAfter).not.toBeNull();
    expect(contentAfter).not.toBe(contentBefore);
    expect(topicsAfter).not.toBeNull();
    expect(topicsAfter).not.toBe(topicsBefore);
  });
});
