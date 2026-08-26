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

vi.mock('$lib/server/cache', () => ({
  CACHE_HEADERS: {
    PRIVATE: { 'cache-control': 'private' },
    DYNAMIC_PUBLIC_REVALIDATE: { 'cache-control': 'public, max-age=0' },
  },
}));

describe('pricing page server load', () => {
  type LoadInput = Parameters<typeof import('../+page.server').load>[0];

  const baseInput = (user: { id: string } | null): LoadInput =>
    ({
      parent: async () => ({ org: { id: 'org-1', slug: 'demo' } }),
      locals: { user },
      platform: { env: {} },
      cookies: {},
      setHeaders: vi.fn(),
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
});
