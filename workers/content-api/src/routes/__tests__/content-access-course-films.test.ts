/**
 * A course sales film's full stream (owner P10, "Full film unless it's paid"):
 * the public minter and the two film HLS proxies.
 *
 * WHY. A sales film is any media item, the media of a paid practice included,
 * so its full HLS stream must never be a public URL. The minter re-runs the
 * eligibility check (in the service) on every press and hands back a
 * 10-minute film token; the film proxies open only for that token, and only
 * under the course it was minted for. A content token, minted after a paid
 * access decision, is refused by the film proxies, and a film token by the
 * content proxies, so neither route grants what the other's decision did not.
 *
 * SHAPE. Real `procedure()` and Hono routing, real tokens signed with the
 * test secret; only `ContentAccessService` and its factory are stubbed (no
 * Neon, no R2). The eligibility rule itself is pinned in
 * `packages/access/src/services/__tests__/sales-films.integration.test.ts`.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { signFilmToken, signHlsToken } from '@codex/access';
import { InternalServiceError } from '@codex/service-errors';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-film-secret';
const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const COURSE_ID = '2b000000-0000-4000-8000-000000000002';
const OTHER_COURSE_ID = '2b000000-0000-4000-8000-000000000003';
const MEDIA_ID = '3c000000-0000-4000-8000-000000000004';
const CREATOR_ID = 'creator_films';

const accessSpies = {
  getCourseFilmStream: vi.fn(),
};
const proxySpies = {
  getFilmMasterPlaylist: vi.fn(),
  getHlsMasterPlaylist: vi.fn(),
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
// across a statement, so this stays after `vi.mock` and the routes resolve
// the mocked service.
import contentAccess from '../content-access';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  WORKER_SHARED_SECRET: SECRET,
} as unknown as typeof env;

/** What the observability middleware would have set, as spies. */
function fakeObs() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * No user middleware: the sales page's visitor is anonymous. `obs` stands in
 * for the worker's observability middleware, for the proxy tests that read
 * what was logged.
 */
function buildApp(obs?: ReturnType<typeof fakeObs>) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  if (obs) {
    app.use('*', async (c, next) => {
      c.set('obs', obs);
      await next();
    });
  }
  app.route('/api/access', contentAccess);
  return app;
}

async function get(
  path: string,
  obs?: ReturnType<typeof fakeObs>
): Promise<Response> {
  return buildApp(obs).fetch(
    new Request(`http://content-api.test/api/access${path}`),
    testEnv,
    createExecutionContext()
  );
}

const inTenMinutes = () => Math.floor(Date.now() / 1000) + 600;

function filmToken(courseId = COURSE_ID): Promise<string> {
  return signFilmToken(
    { courseId, creatorId: CREATOR_ID, mediaId: MEDIA_ID, exp: inTenMinutes() },
    SECRET
  );
}

beforeEach(() => {
  accessSpies.getCourseFilmStream.mockReset();
  for (const spy of Object.values(proxySpies)) spy.mockReset();
});

describe('GET /api/access/courses/:courseId/films/:film/stream — the public minter', () => {
  const minter = (film: string, query = `?organizationId=${ORG_ID}`) =>
    get(`/courses/${COURSE_ID}/films/${film}/stream${query}`);

  it('asks the service for that org, course and film, anonymously, and never caches the answer', async () => {
    const stream = {
      playlistUrl:
        'https://api.test/api/access/courses/x/films/hls/master.m3u8?token=t',
      expiresAt: '2026-10-28T10:10:00.000Z',
    };
    accessSpies.getCourseFilmStream.mockResolvedValue(stream);

    const res = await minter('intro');

    expect(res.status).toBe(200);
    expect(accessSpies.getCourseFilmStream).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      courseId: COURSE_ID,
      film: 'intro',
    });
    expect(await res.json()).toEqual({ data: stream });
    // The body is a credential.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers null data, not an error, when the film may only play its preview', async () => {
    accessSpies.getCourseFilmStream.mockResolvedValue(null);

    const res = await minter('reel');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('a failing mint is a 500 error, never a quiet null', async () => {
    accessSpies.getCourseFilmStream.mockRejectedValue(
      new InternalServiceError('Streaming is unavailable')
    );

    const res = await minter('intro');

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('data');
  });

  it('refuses a film that is not one a press can ask for, and a missing org, before the service', async () => {
    expect((await minter('hero')).status).toBe(400);
    expect((await minter('guide', '')).status).toBe(400);
    expect((await minter('intro', '?organizationId=nope')).status).toBe(400);
    expect(accessSpies.getCourseFilmStream).not.toHaveBeenCalled();
  });
});

describe('GET /api/access/courses/:courseId/films/hls/master.m3u8 — the film master proxy', () => {
  const master = (token: string, courseId = COURSE_ID) =>
    get(
      `/courses/${courseId}/films/hls/master.m3u8?token=${encodeURIComponent(token)}`
    );

  it('serves the rewritten master for a film token minted for this course', async () => {
    proxySpies.getFilmMasterPlaylist.mockResolvedValue('#EXTM3U\n');
    const token = await filmToken();

    const res = await master(token);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
    expect(proxySpies.getFilmMasterPlaylist).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      creatorId: CREATOR_ID,
      mediaId: MEDIA_ID,
      token,
    });
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.apple.mpegurl'
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses a CONTENT token: a paid stream credential opens no film route', async () => {
    const contentToken = await signHlsToken(
      { creatorId: CREATOR_ID, mediaId: MEDIA_ID, exp: inTenMinutes() },
      SECRET
    );

    expect((await master(contentToken)).status).toBe(403);
    expect(proxySpies.getFilmMasterPlaylist).not.toHaveBeenCalled();
  });

  it("refuses another course's film token, an expired one and none at all", async () => {
    const elsewhere = await filmToken(OTHER_COURSE_ID);
    const expired = await signFilmToken(
      {
        courseId: COURSE_ID,
        creatorId: CREATOR_ID,
        mediaId: MEDIA_ID,
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      SECRET
    );

    expect((await master(elsewhere)).status).toBe(403);
    expect((await master(expired)).status).toBe(403);
    expect(
      (await get(`/courses/${COURSE_ID}/films/hls/master.m3u8`)).status
    ).toBe(403);
    expect(proxySpies.getFilmMasterPlaylist).not.toHaveBeenCalled();
  });

  it('404s when the master is not in R2', async () => {
    proxySpies.getFilmMasterPlaylist.mockResolvedValue(null);
    expect((await master(await filmToken())).status).toBe(404);
  });
});

describe('GET /api/access/courses/:courseId/films/hls/:variant/index.m3u8 — the film variant proxy', () => {
  const variant = (name: string, token: string, courseId = COURSE_ID) =>
    get(
      `/courses/${courseId}/films/hls/${name}/index.m3u8?token=${encodeURIComponent(token)}`
    );

  it("presigns the token's media for its remaining life", async () => {
    proxySpies.getHlsVariantPlaylist.mockResolvedValue('#EXTM3U\n');

    const res = await variant('720p', await filmToken());

    expect(res.status).toBe(200);
    const [input] = proxySpies.getHlsVariantPlaylist.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      creatorId: CREATOR_ID,
      mediaId: MEDIA_ID,
      variant: '720p',
    });
    expect(input.expirySeconds).toBeGreaterThan(590);
    expect(input.expirySeconds).toBeLessThanOrEqual(600);
  });

  it("refuses a variant the transcoder never writes, a content token and another course's token", async () => {
    const contentToken = await signHlsToken(
      { creatorId: CREATOR_ID, mediaId: MEDIA_ID, exp: inTenMinutes() },
      SECRET
    );

    expect((await variant('originals', await filmToken())).status).toBe(403);
    expect((await variant('720p', contentToken)).status).toBe(403);
    expect(
      (await variant('720p', await filmToken(OTHER_COURSE_ID))).status
    ).toBe(403);
    expect(proxySpies.getHlsVariantPlaylist).not.toHaveBeenCalled();
  });
});

describe('the content proxies refuse a film token', () => {
  it('a film token is not a content-stream credential', async () => {
    const res = await get(
      `/content/${COURSE_ID}/hls/master.m3u8?token=${encodeURIComponent(await filmToken())}`
    );
    expect(res.status).toBe(403);
    expect(proxySpies.getHlsMasterPlaylist).not.toHaveBeenCalled();
  });
});

/**
 * The content proxies now share their tail (`servePlaylist`, `presignWindow`)
 * with the film proxies, so their own behaviour is pinned here too: a content
 * token still opens its media, under the content id in the path.
 */
describe('the content proxies, on their shared tail', () => {
  const CONTENT_ID = '4d000000-0000-4000-8000-000000000005';
  const contentToken = () =>
    signHlsToken(
      { creatorId: CREATOR_ID, mediaId: MEDIA_ID, exp: inTenMinutes() },
      SECRET
    );

  it('serves the content master for a content token', async () => {
    proxySpies.getHlsMasterPlaylist.mockResolvedValue('#EXTM3U\n');
    const token = await contentToken();

    const res = await get(
      `/content/${CONTENT_ID}/hls/master.m3u8?token=${encodeURIComponent(token)}`
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
    expect(proxySpies.getHlsMasterPlaylist).toHaveBeenCalledWith({
      contentId: CONTENT_ID,
      creatorId: CREATOR_ID,
      mediaId: MEDIA_ID,
      token,
    });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('presigns the content variant for the token’s remaining life, and 404s a missing one', async () => {
    proxySpies.getHlsVariantPlaylist.mockResolvedValueOnce('#EXTM3U\n');
    const token = encodeURIComponent(await contentToken());

    const res = await get(
      `/content/${CONTENT_ID}/hls/480p/index.m3u8?token=${token}`
    );
    expect(res.status).toBe(200);
    const [input] = proxySpies.getHlsVariantPlaylist.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      creatorId: CREATOR_ID,
      mediaId: MEDIA_ID,
      variant: '480p',
    });
    expect(input.expirySeconds).toBeGreaterThan(590);
    expect(input.expirySeconds).toBeLessThanOrEqual(600);

    proxySpies.getHlsVariantPlaylist.mockResolvedValueOnce(null);
    expect(
      (await get(`/content/${CONTENT_ID}/hls/480p/index.m3u8?token=${token}`))
        .status
    ).toBe(404);
  });

  it('floors the presign window at 60s for a token about to expire', async () => {
    proxySpies.getHlsVariantPlaylist.mockResolvedValue('#EXTM3U\n');
    const nearlyGone = await signHlsToken(
      {
        creatorId: CREATOR_ID,
        mediaId: MEDIA_ID,
        exp: Math.floor(Date.now() / 1000) + 5,
      },
      SECRET
    );

    await get(
      `/content/${CONTENT_ID}/hls/480p/index.m3u8?token=${encodeURIComponent(nearlyGone)}`
    );
    const [input] = proxySpies.getHlsVariantPlaylist.mock.calls[0] ?? [];
    expect(input.expirySeconds).toBe(60);
  });
});

/**
 * Every film-proxy refusal is the same 403 to the caller, but the log says
 * which: a broken or forged link warns, routine expiry is debug only.
 */
describe('the film proxies log why they refused', () => {
  const master = (query: string, courseId: string = COURSE_ID) =>
    `/courses/${courseId}/films/hls/master.m3u8${query}`;
  const tokenQuery = async (token: Promise<string> | string) =>
    `?token=${encodeURIComponent(await token)}`;

  async function refusedWith(path: string) {
    const obs = fakeObs();
    const res = await get(path, obs);
    expect(res.status).toBe(403);
    return obs;
  }

  it.each([
    ['malformed', async () => master('?token=not-a-token')],
    [
      'signature',
      async () =>
        master(
          await tokenQuery(
            signHlsToken(
              { creatorId: CREATOR_ID, mediaId: MEDIA_ID, exp: inTenMinutes() },
              SECRET
            )
          )
        ),
    ],
    [
      'course-mismatch',
      async () => master(await tokenQuery(filmToken(OTHER_COURSE_ID))),
    ],
    ['no-token', async () => master('')],
    [
      'bad-path',
      async () => master(await tokenQuery(filmToken()), 'not-a-course'),
    ],
    [
      'bad-variant',
      async () =>
        `/courses/${COURSE_ID}/films/hls/originals/index.m3u8${await tokenQuery(filmToken())}`,
    ],
  ])('%s warns, with its reason', async (reason, path) => {
    const obs = await refusedWith(await path());
    expect(obs.warn).toHaveBeenCalledWith(
      'course_film.token_refused',
      expect.objectContaining({ reason })
    );
  });

  it('a token signed with another secret is a signature refusal', async () => {
    const forged = await signFilmToken(
      {
        courseId: COURSE_ID,
        creatorId: CREATOR_ID,
        mediaId: MEDIA_ID,
        exp: inTenMinutes(),
      },
      'not-the-secret'
    );
    const obs = await refusedWith(master(await tokenQuery(forged)));
    expect(obs.warn).toHaveBeenCalledWith('course_film.token_refused', {
      reason: 'signature',
      courseId: COURSE_ID,
    });
  });

  it('an expired token is routine: debug, and no warning', async () => {
    const expired = await signFilmToken(
      {
        courseId: COURSE_ID,
        creatorId: CREATOR_ID,
        mediaId: MEDIA_ID,
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      SECRET
    );
    const obs = await refusedWith(master(await tokenQuery(expired)));
    expect(obs.warn).not.toHaveBeenCalled();
    expect(obs.debug).toHaveBeenCalledWith('course_film.token_expired', {
      courseId: COURSE_ID,
    });
  });

  it('a good token logs no refusal', async () => {
    proxySpies.getFilmMasterPlaylist.mockResolvedValue('#EXTM3U\n');
    const obs = fakeObs();
    const res = await get(master(await tokenQuery(filmToken())), obs);
    expect(res.status).toBe(200);
    expect(obs.warn).not.toHaveBeenCalled();
    expect(obs.debug).not.toHaveBeenCalled();
  });
});
