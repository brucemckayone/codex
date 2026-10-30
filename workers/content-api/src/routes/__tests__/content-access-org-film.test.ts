/**
 * An org's intro film full stream (Codex-376dl): the public minter and the two
 * org film HLS proxies. The course film routes' twin
 * (content-access-course-films.test.ts), for the film an org's branding holds.
 *
 * WHY. The intro is any media item the creator picked, the media of a paid
 * practice included, so its full HLS stream must never be a public URL. The
 * minter re-runs the eligibility check (in the service) on every press and
 * hands back a 10-minute ORG film token; the org film proxies open only for
 * that token, and only under the org it was minted for. A content token and a
 * course film token are refused here, as an org film token is on their routes.
 *
 * SHAPE. Real `procedure()` and Hono routing, real tokens signed with the test
 * secret; only `ContentAccessService` and its factory are stubbed. The rule
 * itself is pinned in packages/access intro-film.integration.test.ts.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { signFilmToken, signHlsToken, signOrgFilmToken } from '@codex/access';
import { InternalServiceError } from '@codex/service-errors';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-org-film-secret';
const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '1a000000-0000-4000-8000-000000000009';
const COURSE_ID = '2b000000-0000-4000-8000-000000000002';
const MEDIA_ID = '3c000000-0000-4000-8000-000000000004';
const CREATOR_ID = 'creator_films';

const accessSpies = {
  getOrgFilmStream: vi.fn(),
};
const proxySpies = {
  getOrgFilmMasterPlaylist: vi.fn(),
  getFilmMasterPlaylist: vi.fn(),
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

function fakeObs() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** No user middleware: the landing page's visitor is anonymous. */
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
const media = { creatorId: CREATOR_ID, mediaId: MEDIA_ID };

function orgFilmToken(organizationId = ORG_ID, exp = inTenMinutes()) {
  return signOrgFilmToken({ organizationId, ...media, exp }, SECRET);
}

/** The two tokens that open OTHER proxies, minted for the same media. */
async function foreignTokens() {
  const exp = inTenMinutes();
  return {
    content: await signHlsToken({ ...media, exp }, SECRET),
    courseFilm: await signFilmToken(
      { courseId: COURSE_ID, ...media, exp },
      SECRET
    ),
  };
}

beforeEach(() => {
  accessSpies.getOrgFilmStream.mockReset();
  for (const spy of Object.values(proxySpies)) spy.mockReset();
});

describe('GET /api/access/orgs/:organizationId/film/stream — the public minter', () => {
  const minter = (organizationId = ORG_ID) =>
    get(`/orgs/${organizationId}/film/stream`);

  it('asks the service for that org, anonymously, and never caches the answer', async () => {
    const stream = {
      playlistUrl: `https://api.test/api/access/orgs/${ORG_ID}/film/hls/master.m3u8?token=t`,
      expiresAt: '2026-10-29T20:10:00.000Z',
    };
    accessSpies.getOrgFilmStream.mockResolvedValue(stream);

    const res = await minter();

    expect(res.status).toBe(200);
    expect(accessSpies.getOrgFilmStream).toHaveBeenCalledWith({
      organizationId: ORG_ID,
    });
    expect(await res.json()).toEqual({ data: stream });
    // The body is a credential.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers null data, not an error, when the film may only play its preview', async () => {
    accessSpies.getOrgFilmStream.mockResolvedValue(null);

    const res = await minter();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('a failing mint is a 500 error, never a quiet null', async () => {
    accessSpies.getOrgFilmStream.mockRejectedValue(
      new InternalServiceError('Streaming is unavailable')
    );

    const res = await minter();

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('data');
  });

  it('refuses an org id that is not a uuid, before the service', async () => {
    expect((await minter('nope')).status).toBe(400);
    expect(accessSpies.getOrgFilmStream).not.toHaveBeenCalled();
  });
});

describe('GET /api/access/orgs/:organizationId/film/hls/master.m3u8 — the org film master proxy', () => {
  const master = (token: string, organizationId = ORG_ID) =>
    get(
      `/orgs/${organizationId}/film/hls/master.m3u8?token=${encodeURIComponent(token)}`
    );

  it('serves the rewritten master for an org film token minted for this org', async () => {
    proxySpies.getOrgFilmMasterPlaylist.mockResolvedValue('#EXTM3U\n');
    const token = await orgFilmToken();

    const res = await master(token);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('#EXTM3U\n');
    expect(proxySpies.getOrgFilmMasterPlaylist).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      creatorId: CREATOR_ID,
      mediaId: MEDIA_ID,
      token,
    });
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.apple.mpegurl'
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses a content token and a course film token for the same media', async () => {
    const { content, courseFilm } = await foreignTokens();

    expect((await master(content)).status).toBe(403);
    expect((await master(courseFilm)).status).toBe(403);
    expect(proxySpies.getOrgFilmMasterPlaylist).not.toHaveBeenCalled();
    expect(proxySpies.getFilmMasterPlaylist).not.toHaveBeenCalled();
  });

  it("refuses another org's token, an expired one and none at all", async () => {
    const elsewhere = await orgFilmToken(OTHER_ORG_ID);
    const expired = await orgFilmToken(
      ORG_ID,
      Math.floor(Date.now() / 1000) - 1
    );

    expect((await master(elsewhere)).status).toBe(403);
    expect((await master(expired)).status).toBe(403);
    expect((await get(`/orgs/${ORG_ID}/film/hls/master.m3u8`)).status).toBe(
      403
    );
    expect(proxySpies.getOrgFilmMasterPlaylist).not.toHaveBeenCalled();
  });

  it('404s when the master is not in R2', async () => {
    proxySpies.getOrgFilmMasterPlaylist.mockResolvedValue(null);
    expect((await master(await orgFilmToken())).status).toBe(404);
  });
});

describe('GET /api/access/orgs/:organizationId/film/hls/:variant/index.m3u8 — the org film variant proxy', () => {
  const variant = (name: string, token: string, organizationId = ORG_ID) =>
    get(
      `/orgs/${organizationId}/film/hls/${name}/index.m3u8?token=${encodeURIComponent(token)}`
    );

  it("presigns the token's media for its remaining life", async () => {
    proxySpies.getHlsVariantPlaylist.mockResolvedValue('#EXTM3U\n');

    const res = await variant('720p', await orgFilmToken());

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

  it("refuses a rung the transcoder never writes, foreign tokens and another org's token", async () => {
    const { content, courseFilm } = await foreignTokens();

    expect((await variant('originals', await orgFilmToken())).status).toBe(403);
    expect((await variant('720p', content)).status).toBe(403);
    expect((await variant('720p', courseFilm)).status).toBe(403);
    expect(
      (await variant('720p', await orgFilmToken(OTHER_ORG_ID))).status
    ).toBe(403);
    expect(proxySpies.getHlsVariantPlaylist).not.toHaveBeenCalled();
  });
});

describe('the org film proxies log why they refused', () => {
  it("warns on another org's token, and only debugs an expired one", async () => {
    const obs = fakeObs();

    await get(
      `/orgs/${ORG_ID}/film/hls/master.m3u8?token=${encodeURIComponent(await orgFilmToken(OTHER_ORG_ID))}`,
      obs
    );
    expect(obs.warn).toHaveBeenCalledWith('org_film.token_refused', {
      reason: 'org-mismatch',
      organizationId: ORG_ID,
    });

    const expired = await orgFilmToken(
      ORG_ID,
      Math.floor(Date.now() / 1000) - 1
    );
    await get(
      `/orgs/${ORG_ID}/film/hls/master.m3u8?token=${encodeURIComponent(expired)}`,
      obs
    );
    expect(obs.debug).toHaveBeenCalledWith('org_film.token_expired', {
      organizationId: ORG_ID,
    });
  });

  it('names a course film token as a signature refusal: it was signed for the other domain', async () => {
    const obs = fakeObs();
    const { courseFilm } = await foreignTokens();

    await get(
      `/orgs/${ORG_ID}/film/hls/master.m3u8?token=${encodeURIComponent(courseFilm)}`,
      obs
    );
    expect(obs.warn).toHaveBeenCalledWith('org_film.token_refused', {
      reason: 'signature',
      organizationId: ORG_ID,
    });
  });
});
