/**
 * A content publish MUST reach the slug-keyed org caches.
 *
 * THE GAP THIS CLOSES. `bumpOrgContentVersion` fans a publish out to four
 * version keys — the org content collection, the public topic list, the portal
 * rails, and (via `invalidateOrgSlugCache`) the SLUG-keyed public org reads
 * `/public/:slug/info`, `/stats` and `/creators`. Until now every test asserted
 * that fan-out by calling `cache.invalidate(...)` itself: `journeys-cache.test.ts`
 * literally comments "the write-side invalidation, exactly as
 * `bumpOrgContentVersion` performs it" and then performs it by hand. That pins
 * the cache MECHANISM and says nothing about whether the route still calls it.
 *
 * WHY IT MATTERS NOW. `CACHE_TTL.ORG_PUBLIC_INFO_SECONDS` was raised 30min -> 4h
 * on the explicit argument that invalidation, not TTL, bounds staleness there.
 * That argument is only true while this call survives. Delete the
 * `invalidateOrgSlugCache` line from `bumpOrgContentVersion` and a creator's
 * public content count is wrong for FOUR HOURS instead of thirty minutes — with
 * no error, no failing test, and a cache that looks perfectly healthy. The
 * regression would be silent in exactly the way the whole kgrdp epic was.
 *
 * SHAPE. Real `procedure()` resolver, real Hono routing, real Miniflare
 * `CACHE_KV`, and a genuine `ExecutionContext` drained with
 * `waitOnExecutionContext` — `bumpOrgContentVersion` does all its work inside
 * `waitUntil`, so without that drain this file would pass against a no-op.
 * Only three seams are stubbed: `ContentService` (no Neon), `createDbClient`
 * (so the orgId -> slug resolve returns a known slug), and
 * `invalidateContentAccess` (the per-user library fanout is a separate concern
 * with its own tests). The assertions read the REAL keys out of KV.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Fixtures (valid RFC4122 v4 UUIDs so uuidSchema accepts them) ────────────

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};

/** Unique per case: CACHE_KV is a real binding shared across this worker. */
let seq = 0;
function freshIds() {
  seq += 1;
  const n = String(seq).padStart(3, '0');
  return {
    contentId: `2c000000-0000-4000-8000-000000000${n}`,
    orgId: `3c111111-1111-4111-8111-111111111${n}`,
    slug: `publish-fanout-org-${n}`,
  };
}

const contentSpies = {
  publish: vi.fn(),
  unpublish: vi.fn(),
  // The registry calls setCache() on the constructed instance whenever CACHE_KV
  // is bound (it is, in env=test) — service-registry.ts:431. Same reason
  // public-routes.test.ts carries it.
  setCache: vi.fn(),
};

/** Resolves orgId -> slug for `invalidateOrgSlugCache`. */
let resolvedSlug = '';

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
    // The per-user library fanout is not what this file is about, and it would
    // otherwise issue real `resolveAffectedUsers` queries.
    invalidateContentAccess: vi.fn(async () => undefined),
  };
});

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizations: {
          findFirst: vi.fn(async () => ({ slug: resolvedSlug })),
        },
      },
    })),
  };
});

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked classes.
import content from '../content';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/content', content);
  return app;
}

async function publish(contentId: string): Promise<Response> {
  const app = buildApp();
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/content/${contentId}/publish`, {
      method: 'POST',
    }),
    testEnv,
    ec
  );
  // MANDATORY: every bump is registered on waitUntil.
  await waitOnExecutionContext(ec);
  return res;
}

const versionKey = (id: string) => `cache:version:${id}`;

/**
 * `CACHE_KV` is optional on `HonoEnv` but IS bound in `env=test`. Narrowed here
 * with a THROW rather than `!` or `?.` on purpose: `bumpOrgContentVersion`
 * early-returns when the binding is absent (`if (!organizationId ||
 * !env.CACHE_KV) return`), so an unbound namespace would make every
 * `toBeNull()` below pass vacuously while the fan-out never ran. If the binding
 * is ever dropped from the test env this suite must fail loudly, not quietly
 * agree with itself.
 *
 * Typed off `env` rather than importing `KVNamespace`: the workspace resolves
 * two distinct identities for that name (wrangler's generated env types and
 * `@cloudflare/workers-types`), and annotating with the import fails tsc with
 * "Type 'KVNamespace<string>' is not assignable to type 'KVNamespace<string>'".
 */
function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}

describe('POST /:id/publish fans the version bump out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bumps the SLUG-keyed org cache — the 4h TTL depends on this', async () => {
    const { contentId, orgId, slug } = freshIds();
    resolvedSlug = slug;
    contentSpies.publish.mockResolvedValue({
      id: contentId,
      organizationId: orgId,
    });

    // Nothing has ever staled this org, so absence here is meaningful.
    expect(await cacheKv().get(versionKey(slug))).toBeNull();

    const res = await publish(contentId);
    expect(res.status).toBe(200);

    // THE ASSERTION. A version key exists ONLY because a mutation wrote one —
    // the read path resolves a missing key to BASE_VERSION and never mints one
    // (Codex-kgrdp.5) — so this key's presence proves the route reached
    // `invalidateOrgSlugCache`, which proves `/public/:slug/info`, `/stats` and
    // `/creators` all just went stale.
    expect(await cacheKv().get(versionKey(slug))).not.toBeNull();
  });

  it('bumps the content, topics and portal keys in the same pass', async () => {
    const { contentId, orgId, slug } = freshIds();
    resolvedSlug = slug;
    contentSpies.publish.mockResolvedValue({
      id: contentId,
      organizationId: orgId,
    });

    await publish(contentId);

    // All four keys `bumpOrgContentVersion` names, asserted by their real
    // shapes rather than by spying on the cache. Each one is a public surface
    // whose content-derived counts change on publish.
    await expect(
      cacheKv().get(versionKey(`org:${orgId}:content`))
    ).resolves.not.toBeNull();
    await expect(
      cacheKv().get(versionKey(`categories:org:${orgId}`))
    ).resolves.not.toBeNull();
    await expect(
      cacheKv().get(versionKey(`org:${orgId}:journeys`))
    ).resolves.not.toBeNull();
    await expect(cacheKv().get(versionKey(slug))).resolves.not.toBeNull();
  });

  it('does not bump another org', async () => {
    // Guards the opposite failure: a fan-out keyed on something global would
    // satisfy every assertion above while staling the whole platform.
    const a = freshIds();
    const b = freshIds();
    resolvedSlug = a.slug;
    contentSpies.publish.mockResolvedValue({
      id: a.contentId,
      organizationId: a.orgId,
    });

    await publish(a.contentId);

    expect(await cacheKv().get(versionKey(a.slug))).not.toBeNull();
    expect(await cacheKv().get(versionKey(b.slug))).toBeNull();
    expect(
      await cacheKv().get(versionKey(`org:${b.orgId}:content`))
    ).toBeNull();
  });

  it('publishes content with no org without throwing', async () => {
    // `bumpOrgContentVersion` early-returns on a null organizationId. The route
    // must still succeed — a publish is not conditional on cache plumbing.
    const { contentId } = freshIds();
    resolvedSlug = '';
    contentSpies.publish.mockResolvedValue({
      id: contentId,
      organizationId: null,
    });

    const res = await publish(contentId);
    expect(res.status).toBe(200);
  });
});
