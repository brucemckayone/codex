/**
 * Org landing page server load — shape + wiring tests (WP-11).
 *
 * Locks the redesigned load contract:
 * - `allContent` is the awaited single catalogue fetch (first paint + SEO).
 * - `feedCategories` is derived from `allContent`, sorted by count DESC.
 * - `categories` (taxonomy) and `continueWatching` are STREAMED promises,
 *   each `.catch()`-guarded so a rejection degrades to an empty list rather
 *   than crashing the load.
 * - The PRIVATE (non-shared) cache header is set AFTER the awaited fetch so an
 *   error response can never inherit a public policy (poisoning guard).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────
const {
  getPublicContentMock,
  getPublicCategoriesMock,
  getContinueWatchingMock,
  getPublicCreatorsMock,
  getPublicStatsMock,
  listTiersMock,
  listPublishedJourneysMock,
} = vi.hoisted(() => ({
  getPublicContentMock: vi.fn(),
  getPublicCategoriesMock: vi.fn(),
  getContinueWatchingMock: vi.fn(),
  getPublicCreatorsMock: vi.fn(),
  getPublicStatsMock: vi.fn(),
  listTiersMock: vi.fn(),
  listPublishedJourneysMock: vi.fn(),
}));

vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: getPublicContentMock,
}));

vi.mock('$lib/remote/categories.remote', () => ({
  getPublicCategories: getPublicCategoriesMock,
}));

vi.mock('$lib/remote/library.remote', () => ({
  getContinueWatching: getContinueWatchingMock,
}));

vi.mock('$lib/remote/org.remote', () => ({
  getPublicCreators: getPublicCreatorsMock,
  getPublicStats: getPublicStatsMock,
}));

vi.mock('$lib/remote/subscription.remote', () => ({
  listTiers: listTiersMock,
}));

// The guided-journeys rail. This mock is not optional decoration: an UNMOCKED
// remote `query()` resolves to SvelteKit's CLIENT implementation under vitest,
// which dereferences `app.hooks.transport` — undefined outside a real client
// runtime — so the load threw before returning and all six tests failed. Every
// remote the load touches must be mocked here.
vi.mock('$lib/remote/journeys.remote', () => ({
  listPublishedJourneys: listPublishedJourneysMock,
}));

// Derived from the real shared presets rather than hand-typed. Every one of
// these stubs used to carry a FAKE value ('public, max-age=60' when the real
// preset said 300s), so neither removing a preset nor changing one could fail
// this test. `@codex/constants` has zero imports, so pulling it into the mock
// factory is safe here.
vi.mock('$lib/server/cache', async () => {
  const { CACHE_PRESETS } = await import('@codex/constants');
  return {
    CACHE_HEADERS: {
      PRIVATE: { 'Cache-Control': CACHE_PRESETS.private },
      DYNAMIC_PUBLIC: { 'Cache-Control': CACHE_PRESETS.public },
    },
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────
type LoadInput = Parameters<typeof import('../+page.server').load>[0];

const ORG_ID = 'org-1';
const ORG_SLUG = 'bruce-studio';

const baseInput = (): LoadInput =>
  ({
    params: { slug: ORG_SLUG },
    parent: async () => ({ org: { id: ORG_ID, slug: ORG_SLUG } }),
    setHeaders: vi.fn(),
    locals: { user: null },
    platform: { env: {} },
    cookies: {},
    url: new URL('http://bruce-studio.lvh.me:3000/'),
  }) as unknown as LoadInput;

/**
 * Run the load and narrow away SvelteKit's `void` return branch (a load may
 * legally return void; ours always returns data). Throws if it ever doesn't.
 */
async function loadData(input: LoadInput = baseInput()) {
  const { load } = await import('../+page.server');
  const result = await load(input);
  if (!result) throw new Error('landing load returned no data');
  return result;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('org landing +page.server.ts — load shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicContentMock.mockResolvedValue({
      items: [
        { id: 'a', category: 'philosophy', featured: true },
        { id: 'b', category: 'philosophy', featured: false },
        { id: 'c', category: 'ritual', featured: false },
        { id: 'd', category: null, featured: false },
      ],
      pagination: { total: 4 },
    });
    getPublicCategoriesMock.mockResolvedValue([
      { id: 'cat-1', name: 'Philosophy', slug: 'philosophy' },
    ]);
    getContinueWatchingMock.mockResolvedValue([
      { id: 'a', title: 'Resume me' },
    ]);
    getPublicCreatorsMock.mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    getPublicStatsMock.mockResolvedValue({ content: { total: 4 } });
    listTiersMock.mockResolvedValue([]);
    listPublishedJourneysMock.mockResolvedValue([]);
  });

  it('awaits the catalogue fetch and returns it as allContent', async () => {
    const result = await loadData();

    expect(getPublicContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, sort: 'newest', limit: 50 })
    );
    expect(result.allContent).toHaveLength(4);
  });

  it('derives feedCategories from allContent, sorted by count DESC', async () => {
    const result = await loadData();

    // philosophy (2) before ritual (1); the null-category item is excluded.
    expect(result.feedCategories).toEqual([
      { name: 'philosophy', count: 2 },
      { name: 'ritual', count: 1 },
    ]);
  });

  it('streams the curated categories (taxonomy) via getPublicCategories', async () => {
    const result = await loadData();

    expect(getPublicCategoriesMock).toHaveBeenCalledWith(ORG_ID);
    await expect(result.categories).resolves.toEqual([
      { id: 'cat-1', name: 'Philosophy', slug: 'philosophy' },
    ]);
  });

  it('streams server-backed continue-watching via getContinueWatching', async () => {
    const result = await loadData();

    expect(getContinueWatchingMock).toHaveBeenCalled();
    await expect(result.continueWatching).resolves.toEqual([
      { id: 'a', title: 'Resume me' },
    ]);
  });

  it('degrades streamed categories + continue-watching to [] on rejection', async () => {
    getPublicCategoriesMock.mockRejectedValueOnce(new Error('categories 500'));
    getContinueWatchingMock.mockRejectedValueOnce(new Error('library 500'));

    const result = await loadData();

    await expect(result.categories).resolves.toEqual([]);
    await expect(result.continueWatching).resolves.toEqual([]);
  });

  it('sets a PRIVATE cache header AFTER the catalogue fetch resolves', async () => {
    const callOrder: string[] = [];
    getPublicContentMock.mockImplementationOnce(async () => {
      callOrder.push('getPublicContent');
      return { items: [], pagination: { total: 0 } };
    });

    const input = baseInput();
    (input.setHeaders as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('setHeaders');
    });

    const { load } = await import('../+page.server');
    await load(input);

    expect(callOrder).toEqual(['getPublicContent', 'setHeaders']);
    expect(input.setHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': expect.stringContaining('private'),
      })
    );
  });
});

/**
 * Codex-kgrdp.20 part 3. The slug-keyed reads (`getPublicStats`,
 * `getPublicCreators`) used to be fired ABOVE `await parent()` to overlap with
 * it. On a wildcard subdomain route that meant every probe of a slug that does
 * not exist issued two subrequests and two Neon queries before anything had
 * checked the org existed — and, because neither promise was `.catch()`-guarded
 * at the point of creation, `parent()`'s 404 left two live rejections behind.
 */
describe('org landing +page.server.ts — unknown slug costs nothing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicContentMock.mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    getPublicCategoriesMock.mockResolvedValue([]);
    getContinueWatchingMock.mockResolvedValue([]);
    getPublicCreatorsMock.mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    getPublicStatsMock.mockResolvedValue({ content: { total: 0 } });
    listTiersMock.mockResolvedValue([]);
    listPublishedJourneysMock.mockResolvedValue([]);
  });

  it('issues NO remote calls when parent() rejects with the layout 404', async () => {
    const input = baseInput();
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    (input as { parent: () => Promise<unknown> }).parent = async () => {
      throw notFound;
    };

    const { load } = await import('../+page.server');
    await expect(load(input)).rejects.toBe(notFound);

    // Every fan-out sits below the await, so a miss reaches none of them.
    expect(getPublicStatsMock).not.toHaveBeenCalled();
    expect(getPublicCreatorsMock).not.toHaveBeenCalled();
    expect(getPublicContentMock).not.toHaveBeenCalled();
    expect(listPublishedJourneysMock).not.toHaveBeenCalled();
    expect(listTiersMock).not.toHaveBeenCalled();
    expect(getPublicCategoriesMock).not.toHaveBeenCalled();
    expect(getContinueWatchingMock).not.toHaveBeenCalled();
    expect(input.setHeaders).not.toHaveBeenCalled();
  });

  it('does not regress first paint: stats + creators still overlap the catalogue fetch', async () => {
    const callOrder: string[] = [];
    getPublicStatsMock.mockImplementation(async () => {
      callOrder.push('stats');
      return { content: { total: 0 } };
    });
    getPublicCreatorsMock.mockImplementation(async () => {
      callOrder.push('creators');
      return { items: [], pagination: { total: 0 } };
    });
    // Resolves on a later microtask, so anything issued concurrently with the
    // catalogue fetch has already been recorded by the time it settles.
    getPublicContentMock.mockImplementation(async () => {
      await Promise.resolve();
      callOrder.push('catalogue');
      return { items: [], pagination: { total: 0 } };
    });

    await loadData();

    expect(callOrder.indexOf('stats')).toBeLessThan(
      callOrder.indexOf('catalogue')
    );
    expect(callOrder.indexOf('creators')).toBeLessThan(
      callOrder.indexOf('catalogue')
    );
  });

  it('degrades stats to null and creators to an empty rail on rejection', async () => {
    getPublicStatsMock.mockRejectedValueOnce(new Error('stats 500'));
    getPublicCreatorsMock.mockRejectedValueOnce(new Error('creators 500'));

    const result = await loadData();

    expect(result.stats).toBeNull();
    await expect(result.creators).resolves.toEqual({ items: [], total: 0 });
  });
});
