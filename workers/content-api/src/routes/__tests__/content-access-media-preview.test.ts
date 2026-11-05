/**
 * A creator's preview of their own media (Codex-a6ofh.1.5): the minter
 * (`GET /api/media/:id/preview`) and the two preview HLS proxies.
 *
 * WHY. The library plays any of the creator's media, the media of paid
 * content included, so its full HLS stream must never be open to anyone else.
 * The minter reads the media creator-scoped (in the service) and hands back a
 * 15-minute PREVIEW token; the preview proxies open only for that token, and
 * only under the media it was minted for. A content token and either film
 * token are refused here, as a preview token is on their routes: four kinds
 * share one secret, and the token domain is what keeps them apart.
 *
 * SHAPE. Real `procedure()` and Hono routing, real tokens signed with the test
 * secret; only `ContentAccessService` and its factory are stubbed. The scoping
 * itself is pinned in packages/access media-preview.integration.test.ts.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import {
  MediaNotFoundError,
  signFilmToken,
  signHlsToken,
  signMediaPreviewToken,
  signOrgFilmToken,
} from '@codex/access';
import { CACHE_PRESETS } from '@codex/constants';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-media-preview-secret';
// Its own user id: the limiter counts per user, and `singleWorker` shares one
// limiter across files.
const USER = {
  id: 'mediapreviewroutes01',
  email: 'creator@test.com',
  role: 'creator',
};
const MEDIA_ID = '5e000000-0000-4000-8000-000000000001';
const OTHER_MEDIA_ID = '5e000000-0000-4000-8000-000000000009';
const CONTENT_ID = '6f000000-0000-4000-8000-000000000002';
const COURSE_ID = '7a000000-0000-4000-8000-000000000003';
const ORG_ID = '8b000000-0000-4000-8000-000000000004';

const accessSpies = {
  getMediaPreviewStream: vi.fn(),
};
const proxySpies = {
  getMediaPreviewMasterPlaylist: vi.fn(),
  getHlsMasterPlaylist: vi.fn(),
  getFilmMasterPlaylist: vi.fn(),
  getOrgFilmMasterPlaylist: vi.fn(),
  getHlsVariantPlaylist: vi.fn(),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    ContentAccessService: vi.fn(() => accessSpies),
    createContentAccessService: vi.fn(() => ({
      service: proxySpies,
      cleanup: async () => {},
    })),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so these stay after `vi.mock` and the routes resolve
// the mocked service.
import contentAccess from '../content-access';
import media from '../media';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  WORKER_SHARED_SECRET: SECRET,
} as unknown as typeof env;

function fakeObs() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function get(
  path: string,
  {
    signedIn = false,
    obs,
  }: { signedIn?: boolean; obs?: ReturnType<typeof fakeObs> } = {}
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (obs) c.set('obs', obs);
    if (signedIn) {
      c.set('user', USER);
      c.set('session', { id: 'sess_preview', userId: USER.id });
    }
    await next();
  });
  app.route('/api/media', media);
  app.route('/api/access', contentAccess);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test${path}`),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const inTenMinutes = () => Math.floor(Date.now() / 1000) + 600;
const owned = { creatorId: USER.id, mediaId: MEDIA_ID };

function previewToken(mediaId = MEDIA_ID, exp = inTenMinutes()) {
  return signMediaPreviewToken({ creatorId: USER.id, mediaId, exp }, SECRET);
}

/** The three tokens that open OTHER proxies, minted for the same media. */
async function foreignTokens() {
  const exp = inTenMinutes();
  return {
    content: await signHlsToken({ ...owned, exp }, SECRET),
    courseFilm: await signFilmToken(
      { courseId: COURSE_ID, ...owned, exp },
      SECRET
    ),
    orgFilm: await signOrgFilmToken(
      { organizationId: ORG_ID, ...owned, exp },
      SECRET
    ),
  };
}

const masterPath = (mediaId = MEDIA_ID) =>
  `/api/access/media/${mediaId}/hls/master.m3u8`;
const variantPath = (mediaId = MEDIA_ID, variant = '720p') =>
  `/api/access/media/${mediaId}/hls/${variant}/index.m3u8`;
const withToken = (path: string, token: string) =>
  `${path}?token=${encodeURIComponent(token)}`;

beforeEach(() => {
  accessSpies.getMediaPreviewStream.mockReset();
  for (const spy of Object.values(proxySpies)) spy.mockReset();
});

describe('GET /api/media/:id/preview — the minter', () => {
  it("asks for the caller's own media, and never caches the answer", async () => {
    const preview = {
      playlistUrl: `https://api.test${masterPath()}?token=t`,
      waveformUrl: null,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      mediaType: 'video',
      readyVariants: ['720p', '480p'],
    };
    accessSpies.getMediaPreviewStream.mockResolvedValue(preview);

    const res = await get(`/api/media/${MEDIA_ID}/preview`, {
      signedIn: true,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: preview });
    // Creator-scoped by the session's user, never by anything the caller sends.
    expect(accessSpies.getMediaPreviewStream).toHaveBeenCalledWith(
      USER.id,
      MEDIA_ID
    );
    // The body is a credential.
    expect(res.headers.get('Cache-Control')).toBe(CACHE_PRESETS.fresh);
  });

  it('needs a session', async () => {
    const res = await get(`/api/media/${MEDIA_ID}/preview`);
    expect(res.status).toBe(401);
    expect(accessSpies.getMediaPreviewStream).not.toHaveBeenCalled();
  });

  it("answers the service's 404 (not the caller's media) in the error envelope", async () => {
    accessSpies.getMediaPreviewStream.mockRejectedValue(
      new MediaNotFoundError(MEDIA_ID)
    );

    const res = await get(`/api/media/${MEDIA_ID}/preview`, {
      signedIn: true,
    });

    expect(res.status).toBe(404);
    // The same 404 shape as every other /api/media/:id route.
    expect(await res.json()).toMatchObject({
      error: { code: 'NOT_FOUND', details: { mediaItemId: MEDIA_ID } },
    });
  });

  it('refuses an id that is not a uuid before any read', async () => {
    const res = await get('/api/media/not-a-uuid/preview', { signedIn: true });
    expect(res.status).toBe(400);
    expect(accessSpies.getMediaPreviewStream).not.toHaveBeenCalled();
  });
});

describe('GET /api/access/media/:id/hls/master.m3u8 — the preview master proxy', () => {
  it('opens for a preview token minted for this media, and never caches the playlist', async () => {
    proxySpies.getMediaPreviewMasterPlaylist.mockResolvedValue('#EXTM3U\n');
    const token = await previewToken();

    const res = await get(withToken(masterPath(), token));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.apple.mpegurl'
    );
    expect(res.headers.get('Cache-Control')).toBe(CACHE_PRESETS.fresh);
    expect(proxySpies.getMediaPreviewMasterPlaylist).toHaveBeenCalledWith({
      creatorId: USER.id,
      mediaId: MEDIA_ID,
      token,
    });
  });

  it("refuses a preview token minted for ANOTHER media under this one's path", async () => {
    const obs = fakeObs();
    const token = await previewToken(OTHER_MEDIA_ID);

    const res = await get(withToken(masterPath(), token), { obs });

    expect(res.status).toBe(403);
    expect(proxySpies.getMediaPreviewMasterPlaylist).not.toHaveBeenCalled();
    expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
      reason: 'media-mismatch',
      mediaId: MEDIA_ID,
    });
  });

  it('refuses a content token and both film tokens: each signs its own domain', async () => {
    const tokens = await foreignTokens();
    for (const token of Object.values(tokens)) {
      const obs = fakeObs();
      const res = await get(withToken(masterPath(), token), { obs });
      expect(res.status).toBe(403);
      expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
        reason: 'signature',
        mediaId: MEDIA_ID,
      });
    }
    expect(proxySpies.getMediaPreviewMasterPlaylist).not.toHaveBeenCalled();
  });

  it('refuses an expired token, logged as routine (debug, not warn)', async () => {
    const obs = fakeObs();
    const token = await previewToken(
      MEDIA_ID,
      Math.floor(Date.now() / 1000) - 1
    );

    const res = await get(withToken(masterPath(), token), { obs });

    expect(res.status).toBe(403);
    expect(obs.debug).toHaveBeenCalledWith('media_preview.token_expired', {
      mediaId: MEDIA_ID,
    });
    expect(obs.warn).not.toHaveBeenCalled();
  });

  it('refuses a missing token and a path that is not a media id', async () => {
    const obs = fakeObs();
    expect((await get(masterPath(), { obs })).status).toBe(403);
    expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
      reason: 'no-token',
      mediaId: MEDIA_ID,
    });

    const token = await previewToken();
    const bad = await get(withToken(masterPath('not-a-uuid'), token), { obs });
    expect(bad.status).toBe(403);
    expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
      reason: 'bad-path',
    });
    expect(proxySpies.getMediaPreviewMasterPlaylist).not.toHaveBeenCalled();
  });

  it('answers 404 for a playlist missing from R2', async () => {
    proxySpies.getMediaPreviewMasterPlaylist.mockResolvedValue(null);
    const res = await get(withToken(masterPath(), await previewToken()));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/access/media/:id/hls/:variant/index.m3u8 — the preview variant proxy', () => {
  it("presigns this media's rung for the token's remaining life", async () => {
    proxySpies.getHlsVariantPlaylist.mockResolvedValue('#EXTM3U\nseg.ts\n');
    const exp = inTenMinutes();
    const token = await previewToken(MEDIA_ID, exp);

    const res = await get(withToken(variantPath(MEDIA_ID, '128k'), token));

    expect(res.status).toBe(200);
    const [call] = proxySpies.getHlsVariantPlaylist.mock.calls[0] ?? [];
    expect(call).toMatchObject({
      creatorId: USER.id,
      mediaId: MEDIA_ID,
      variant: '128k',
    });
    // The token's remaining ~600 s, never a fixed window past its expiry.
    expect(call.expirySeconds).toBeGreaterThan(590);
    expect(call.expirySeconds).toBeLessThanOrEqual(600);
  });

  it('refuses another media’s token, a foreign kind, and a rung the transcoder never writes', async () => {
    const obs = fakeObs();
    const mismatch = await get(
      withToken(variantPath(), await previewToken(OTHER_MEDIA_ID)),
      { obs }
    );
    expect(mismatch.status).toBe(403);
    expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
      reason: 'media-mismatch',
      mediaId: MEDIA_ID,
    });

    // Every foreign kind, as on the master: this is the route that presigns.
    for (const token of Object.values(await foreignTokens())) {
      const kindObs = fakeObs();
      const res = await get(withToken(variantPath(), token), { obs: kindObs });
      expect(res.status).toBe(403);
      expect(kindObs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
        reason: 'signature',
        mediaId: MEDIA_ID,
      });
    }

    const badRung = await get(
      withToken(variantPath(MEDIA_ID, '9999p'), await previewToken()),
      { obs }
    );
    expect(badRung.status).toBe(403);
    expect(obs.warn).toHaveBeenCalledWith('media_preview.token_refused', {
      reason: 'bad-variant',
    });
    expect(proxySpies.getHlsVariantPlaylist).not.toHaveBeenCalled();
  });
});

describe('a preview token opens no other proxy', () => {
  it('is refused by the content, course film and org film proxies, master and variant', async () => {
    const token = await previewToken();
    const paths = [
      `/api/access/content/${CONTENT_ID}/hls/master.m3u8`,
      `/api/access/content/${CONTENT_ID}/hls/720p/index.m3u8`,
      `/api/access/courses/${COURSE_ID}/films/hls/master.m3u8`,
      `/api/access/courses/${COURSE_ID}/films/hls/720p/index.m3u8`,
      `/api/access/orgs/${ORG_ID}/film/hls/master.m3u8`,
      `/api/access/orgs/${ORG_ID}/film/hls/720p/index.m3u8`,
    ];
    for (const path of paths) {
      const res = await get(withToken(path, token));
      expect(res.status, path).toBe(403);
    }
    for (const spy of Object.values(proxySpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
