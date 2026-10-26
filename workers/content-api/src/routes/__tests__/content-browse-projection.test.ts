/**
 * `GET /api/content/browse` sends the public list's item, not the row
 * (Codex-1bdx0).
 *
 * THE BUG THIS LOCKS. The route is `auth: 'required'`, which is any signed-in
 * account, not only the owner, and it returned `list({ scope: 'browse' })`
 * as-is: whole media_items rows (the original upload's r2Key, the master
 * playlist key, the RunPod job id, the transcoder's free-text error) and the
 * whole organizations row (the payee's primaryConnectAccountUserId), with no
 * URL resolved, so the /explore cards never got the poster as
 * `mediaItem.thumbnailUrl`. It now goes through `toPublicItems`, as the
 * anonymous public list does.
 *
 * SHAPE. Real `procedure()` resolver and Hono routing, as in
 * content-list-pagination.test.ts; only `ContentService` is stubbed (no Neon).
 * The stub returns the WHOLE rows plus columns the schema does not have yet,
 * so this pins the route's copy-by-name whatever the service selects.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'viewer@test.com',
  role: 'customer',
};

const ORG_ID = '3c111111-1111-4111-8111-111111111999';
const R2_PUBLIC_URL_BASE = 'http://localhost:4100';
const THUMB_KEY = 'creator-1/media-thumbnails/media-1/md.webp';
const PREVIEW_KEY = 'creator-1/hls/media-1/preview/preview.m3u8';
const ORIGINAL_KEY = 'creator-1/originals/media-1/media.mp4';
const MASTER_KEY = 'creator-1/hls/media-1/master.m3u8';
const RUNPOD_JOB_ID = 'runpod-job-7f3c91';
const TRANSCODER_ERROR = 'ffmpeg exited 1: moov atom not found in /work/in.mp4';
const PAYEE_USER_ID = 'payeeuser7f3c91';

const contentSpies = {
  list: vi.fn(),
  // The registry calls setCache() on the constructed instance whenever CACHE_KV
  // is bound (it is, in env=test).
  setCache: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
  };
});

// Below the mock on purpose, so the real service registry resolves the mocked
// class (see content-list-pagination.test.ts).
import content from '../content';

/** A browse row as the OLD `list({ scope: 'browse' })` returned it, and more. */
const WHOLE_ROW = {
  id: '4d000000-0000-4000-8000-0000000000c1',
  title: 'Bone Deep',
  slug: 'bone-deep',
  contentType: 'video',
  creator: { id: 'creator-1', name: 'Ada' },
  mediaItem: {
    id: '4d000000-0000-4000-8000-0000000000c2',
    creatorId: 'creator-1',
    status: 'ready',
    r2Key: ORIGINAL_KEY,
    durationSeconds: 1325,
    hlsMasterPlaylistKey: MASTER_KEY,
    hlsPreviewKey: PREVIEW_KEY,
    thumbnailKey: THUMB_KEY,
    runpodJobId: RUNPOD_JOB_ID,
    transcodingError: TRANSCODER_ERROR,
    transcodingErrorCode: 'DECODE_FAILED',
    mezzanineKey: 'creator-1/mezzanine/media-1/mezzanine.mov',
    readyVariants: ['1080p', '720p'],
  },
  organization: {
    id: ORG_ID,
    name: 'Bone Deep Studio',
    slug: 'bone-deep-studio',
    logoUrl: null,
    description: 'An internal description',
    websiteUrl: 'https://bone-deep.example',
    primaryConnectAccountUserId: PAYEE_USER_ID,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
  },
};

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE,
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

async function browse(): Promise<Response> {
  return buildApp().fetch(
    new Request(
      `http://content-api.test/api/content/browse?organizationId=${ORG_ID}`
    ),
    testEnv,
    createExecutionContext()
  );
}

type BrowseBody = {
  items: {
    mediaItem: Record<string, unknown> | null;
    organization: Record<string, unknown> | null;
  }[];
};

describe('GET /api/content/browse sends the public item (Codex-1bdx0)', () => {
  beforeEach(() => {
    contentSpies.list.mockReset();
    contentSpies.list.mockResolvedValue({
      items: [WHOLE_ROW],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('the media item is the three public fields, with the poster and preview resolved to URLs', async () => {
    const res = await browse();

    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseBody;
    expect(body.items[0]?.mediaItem).toEqual({
      durationSeconds: 1325,
      thumbnailUrl: `${R2_PUBLIC_URL_BASE}/${THUMB_KEY}`,
      hlsPreviewUrl: `${R2_PUBLIC_URL_BASE}/${PREVIEW_KEY}`,
    });
  });

  it('the org is id, name, slug and logoUrl only', async () => {
    const body = (await (await browse()).json()) as BrowseBody;

    expect(body.items[0]?.organization).toEqual({
      id: ORG_ID,
      name: 'Bone Deep Studio',
      slug: 'bone-deep-studio',
      logoUrl: null,
    });
  });

  it('no raw key, job id, transcoder text or payee id is anywhere in the body', async () => {
    const text = await (await browse()).text();

    for (const secret of [
      ORIGINAL_KEY,
      MASTER_KEY,
      RUNPOD_JOB_ID,
      TRANSCODER_ERROR,
      'DECODE_FAILED',
      'mezzanine.mov',
      PAYEE_USER_ID,
    ]) {
      expect(text).not.toContain(secret);
    }
    for (const field of [
      'r2Key',
      'thumbnailKey',
      'hlsPreviewKey',
      'hlsMasterPlaylistKey',
      'runpodJobId',
      'transcodingError',
      'transcodingErrorCode',
      'primaryConnectAccountUserId',
      'websiteUrl',
    ]) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
});
