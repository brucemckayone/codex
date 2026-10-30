/**
 * Pricing page server load.
 *
 * `currentSubscription` envelope: the server used to swallow API errors with
 * `.catch(() => null)`, indistinguishable from "user has no subscription". A
 * logged-in subscriber hitting a transient API error would then see the
 * "Subscribe" CTA and crash into AlreadySubscribedError at checkout. The
 * envelope returns `{ data, loadError }` so the client can refuse to Subscribe
 * until we know the truth.
 *
 * `tiers` and `currentSubscription` are now AWAITED rather than streamed — the
 * tier grid is page structure and has to exist in the server HTML — so those
 * assertions read plain values where they used to await a promise. Everything
 * below the fold (catalogue sample, portals, stats) stays streamed and is
 * still asserted as a promise.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tiersListMock = vi.fn();
const getCurrentMock = vi.fn();
const contentMock = vi.fn();
const statsMock = vi.fn();
const portalsMock = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    tiers: { list: tiersListMock },
    subscription: { getCurrent: getCurrentMock },
    content: { getPublicContent: contentMock },
    org: { getPublicStats: statsMock },
    access: { listPublishedCourses: portalsMock },
  })),
}));

// Derived from the real shared presets rather than hand-typed. Every one of
// these stubs used to carry a FAKE value ('public, max-age=60' when the real
// preset said 300s), so neither removing a preset nor changing one could fail
// this test. `@codex/constants` has zero imports, so pulling it into the mock
// factory is safe here.
// `DYNAMIC_PUBLIC_REVALIDATE` was retired for leaking one viewer's render to
// the next through `s-maxage`; `PER_VIEWER` is its safe replacement.
vi.mock('$lib/server/cache', async () => {
  const { CACHE_PRESETS } = await import('@codex/constants');
  return {
    CACHE_HEADERS: {
      PRIVATE: { 'Cache-Control': CACHE_PRESETS.private },
      PER_VIEWER: { 'Cache-Control': CACHE_PRESETS['per-viewer'] },
    },
  };
});

describe('pricing page server load', () => {
  type LoadInput = Parameters<typeof import('../+page.server').load>[0];

  const baseInput = (user: { id: string } | null, search = ''): LoadInput =>
    ({
      parent: async () => ({ org: { id: 'org-1', slug: 'demo' } }),
      locals: { user },
      platform: { env: {} },
      cookies: {},
      setHeaders: vi.fn(),
      url: new URL(`http://demo.lvh.me:3000/pricing${search}`),
    }) as unknown as LoadInput;

  beforeEach(() => {
    vi.clearAllMocks();
    tiersListMock.mockResolvedValue([]);
    contentMock.mockResolvedValue({ items: [] });
    statsMock.mockResolvedValue(null);
    portalsMock.mockResolvedValue([]);
  });

  describe('currentSubscription envelope', () => {
    it('unauthenticated: returns { data: null, loadError: false } without calling getCurrent', async () => {
      const { load } = await import('../+page.server');

      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      expect(result.currentSubscription).toEqual({
        data: null,
        loadError: false,
      });
      expect(getCurrentMock).not.toHaveBeenCalled();
    });

    it('authenticated: wraps a successful subscription in { data, loadError: false }', async () => {
      const fixture = {
        id: 'sub-1',
        tierId: 'tier-1',
        status: 'active',
        cancelAtPeriodEnd: false,
      };
      getCurrentMock.mockResolvedValueOnce(fixture);

      const { load } = await import('../+page.server');

      const result = await load(baseInput({ id: 'user-1' }));

      if (!result) throw new Error('load returned void');
      expect(result.currentSubscription).toEqual({
        data: fixture,
        loadError: false,
      });
      expect(getCurrentMock).toHaveBeenCalledWith('org-1');
    });

    it('authenticated: wraps an API error in { data: null, loadError: true }', async () => {
      getCurrentMock.mockRejectedValueOnce(
        new Error('ecom worker unreachable')
      );

      const { load } = await import('../+page.server');

      const result = await load(baseInput({ id: 'user-1' }));

      if (!result) throw new Error('load returned void');
      expect(result.currentSubscription).toEqual({
        data: null,
        loadError: true,
      });
    });
  });

  describe('tiers are resolved server-side', () => {
    it('returns tiers as a plain array so the cards render during SSR', async () => {
      const tier = {
        id: 'tier-1',
        name: 'Soul Path',
        priceMonthly: 1500,
        priceAnnual: 14400,
        sortOrder: 0,
      };
      tiersListMock.mockResolvedValue([tier]);

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      // Not a promise: an `$effect` unwrap never runs on the server, so a
      // streamed `tiers` shipped a skeleton and zero prices to crawlers.
      expect(Array.isArray(result.tiers)).toBe(true);
      expect(result.tiers).toEqual([tier]);
    });

    it('falls back to an empty array when the tiers API fails', async () => {
      tiersListMock.mockRejectedValueOnce(new Error('org worker unreachable'));

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      expect(result.tiers).toEqual([]);
    });
  });

  describe('catalogue sample (streamed)', () => {
    it('requests 18 items so the marquee has enough to fill its track twice', async () => {
      const { load } = await import('../+page.server');
      await load(baseInput(null));

      const params = contentMock.mock.calls[0][0] as URLSearchParams;
      expect(params.get('orgId')).toBe('org-1');
      expect(params.get('limit')).toBe('18');
    });

    it('projects each item to the four fields the tile renders', async () => {
      contentMock.mockResolvedValueOnce({
        items: [
          {
            id: 'c1',
            title: 'Morning Somatic Flow',
            contentType: 'video',
            thumbnailUrl: null,
            description: 'a long field the band never reads',
            mediaItem: { thumbnailUrl: 'https://cdn.test/poster/md.webp' },
          },
        ],
      });

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      await expect(result.contentPreview).resolves.toEqual([
        {
          id: 'c1',
          title: 'Morning Somatic Flow',
          contentType: 'video',
          // Falls through to the generated poster via getDisplayThumbnail.
          thumbnailUrl: 'https://cdn.test/poster/md.webp',
        },
      ]);
    });

    it('KEEPS items with no thumbnail — the tile paints a brand cover plate', async () => {
      contentMock.mockResolvedValueOnce({
        items: [
          {
            id: 'c1',
            title: 'A Written Piece',
            contentType: 'written',
            thumbnailUrl: null,
            mediaItem: null,
          },
        ],
      });

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      const items = await result.contentPreview;
      expect(items).toHaveLength(1);
      expect(items[0].thumbnailUrl).toBeNull();
    });

    it('resolves to an empty array when the content API fails', async () => {
      contentMock.mockRejectedValueOnce(
        new Error('content worker unreachable')
      );

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      await expect(result.contentPreview).resolves.toEqual([]);
    });
  });

  describe('portals (streamed)', () => {
    it('streams the org published courses for the rail', async () => {
      const portal = { id: 'p1', title: 'Bone Deep', slug: 'bone-deep' };
      portalsMock.mockResolvedValueOnce([portal]);

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      await expect(result.portals).resolves.toEqual([portal]);
      expect(portalsMock).toHaveBeenCalledWith('org-1');
    });

    it('resolves to an empty array when the access API fails, so the rail is simply absent', async () => {
      portalsMock.mockRejectedValueOnce(new Error('access worker unreachable'));

      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      await expect(result.portals).resolves.toEqual([]);
    });
  });

  // Opened from an item's paywall (Codex-2hxff.91, owner decision U10): the
  // item's plan set is STREAMED, so the plan cards never wait on it, and any
  // miss or failure is simply no highlight.
  describe('the item it was opened from (?for=, streamed)', () => {
    const saltRoads = {
      id: 'c1',
      title: 'Salt Roads',
      slug: 'salt-roads',
      includedInTierIds: ['tier-pro', 'tier-premium'],
      contentBody: 'never shipped',
    };

    it('reads the public row by slug in this org and keeps only what the highlight needs', async () => {
      contentMock.mockImplementation((params: URLSearchParams) =>
        Promise.resolve({
          items: params.get('slug') === 'salt-roads' ? [saltRoads] : [],
        })
      );
      const { load } = await import('../+page.server');
      const result = await load(
        baseInput(null, '?for=salt-roads&returnTo=%2Fx')
      );

      if (!result) throw new Error('load returned void');
      await expect(result.forContent).resolves.toEqual({
        title: 'Salt Roads',
        slug: 'salt-roads',
        includedInTierIds: ['tier-pro', 'tier-premium'],
      });
      const sent = contentMock.mock.calls
        .map(([params]) =>
          Object.fromEntries((params as URLSearchParams).entries())
        )
        .find((p) => p.slug);
      expect(sent).toEqual({ orgId: 'org-1', slug: 'salt-roads', limit: '1' });
    });

    it('is null, with no read, when the page was not opened from an item', async () => {
      const { load } = await import('../+page.server');
      const result = await load(baseInput(null));

      if (!result) throw new Error('load returned void');
      await expect(result.forContent).resolves.toBeNull();
      expect(
        contentMock.mock.calls.some(([params]) =>
          (params as URLSearchParams).has('slug')
        )
      ).toBe(false);
    });

    it('is null for a slug that names nothing here', async () => {
      const { load } = await import('../+page.server');
      const result = await load(baseInput(null, '?for=someone-elses'));

      if (!result) throw new Error('load returned void');
      await expect(result.forContent).resolves.toBeNull();
    });

    it('makes no read for a slug the public list would refuse', async () => {
      const { load } = await import('../+page.server');
      const result = await load(baseInput(null, `?for=${'x'.repeat(600)}`));

      if (!result) throw new Error('load returned void');
      await expect(result.forContent).resolves.toBeNull();
      expect(
        contentMock.mock.calls.some(([params]) =>
          (params as URLSearchParams).has('slug')
        )
      ).toBe(false);
    });

    it('a failed read is no highlight, and never holds up the plan cards', async () => {
      tiersListMock.mockResolvedValue([{ id: 'tier-pro' }]);
      contentMock.mockImplementation((params: URLSearchParams) =>
        params.has('slug')
          ? Promise.reject(new Error('content-api down'))
          : Promise.resolve({ items: [] })
      );
      const { load } = await import('../+page.server');
      const result = await load(baseInput(null, '?for=salt-roads'));

      if (!result) throw new Error('load returned void');
      expect(result.tiers).toEqual([{ id: 'tier-pro' }]);
      expect(result.forContent).toBeInstanceOf(Promise);
      await expect(result.forContent).resolves.toBeNull();
    });
  });
});
