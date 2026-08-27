/**
 * Org layout server load — unknown-slug cost + version-read budget.
 *
 * Codex-kgrdp.20 / Codex-kgrdp.6. The wildcard subdomain route is open-ended by
 * design, so an unknown slug is normal traffic, and under a subdomain scan it is
 * MOST of it. These tests pin the three properties that make a miss cheap:
 *
 *  1. A definitive 404 from the public endpoint does NOT run the authenticated
 *     fallback — both resolve through the same auth-independent `getBySlug`, so
 *     the retry could only ever produce the same 404 one Neon query later.
 *  2. Any OTHER failure still runs the fallback, so a signed-in visitor whose
 *     public read broke keeps working.
 *  3. Repeat probes of a slug already known to 404 issue no subrequests and no
 *     KV operations at all.
 *
 * Plus the version-read budget: the `org:config:{orgId}` key was read on every
 * load and written by nothing, so it is gone.
 */

import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// `$lib/server/api` is mocked globally in src/tests/mocks.ts with an `org` that
// only carries getPublicBranding; this file-level mock replaces it so the two
// slug resolvers can be driven independently.
const { getPublicInfoMock, getBySlugMock, tiersListMock } = vi.hoisted(() => ({
  getPublicInfoMock: vi.fn(),
  getBySlugMock: vi.fn(),
  tiersListMock: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: { getPublicInfo: getPublicInfoMock, getBySlug: getBySlugMock },
    tiers: { list: tiersListMock },
  }),
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    startTimer: vi.fn(() => ({ end: vi.fn(() => 0) })),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('$lib/observability', () => ({ logger: loggerMock }));

// ─── Fixtures ─────────────────────────────────────────────────────────────
const ORG_ID = 'org-1';
const ORG_SLUG = 'bruce-studio';
const MISSING_SLUG = 'does-not-exist';

const publicOrg = () => ({
  id: ORG_ID,
  slug: ORG_SLUG,
  name: 'Bruce Studio',
  enableSubscriptions: true,
});

/**
 * What the org worker actually returns for a slug with no row: `procedure()`
 * maps `NotFoundError` through `mapErrorToResponse` to
 * `{ error: { code: 'NOT_FOUND', … } }`, which `$lib/server/api` reads into
 * `ApiError.code`. The code matters — see `bareNotFound`.
 */
const orgNotFound = () =>
  new ApiError(404, 'Organization not found', 'NOT_FOUND');

/**
 * A 404 with no envelope: Hono's default route-miss reply is plain text, so the
 * JSON parse fails and `code` comes back undefined. That is a MISSING ROUTE,
 * not a missing org, and must never be read as "this slug does not exist".
 */
const bareNotFound = () => new ApiError(404, 'API Error');

/**
 * A KV stub, not a mocked VersionedCache — the assertion under test is WHICH
 * version keys get read, and mocking the cache would hide the key builders that
 * decide them.
 */
function makeKv() {
  return {
    // Typed with the parameters KV actually takes: `mock.calls` is otherwise
    // `[]` and reading the key out of a call is a tuple out-of-range error.
    get: vi.fn<(key: string, type?: string) => Promise<null>>(async () => null),
    put: vi.fn<
      (key: string, value: string, options?: unknown) => Promise<void>
    >(async () => undefined),
    delete: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  };
}

type LoadInput = Parameters<typeof import('../+layout.server').load>[0];

function baseInput(
  overrides: {
    slug?: string;
    userId?: string | null;
    kv?: ReturnType<typeof makeKv> | null;
  } = {}
): LoadInput {
  const { slug = ORG_SLUG, userId = null, kv = makeKv() } = overrides;
  return {
    params: { slug },
    locals: { user: userId ? { id: userId } : null },
    platform: kv ? { env: { CACHE_KV: kv } } : { env: {} },
    cookies: { get: vi.fn() },
    depends: vi.fn(),
  } as unknown as LoadInput;
}

async function runLoad(input: LoadInput) {
  const { load } = await import('../+layout.server');
  const result = await load(input);
  // The generated load signature includes `void`; narrow it here so each
  // assertion can read the payload without a cast, and fail loudly rather
  // than silently passing on an empty result.
  if (!result) throw new Error('load returned no data');
  return result;
}

/** Run the load expecting it to bail, and return the thrown value. */
async function expectThrown(input: LoadInput): Promise<unknown> {
  try {
    await runLoad(input);
  } catch (err) {
    return err;
  }
  throw new Error('load resolved but a 404 was expected');
}

/** Version keys VersionedCache asked KV for, unwrapped from `cache:version:`. */
function versionIdsRead(kv: ReturnType<typeof makeKv>): string[] {
  return kv.get.mock.calls
    .map(([key]) => key as string)
    .filter((key) => key.startsWith('cache:version:'))
    .map((key) => key.slice('cache:version:'.length));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  const { _resetMissingOrgSlugCache } = await import('../+layout.server');
  _resetMissingOrgSlugCache();
  tiersListMock.mockResolvedValue([]);
});

// ─── (a) 404 vs failure ─────────────────────────────────────────────────────
describe('org layout load — definitive 404 vs failed call', () => {
  it('does NOT run the auth fallback when the public endpoint returned 404', async () => {
    getPublicInfoMock.mockRejectedValue(orgNotFound());

    const thrown = await expectThrown(baseInput({ slug: MISSING_SLUG }));

    expect(isHttpError(thrown, 404)).toBe(true);
    expect(getPublicInfoMock).toHaveBeenCalledTimes(1);
    expect(getBySlugMock).not.toHaveBeenCalled();
  });

  it('logs a definitive 404 at info, not error — a scan is not a platform fault', async () => {
    getPublicInfoMock.mockRejectedValue(orgNotFound());

    await expectThrown(baseInput({ slug: MISSING_SLUG }));

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining('does not resolve'),
      expect.objectContaining({ slug: MISSING_SLUG })
    );
  });

  it.each([
    ['a 500 from the public endpoint', new ApiError(500, 'boom')],
    ['a 408 timeout', new ApiError(408, 'timed out', 'REQUEST_TIMEOUT')],
    ['a 429 rate limit', new ApiError(429, 'slow down')],
    ['a transport error carrying no status', new TypeError('fetch failed')],
    // A 404 that carries no NOT_FOUND code is a missing ROUTE (deploy skew or
    // an edge 404), so the fallback must still run — fail safe, not fail cheap.
    ['a bare 404 with no error envelope', bareNotFound()],
  ])('still runs the auth fallback after %s, and serves the org it finds', async (_label, failure) => {
    getPublicInfoMock.mockRejectedValue(failure);
    getBySlugMock.mockResolvedValue({
      id: ORG_ID,
      slug: ORG_SLUG,
      name: 'Bruce Studio',
    });

    const result = await runLoad(baseInput());

    expect(getBySlugMock).toHaveBeenCalledWith(ORG_SLUG);
    expect(result?.org?.id).toBe(ORG_ID);
  });

  it('still runs the auth fallback when the public endpoint resolves a malformed body', async () => {
    // Not a failure and not a 404 — an unexpected shape. Unchanged behaviour.
    getPublicInfoMock.mockResolvedValue({ unexpected: true });
    getBySlugMock.mockResolvedValue({ id: ORG_ID, slug: ORG_SLUG, name: 'x' });

    const result = await runLoad(baseInput());

    expect(getBySlugMock).toHaveBeenCalledTimes(1);
    expect(result?.org?.id).toBe(ORG_ID);
  });
});

// ─── (b) negative cache ─────────────────────────────────────────────────────
describe('org layout load — unknown-slug negative cache', () => {
  it('answers repeat probes of a known-missing slug with no subrequests', async () => {
    getPublicInfoMock.mockRejectedValue(orgNotFound());

    const first = await expectThrown(baseInput({ slug: MISSING_SLUG }));
    expect(isHttpError(first, 404)).toBe(true);
    expect(getPublicInfoMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      const repeat = await expectThrown(baseInput({ slug: MISSING_SLUG }));
      expect(isHttpError(repeat, 404)).toBe(true);
    }

    // Still one — probes 2..6 never reached the network.
    expect(getPublicInfoMock).toHaveBeenCalledTimes(1);
    expect(getBySlugMock).not.toHaveBeenCalled();
  });

  it('spends no KV operations absorbing a probe — the write budget is the thing being protected', async () => {
    getPublicInfoMock.mockRejectedValue(orgNotFound());
    await expectThrown(baseInput({ slug: MISSING_SLUG }));

    const kv = makeKv();
    await expectThrown(baseInput({ slug: MISSING_SLUG, kv }));

    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('is per-slug — a different unknown slug is still resolved once', async () => {
    getPublicInfoMock.mockRejectedValue(orgNotFound());

    await expectThrown(baseInput({ slug: 'ghost-a' }));
    await expectThrown(baseInput({ slug: 'ghost-b' }));
    await expectThrown(baseInput({ slug: 'ghost-a' }));

    expect(getPublicInfoMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a non-404 failure — a broken endpoint must not mint 404s', async () => {
    getPublicInfoMock.mockRejectedValue(new ApiError(500, 'boom'));
    getBySlugMock.mockRejectedValue(new ApiError(401, 'unauthenticated'));

    await expectThrown(baseInput({ slug: ORG_SLUG }));
    await expectThrown(baseInput({ slug: ORG_SLUG }));

    // Both attempts re-tried the network; nothing was remembered.
    expect(getPublicInfoMock).toHaveBeenCalledTimes(2);
    expect(getBySlugMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a bare 404 — a missing route would 404 every real org', async () => {
    getPublicInfoMock.mockRejectedValue(bareNotFound());
    getBySlugMock.mockRejectedValue(new ApiError(401, 'unauthenticated'));

    await expectThrown(baseInput({ slug: ORG_SLUG }));
    await expectThrown(baseInput({ slug: ORG_SLUG }));

    expect(getPublicInfoMock).toHaveBeenCalledTimes(2);
  });

  it('expires after its TTL so a newly created org is reachable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));

    getPublicInfoMock.mockRejectedValueOnce(orgNotFound());
    await expectThrown(baseInput({ slug: MISSING_SLUG }));
    expect(getPublicInfoMock).toHaveBeenCalledTimes(1);

    // Inside the window: absorbed.
    await expectThrown(baseInput({ slug: MISSING_SLUG }));
    expect(getPublicInfoMock).toHaveBeenCalledTimes(1);

    // Past the window: the org now exists and must be served.
    vi.setSystemTime(new Date('2026-08-27T12:01:01Z'));
    getPublicInfoMock.mockResolvedValueOnce({
      ...publicOrg(),
      slug: MISSING_SLUG,
    });

    const result = await runLoad(baseInput({ slug: MISSING_SLUG }));

    expect(getPublicInfoMock).toHaveBeenCalledTimes(2);
    expect(result?.org?.id).toBe(ORG_ID);
  });
});

// ─── (d) version-read budget ────────────────────────────────────────────────
describe('org layout load — version read budget', () => {
  it('reads one version key for an anonymous visitor', async () => {
    getPublicInfoMock.mockResolvedValue(publicOrg());
    const kv = makeKv();

    const result = await runLoad(baseInput({ kv }));
    await result?.versions;

    expect(versionIdsRead(kv)).toEqual([`org:${ORG_ID}:content`]);
  });

  it('reads three version keys for a signed-in visitor', async () => {
    getPublicInfoMock.mockResolvedValue(publicOrg());
    const kv = makeKv();

    const result = await runLoad(baseInput({ kv, userId: 'user-9' }));
    await result?.versions;

    expect(versionIdsRead(kv)).toEqual([
      `org:${ORG_ID}:content`,
      'user:user-9:library',
      `user:user-9:subscription:${ORG_ID}`,
    ]);
  });

  it('no longer reads org:config — nothing on the platform ever bumps it', async () => {
    getPublicInfoMock.mockResolvedValue(publicOrg());
    const kv = makeKv();

    const result = await runLoad(baseInput({ kv, userId: 'user-9' }));
    await result?.versions;

    expect(versionIdsRead(kv)).not.toContain(`org:config:${ORG_ID}`);
  });

  it('degrades to an empty version map when KV is unbound', async () => {
    getPublicInfoMock.mockResolvedValue(publicOrg());

    const result = await runLoad(baseInput({ kv: null }));

    await expect(result?.versions).resolves.toEqual({});
  });
});
