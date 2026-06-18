/**
 * Structural tests for the org-subdomain sitemap.
 *
 * Covers:
 *  - HTTP shape (404 on missing org, 200 + XML on valid org, cache headers)
 *  - Static URLs always emitted (/, /explore, /creators) when org exists
 *  - Content items enumerated from createServerApi().content.getPublicContent
 *  - lastmod sourced from publishedAt then updatedAt
 *  - MAX_SITEMAP_URLS cap enforced (500 — 3 static + 497 content)
 *  - Pagination terminates on short batch
 *  - escapeXml correctness for content slugs with reserved chars
 *
 * Out of scope: full dynamic content enumeration semantics (adjacent open
 * bead Codex-ygrh covers the dynamic sitemap improvements; this suite
 * locks in the structural contract).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicInfo = vi.fn();
const mockGetPublicContent = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: { getPublicInfo: mockGetPublicInfo },
    content: { getPublicContent: mockGetPublicContent },
  }),
}));

import { GET } from '../+server';

type SitemapEvent = Parameters<typeof GET>[0];

function makeEvent(opts: { origin: string; slug: string }): SitemapEvent {
  return {
    url: new URL(opts.origin),
    params: { slug: opts.slug },
    platform: undefined,
    cookies: { get: () => undefined } as unknown,
  } as unknown as SitemapEvent;
}

const ORG_ID = 'org-abc-123';

describe('org sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('org resolution', () => {
    it('returns 404 when org getPublicInfo returns null', async () => {
      mockGetPublicInfo.mockResolvedValue(null);
      const response = await GET(
        makeEvent({
          origin: 'https://nonexistent.revelations.studio/sitemap.xml',
          slug: 'nonexistent',
        })
      );
      expect(response.status).toBe(404);
    });

    it('returns 404 when org getPublicInfo throws', async () => {
      mockGetPublicInfo.mockRejectedValue(new Error('API down'));
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      expect(response.status).toBe(404);
    });

    it('returns 404 when org response lacks an id', async () => {
      mockGetPublicInfo.mockResolvedValue({ name: 'No ID' });
      const response = await GET(
        makeEvent({
          origin: 'https://malformed.revelations.studio/sitemap.xml',
          slug: 'malformed',
        })
      );
      expect(response.status).toBe(404);
    });
  });

  describe('HTTP shape (valid org)', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID, slug: 'yoga-studio' });
      mockGetPublicContent.mockResolvedValue({ items: [] });
    });

    it('returns 200 OK', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      expect(response.status).toBe(200);
    });

    it('sets content-type to application/xml; charset=utf-8', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      expect(response.headers.get('content-type')).toBe(
        'application/xml; charset=utf-8'
      );
    });

    it('sets Cache-Control to public + 30min max-age + 1d SWR', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=1800');
      expect(cacheControl).toContain('s-maxage=1800');
      expect(cacheControl).toContain('stale-while-revalidate=86400');
    });
  });

  describe('static URLs', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID });
      mockGetPublicContent.mockResolvedValue({ items: [] });
    });

    it('emits /, /explore, /creators even when org has zero content', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain(
        '<loc>https://yoga-studio.revelations.studio/</loc>'
      );
      expect(body).toContain(
        '<loc>https://yoga-studio.revelations.studio/explore</loc>'
      );
      expect(body).toContain(
        '<loc>https://yoga-studio.revelations.studio/creators</loc>'
      );
    });

    it('emits exactly 3 <url> entries when content is empty', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      const urlEntries = body.match(/<url>/g) ?? [];
      expect(urlEntries.length).toBe(3);
    });
  });

  describe('url.origin propagation (subdomain-correct)', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID });
      mockGetPublicContent.mockResolvedValue({ items: [] });
    });

    it('uses bruce-studio.lvh.me:3000 in local dev', async () => {
      const response = await GET(
        makeEvent({
          origin: 'http://bruce-studio.lvh.me:3000/sitemap.xml',
          slug: 'bruce-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('<loc>http://bruce-studio.lvh.me:3000/</loc>');
      expect(body).not.toContain('revelations.studio');
    });

    it('uses two-level subdomain on deployed dev', async () => {
      const response = await GET(
        makeEvent({
          origin: 'https://studio-alpha.dev.revelations.studio/sitemap.xml',
          slug: 'studio-alpha',
        })
      );
      const body = await response.text();
      expect(body).toContain(
        '<loc>https://studio-alpha.dev.revelations.studio/</loc>'
      );
      expect(body).toContain(
        '<loc>https://studio-alpha.dev.revelations.studio/explore</loc>'
      );
    });
  });

  describe('content enumeration', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID });
    });

    it('emits one <url> per content item', async () => {
      mockGetPublicContent.mockResolvedValue({
        items: [
          { slug: 'first-video', publishedAt: '2026-01-01T00:00:00Z' },
          { slug: 'second-video', publishedAt: '2026-01-02T00:00:00Z' },
        ],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain(
        '<loc>https://yoga-studio.revelations.studio/content/first-video</loc>'
      );
      expect(body).toContain(
        '<loc>https://yoga-studio.revelations.studio/content/second-video</loc>'
      );
      // 3 static + 2 content
      const urlEntries = body.match(/<url>/g) ?? [];
      expect(urlEntries.length).toBe(5);
    });

    it('uses publishedAt for lastmod when present', async () => {
      mockGetPublicContent.mockResolvedValue({
        items: [{ slug: 'first', publishedAt: '2026-03-15T10:00:00Z' }],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('<lastmod>2026-03-15T10:00:00Z</lastmod>');
    });

    it('falls back to updatedAt when publishedAt absent', async () => {
      mockGetPublicContent.mockResolvedValue({
        items: [{ slug: 'first', updatedAt: '2026-04-01T12:00:00Z' }],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('<lastmod>2026-04-01T12:00:00Z</lastmod>');
    });

    it('handles Date object updatedAt', async () => {
      const date = new Date('2026-05-01T00:00:00Z');
      mockGetPublicContent.mockResolvedValue({
        items: [{ slug: 'first', publishedAt: date }],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('<lastmod>2026-05-01T00:00:00.000Z</lastmod>');
    });
  });

  describe('escapeXml on content slugs', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID });
    });

    it('escapes & in content slugs', async () => {
      mockGetPublicContent.mockResolvedValue({
        items: [{ slug: 'jazz-&-blues', publishedAt: '2026-01-01' }],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('jazz-&amp;-blues');
      // The raw & should NOT appear inside the loc value
      expect(body).not.toMatch(/<loc>[^<]*&[^a]/);
    });

    it('escapes < and > in content slugs', async () => {
      mockGetPublicContent.mockResolvedValue({
        items: [{ slug: 'less<than>more', publishedAt: '2026-01-01' }],
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      expect(body).toContain('less&lt;than&gt;more');
    });
  });

  describe('pagination + MAX_SITEMAP_URLS cap', () => {
    beforeEach(() => {
      mockGetPublicInfo.mockResolvedValue({ id: ORG_ID });
    });

    it('stops paginating when batch is shorter than PAGE_SIZE (50)', async () => {
      mockGetPublicContent.mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, i) => ({
          slug: `item-${i}`,
          publishedAt: '2026-01-01',
        })),
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();

      // 3 static + 10 content = 13 entries
      const urlEntries = body.match(/<url>/g) ?? [];
      expect(urlEntries.length).toBe(13);
      // Should NOT have made a second pagination call
      expect(mockGetPublicContent).toHaveBeenCalledTimes(1);
    });

    it('caps content at MAX_SITEMAP_URLS - 3 = 497 entries', async () => {
      // Return full pages (PAGE_SIZE=50) repeatedly until cap reached.
      // Need 10 full pages = 500 items, but cap is 497.
      mockGetPublicContent.mockImplementation(() => {
        return Promise.resolve({
          items: Array.from({ length: 50 }, (_, i) => ({
            slug: `item-${Math.random()}`,
            publishedAt: '2026-01-01',
          })),
        });
      });

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      const body = await response.text();
      const urlEntries = body.match(/<url>/g) ?? [];
      // 3 static + 497 content = 500 entries (cap)
      expect(urlEntries.length).toBe(500);
    });

    it('returns 3 static URLs when content fetch fails', async () => {
      mockGetPublicContent.mockRejectedValue(new Error('Upstream timeout'));

      const response = await GET(
        makeEvent({
          origin: 'https://yoga-studio.revelations.studio/sitemap.xml',
          slug: 'yoga-studio',
        })
      );
      // Status should still be 200 — partial response is better than 5xx for crawlers
      expect(response.status).toBe(200);
      const body = await response.text();
      const urlEntries = body.match(/<url>/g) ?? [];
      expect(urlEntries.length).toBe(3);
    });
  });
});
