/**
 * The org intro film's two organization-api reads (Codex-376dl).
 *
 * PUBLIC: `/public/:slug/info` (KV cache-aside) and `/public/:slug` (CDN only)
 * both carry `introFilm`, built from `resolveIntroFilm`, the check the
 * content-api minter runs. The landing must never be told a film plays in
 * full when the minter would refuse it, and is never handed the media's id
 * as a field: the minter resolves the film from the org, so nothing public
 * needs it.
 *
 * STUDIO: `GET /:id/settings/branding/intro-video` is for the people who
 * manage the brand. A subscriber holds a membership row too, so the policy is
 * pinned here.
 *
 * TEST SHAPE mirrors `organizations-cache-headers.test.ts` (public) and
 * `members-list-access.test.ts` (studio): the real `procedure()`, policy and
 * cache plumbing run, the caller's membership is a warm KV entry, and the
 * services are spies, so no Neon call fires.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { IntroFilmResolution } from '@codex/access';
import type { StudioIntroFilm } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgSpies = { getBySlug: vi.fn() };
const brandingSpies = { get: vi.fn() };
const featureSpies = { get: vi.fn() };
const accessSpies = { getStudioIntroFilm: vi.fn() };
const resolveSpy = vi.fn();

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return { ...actual, OrganizationService: vi.fn(() => orgSpies) };
});

vi.mock('@codex/platform-settings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/platform-settings')>();
  return {
    ...actual,
    BrandingSettingsService: vi.fn(() => brandingSpies),
    FeatureSettingsService: vi.fn(() => featureSpies),
  };
});

// `toPublicIntroFilm` stays real: the view under test is what these routes
// return, not what a spy returns.
vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    resolveIntroFilm: (...args: unknown[]) => resolveSpy(...args),
    ContentAccessService: vi.fn(() => accessSpies),
  };
});

// A membership missing from KV would fall through to this stub: "not a
// member", never a role this file did not set.
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizationMemberships: { findFirst: vi.fn(async () => undefined) },
        organizations: { findFirst: vi.fn(async () => undefined) },
      },
    })),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import { membershipCacheKey } from '@codex/worker-utils';
import organizations from '../organizations';
import settings from '../settings';

const ORG_ID = '6e555555-5555-4555-8555-555555555555';
const CDN = 'http://localhost:4100';

const FILM = {
  mediaId: '7f666666-6666-4666-8666-666666666666',
  creatorId: 'filmcreator01',
  title: 'Why we teach',
  thumbnailKey: 'filmcreator01/thumbnails/film/md.webp',
  hlsPreviewKey: 'filmcreator01/hls/film/preview/preview.m3u8',
  durationSeconds: 134,
};

const testEnv = {
  ...env,
  ENVIRONMENT: 'test',
  R2_PUBLIC_URL_BASE: CDN,
} as unknown as typeof env;

// A slug per case: CACHE_KV is shared across the file's tests, and `/info`
// would otherwise serve the previous case's film.
let n = 0;
const freshSlug = () => `intro-film-${Date.now()}-${n++}`;

async function readPublic(path: string): Promise<Response> {
  const app = new Hono();
  app.route('/api/organizations', organizations);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://organization-api.test/api/organizations${path}`),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

/** Read the public info of a fresh org whose intro resolves to `answer`. */
async function publicInfo(
  answer: IntroFilmResolution | Error
): Promise<{ status: number; body: { data: { introFilm: unknown } } }> {
  const slug = freshSlug();
  orgSpies.getBySlug.mockResolvedValue({
    id: ORG_ID,
    slug,
    name: 'Studio Alpha',
    description: null,
  });
  if (answer instanceof Error) resolveSpy.mockRejectedValue(answer);
  else resolveSpy.mockResolvedValue(answer);
  const res = await readPublic(`/public/${slug}/info`);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  brandingSpies.get.mockResolvedValue({});
  featureSpies.get.mockResolvedValue({ enableSubscriptions: true });
});

describe('public info: the landing film', () => {
  it('offers an eligible film in full, by CDN poster and preview', async () => {
    const { status, body } = await publicInfo({ ok: true, film: FILM });
    expect(status).toBe(200);
    expect(body.data.introFilm).toEqual({
      title: 'Why we teach',
      posterUrl: `${CDN}/${FILM.thumbnailKey}`,
      previewUrl: `${CDN}/${FILM.hlsPreviewKey}`,
      durationSeconds: 134,
      fullFilm: true,
    });
    expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), ORG_ID);
  });

  it('offers a paid film as its preview only', async () => {
    const { body } = await publicInfo({
      ok: false,
      reason: 'paid-use',
      film: FILM,
    });
    expect(body.data.introFilm).toMatchObject({ fullFilm: false });
  });

  it('offers no film when the pick is refused', async () => {
    const { body } = await publicInfo({
      ok: false,
      reason: 'creator-not-member',
      film: FILM,
    });
    expect(body.data.introFilm).toBeNull();
  });

  // The R2 keys hold the creator's id by layout, so it is in every public
  // poster URL on the platform. What must not ride along is an id FIELD: the
  // minter resolves the film from the org, and nothing public takes one.
  it('names the film by its public URLs, with no id field', async () => {
    const { body } = await publicInfo({ ok: true, film: FILM });
    expect(Object.keys(body.data.introFilm as object).sort()).toEqual([
      'durationSeconds',
      'fullFilm',
      'posterUrl',
      'previewUrl',
      'title',
    ]);
  });

  it('still serves the brand, with no film, when the film read fails', async () => {
    brandingSpies.get.mockResolvedValue({ primaryColorHex: '#112233' });
    const { status, body } = await publicInfo(new Error('neon down'));
    expect(status).toBe(200);
    expect(body.data.introFilm).toBeNull();
    expect(body.data).toMatchObject({ brandColors: { primary: '#112233' } });
  });

  it('carries the same film on /public/:slug', async () => {
    const slug = freshSlug();
    orgSpies.getBySlug.mockResolvedValue({
      id: ORG_ID,
      slug,
      name: 'Studio Alpha',
      description: null,
    });
    resolveSpy.mockResolvedValue({ ok: true, film: FILM });
    const res = await readPublic(`/public/${slug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { introFilm: unknown } };
    expect(body.data.introFilm).toMatchObject({ fullFilm: true });
  });
});

const CALLER = {
  id: 'filmcaller01',
  email: 'caller@test.com',
  role: 'creator',
};

function makeKv() {
  const store = new Map<string, string>();
  return {
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
    store,
  };
}

/** GET the studio read as a caller whose membership in the org is `role`. */
async function studioReadAs(role: string): Promise<Response> {
  const kv = makeKv();
  kv.store.set(
    membershipCacheKey(ORG_ID, CALLER.id),
    JSON.stringify({ role, status: 'active', joinedAt: '2026-01-01' })
  );
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', CALLER);
    // Its own rate-limit bucket: `singleWorker` shares one limiter.
    c.set('session', { id: 'sess_intro_film_studio', userId: CALLER.id });
    await next();
  });
  app.route('/api/organizations/:id/settings', settings);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(
      `http://organization-api.test/api/organizations/${ORG_ID}/settings/branding/intro-video`
    ),
    { ...testEnv, CACHE_KV: kv } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const STUDIO_FILM: StudioIntroFilm = {
  mediaItemId: FILM.mediaId,
  title: FILM.title,
  posterUrl: `${CDN}/${FILM.thumbnailKey}`,
  durationSeconds: 134,
  plays: 'preview',
  reason: 'paid',
};

describe('studio read: GET /settings/branding/intro-video', () => {
  it.each([
    'owner',
    'admin',
  ])('an %s reads the film for this org', async (role) => {
    accessSpies.getStudioIntroFilm.mockResolvedValue(STUDIO_FILM);
    const res = await studioReadAs(role);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: STUDIO_FILM });
    expect(accessSpies.getStudioIntroFilm).toHaveBeenCalledWith(ORG_ID);
  });

  it('answers null when no film is picked', async () => {
    accessSpies.getStudioIntroFilm.mockResolvedValue(null);
    const res = await studioReadAs('owner');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it.each([
    'creator',
    'member',
    'subscriber',
  ])('a %s is refused before the film is read', async (role) => {
    const res = await studioReadAs(role);
    expect(res.status).toBe(403);
    expect(accessSpies.getStudioIntroFilm).not.toHaveBeenCalled();
  });
});
