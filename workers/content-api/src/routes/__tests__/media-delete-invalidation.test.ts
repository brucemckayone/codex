/**
 * Deleting a media item that is an org's intro film MUST stale that org's
 * public caches (Codex-376dl).
 *
 * The org's public info (`/public/:slug/info`, KV for 4h) carries the intro
 * film's poster and preview URLs. The delete sweeps those files from R2, so
 * a stale slot would offer the landing a chip that plays nothing, for hours,
 * with no log anywhere. `MediaItemService.delete` answers the slugs of the
 * orgs whose intro film it was; this file pins that the route bumps them.
 *
 * SHAPE as `content-publish-invalidation.test.ts`: real `procedure()`, real
 * Hono routing, real Miniflare `CACHE_KV`, and an `ExecutionContext` drained
 * with `waitOnExecutionContext`, because the bump runs inside `waitUntil`.
 * Only `MediaItemService` is stubbed. The assertions read the real version
 * keys out of KV: a version key exists only because a mutation wrote one.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { buildVersionKey, CacheType } from '@codex/cache';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Its own user id: the limiter counts per user, and `singleWorker` shares one
// limiter across files.
const USER = {
  id: 'mediadelinval01',
  email: 'creator@test.com',
  role: 'creator',
};

/** Unique per case: CACHE_KV is a real binding shared across this worker. */
let seq = 0;
function freshIds() {
  seq += 1;
  const n = String(seq).padStart(3, '0');
  return {
    mediaId: `4d000000-0000-4000-8000-000000000${n}`,
    slug: `intro-film-delete-org-${n}`,
  };
}

const mediaSpies = { delete: vi.fn() };

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    MediaItemService: vi.fn(() => mediaSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked class.
import media from '../media';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

async function remove(mediaId: string): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/media', media);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/media/${mediaId}`, {
      method: 'DELETE',
    }),
    testEnv,
    ec
  );
  // MANDATORY: the bump is registered on waitUntil.
  await waitOnExecutionContext(ec);
  return res;
}

/**
 * Narrowed with a THROW: the route skips the bump when the binding is absent,
 * so an unbound namespace would make every `toBeNull()` pass vacuously.
 */
function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}

describe('DELETE /api/media/:id stales the orgs whose intro film it was', () => {
  beforeEach(() => {
    mediaSpies.delete.mockReset();
  });

  it("bumps the org's slug-keyed public caches", async () => {
    const { mediaId, slug } = freshIds();
    mediaSpies.delete.mockResolvedValue({ introFilmOrgSlugs: [slug] });
    expect(await cacheKv().get(buildVersionKey(slug))).toBeNull();

    const res = await remove(mediaId);

    expect(res.status).toBe(204);
    expect(mediaSpies.delete).toHaveBeenCalledWith(mediaId, USER.id);
    // The public info and stats, and the org's creators list.
    expect(await cacheKv().get(buildVersionKey(slug))).not.toBeNull();
    expect(
      await cacheKv().get(
        buildVersionKey(CacheType.COLLECTION_ORG_CREATORS(slug))
      )
    ).not.toBeNull();
  });

  it('bumps no org for media that was nobody’s intro film', async () => {
    const { mediaId, slug } = freshIds();
    mediaSpies.delete.mockResolvedValue({ introFilmOrgSlugs: [] });

    const res = await remove(mediaId);

    expect(res.status).toBe(204);
    expect(await cacheKv().get(buildVersionKey(slug))).toBeNull();
  });
});
