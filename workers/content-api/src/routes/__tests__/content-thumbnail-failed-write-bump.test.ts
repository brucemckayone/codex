/**
 * POST /:id/thumbnail bumps the org content version even when the upload
 * throws (Codex-kk9nv.16).
 *
 * A still write can commit and still report failure (a COMMIT whose ack was
 * lost). `writeNewStill` then finds the row naming the new folder, deletes the
 * folder it replaced, and rethrows. A bump placed after the await never ran on
 * that path, so cached content lists and details kept the replaced URL: a
 * broken image until their TTL. The bump is in a `.finally()`; this pins it.
 *
 * TEST SHAPE mirrors `content-publish-invalidation.test.ts`: the real
 * `multipartProcedure()` and cache plumbing run against the test CACHE_KV
 * binding, the router is driven through `app.fetch()` with a real
 * `ExecutionContext` so the `waitUntil` bump drains, and the content and image
 * services are spies.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    contentId: `2c000000-0000-4000-8000-000000001${n}`,
    orgId: `3c111111-1111-4111-8111-111111112${n}`,
  };
}

const contentSpies = { get: vi.fn(), setCache: vi.fn() };
const imageSpies = { processContentThumbnail: vi.fn() };

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return { ...actual, ContentService: vi.fn(() => contentSpies) };
});

vi.mock('@codex/image-processing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/image-processing')>();
  return { ...actual, ImageProcessingService: vi.fn(() => imageSpies) };
});

// `bumpOrgContentVersion` resolves the org's slug for the slug-keyed caches.
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizations: {
          findFirst: vi.fn(async () => ({ slug: 'thumbnail-bump-org' })),
        },
      },
    })),
  };
});

// Below the mocks on purpose: the real service registry must resolve the
// mocked classes.
import content from '../content';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE: env.R2_PUBLIC_URL_BASE ?? 'https://cdn.codex.test',
} as unknown as typeof env;

function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}

async function uploadThumbnail(contentId: string): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/content', content);

  const form = new FormData();
  form.append(
    'thumbnail',
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'a.jpg', {
      type: 'image/jpeg',
    })
  );
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/content/${contentId}/thumbnail`, {
      method: 'POST',
      body: form,
    }),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const contentVersion = (orgId: string) => `cache:version:org:${orgId}:content`;

describe('POST /:id/thumbnail bumps the org content version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('when the upload succeeds', async () => {
    const { contentId, orgId } = freshIds();
    contentSpies.get.mockResolvedValue({
      id: contentId,
      organizationId: orgId,
    });
    imageSpies.processContentThumbnail.mockResolvedValue({
      url: 'https://cdn.codex.test/x/lg.webp',
      size: 4,
      mimeType: 'image/webp',
    });

    const res = await uploadThumbnail(contentId);

    expect(res.status).toBe(200);
    expect(await cacheKv().get(contentVersion(orgId))).not.toBeNull();
  });

  it('when the write reports failure, and the error still reaches the caller', async () => {
    const { contentId, orgId } = freshIds();
    contentSpies.get.mockResolvedValue({
      id: contentId,
      organizationId: orgId,
    });
    imageSpies.processContentThumbnail.mockRejectedValue(
      new Error('Connection terminated')
    );

    // Nothing has staled this org yet, so the key's presence below means the
    // bump ran.
    expect(await cacheKv().get(contentVersion(orgId))).toBeNull();

    const res = await uploadThumbnail(contentId);

    expect(res.status).toBe(500);
    expect(await cacheKv().get(contentVersion(orgId))).not.toBeNull();
  });
});
