/**
 * The public creators list is cached under its own id,
 * `CacheType.COLLECTION_ORG_CREATORS(slug)`, not under the org's slug
 * (Codex-kk9nv.9).
 *
 * WHY THIS FILE EXISTS. The writer and the reader of that id live in different
 * workers. identity-api bumps `org:{slug}:creators` on every listed member's
 * profile, avatar or account write, and this route reads under it. If the read
 * went back to the bare slug, every identity bump would land on a version no
 * reader asks for and the list would serve the old name and avatar for its 4h
 * TTL. The cache package's own tests pass either way, so the read id is pinned
 * here, at the route: a bump of the creators id must refetch the list.
 *
 * TEST SHAPE mirrors `organizations-cache-headers.test.ts`: the real
 * `procedure()` and cache plumbing run against the test CACHE_KV binding, the
 * router is driven through `app.fetch()` with a real `ExecutionContext` so the
 * cache-aside write drains, and `OrganizationService` is a spy object so no
 * Neon call fires.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
  CacheType,
  invalidateOrgPublicCaches,
  VersionedCache,
} from '@codex/cache';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgSpies = { getPublicCreators: vi.fn() };

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

// Imported AFTER the mock so the real registry resolves the mocked class.
import organizations from '../organizations';

const PAGE = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const testEnv = { ...env, ENVIRONMENT: 'test' } as unknown as typeof env;

function buildApp() {
  const app = new Hono();
  app.route('/api/organizations', organizations);
  return app;
}

async function readCreators(slug: string, query = ''): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp().fetch(
    new Request(
      `http://organization-api.test/api/organizations/public/${slug}/creators${query}`
    ),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const cache = () =>
  new VersionedCache({ kv: env.CACHE_KV as unknown as KVNamespace });

// A slug per case: CACHE_KV is shared across the file's tests.
let n = 0;
const freshSlug = () => `creators-cache-${Date.now()}-${n++}`;

beforeEach(() => {
  vi.clearAllMocks();
  orgSpies.getPublicCreators.mockResolvedValue(PAGE);
});

describe('GET /public/:slug/creators reads under the creators id', () => {
  it('serves a repeat read from the cache', async () => {
    const slug = freshSlug();

    expect((await readCreators(slug)).status).toBe(200);
    expect((await readCreators(slug)).status).toBe(200);

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(1);
  });

  it("refetches after a bump of the creators id, which is what a member's profile write sends", async () => {
    const slug = freshSlug();
    await readCreators(slug);

    await cache().invalidate(CacheType.COLLECTION_ORG_CREATORS(slug));
    await readCreators(slug);

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(2);
  });

  it('refetches after a change to the org or its membership', async () => {
    const slug = freshSlug();
    await readCreators(slug);

    await invalidateOrgPublicCaches(cache(), slug);
    await readCreators(slug);

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(2);
  });
});

// Codex-pd8m1: the search palette's creators search. Every typed term would be
// its own KV slot, so a search reads the database, as the content lists do.
describe('GET /public/:slug/creators?search=', () => {
  it('passes the search to the service and never serves it from the cache', async () => {
    const slug = freshSlug();

    await readCreators(slug, '?search=priya&limit=5');
    await readCreators(slug, '?search=priya&limit=5');

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(2);
    expect(orgSpies.getPublicCreators).toHaveBeenCalledWith(slug, {
      page: 1,
      limit: 5,
      search: 'priya',
    });
  });

  it('writes no slot an unsearched read would then serve', async () => {
    const slug = freshSlug();

    await readCreators(slug, '?search=priya');
    await readCreators(slug);

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(2);
    expect(orgSpies.getPublicCreators).toHaveBeenLastCalledWith(slug, {
      page: 1,
      limit: 20,
    });
  });

  it('reads a blank search as none, from the cache', async () => {
    const slug = freshSlug();

    await readCreators(slug, '?search=%20%20');
    await readCreators(slug);

    expect(orgSpies.getPublicCreators).toHaveBeenCalledTimes(1);
  });
});
