/**
 * POST /:id/thumbnail/stage readies a cover for a piece that has been live
 * without applying it (Codex-a6ofh.2.5).
 *
 * The piece's changes wait for Update, so nothing public changes here: the
 * route must stage (never process, which writes the row and deletes the
 * replaced folder) and must not bump the org content version, which would
 * throw away every cached list for a change nobody can see yet.
 *
 * TEST SHAPE mirrors `content-thumbnail-failed-write-bump.test.ts`: the real
 * `multipartProcedure()` runs, the router is driven through `app.fetch()` with
 * a real `ExecutionContext` so any `waitUntil` drains before the KV check, and
 * the content and image services are spies.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This file's own subject. The limiter counts per subject across every file
// in this single-worker run, so a shared id runs past the api preset's 100
// a minute and later files read 429 (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000009',
  email: 'creator@test.com',
  role: 'creator',
};

/** Unique per case: CACHE_KV is a real binding shared across this worker. */
let seq = 0;
function freshIds() {
  seq += 1;
  const n = String(seq).padStart(3, '0');
  return {
    contentId: `2c000000-0000-4000-8000-000000002${n}`,
    orgId: `3c111111-1111-4111-8111-111111113${n}`,
  };
}

// `setCache` is how the service registry wires the cache in.
const contentSpies = { get: vi.fn(), setCache: vi.fn() };
const imageSpies = {
  stageContentThumbnail: vi.fn(),
  processContentThumbnail: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return { ...actual, ContentService: vi.fn(() => contentSpies) };
});

vi.mock('@codex/image-processing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/image-processing')>();
  return { ...actual, ImageProcessingService: vi.fn(() => imageSpies) };
});

// Below the mocks on purpose: the real service registry must resolve the
// mocked classes.
import content from '../content';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  // The registry's image service getter requires it; the service is a spy.
  R2_PUBLIC_URL_BASE: 'https://cdn.codex.test',
} as unknown as typeof env;

function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}

async function stageThumbnail(contentId: string): Promise<Response> {
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
    new Request(
      `http://content-api.test/api/content/${contentId}/thumbnail/stage`,
      { method: 'POST', body: form }
    ),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const contentVersion = (orgId: string) => `cache:version:org:${orgId}:content`;

describe('POST /:id/thumbnail/stage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stages the cover for the owner and returns its URL, with no version bump', async () => {
    const { contentId, orgId } = freshIds();
    contentSpies.get.mockResolvedValue({
      id: contentId,
      organizationId: orgId,
    });
    imageSpies.stageContentThumbnail.mockResolvedValue({
      url: 'https://cdn.codex.test/x/lg.webp',
      size: 4,
      mimeType: 'image/webp',
    });

    const res = await stageThumbnail(contentId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        thumbnailUrl: 'https://cdn.codex.test/x/lg.webp',
        size: 4,
        mimeType: 'image/webp',
      },
    });
    // Ownership is checked as the signed-in creator.
    expect(contentSpies.get).toHaveBeenCalledWith(contentId, USER.id);
    expect(imageSpies.stageContentThumbnail).toHaveBeenCalledWith(
      contentId,
      USER.id,
      expect.any(File)
    );
    expect(imageSpies.processContentThumbnail).not.toHaveBeenCalled();
    expect(await cacheKv().get(contentVersion(orgId))).toBeNull();
  });

  it('refuses a piece the creator does not own, and stages nothing', async () => {
    const { contentId } = freshIds();
    contentSpies.get.mockResolvedValue(null);

    const res = await stageThumbnail(contentId);

    expect(res.status).toBe(404);
    expect(imageSpies.stageContentThumbnail).not.toHaveBeenCalled();
  });
});
