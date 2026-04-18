/**
 * Organization subdomain sitemap.
 *
 * Emits a valid sitemap.xml for {slug}.revelations.studio — lists the
 * org's public landing/explore/creators pages plus one <url> entry per
 * published content item. Content is enumerated via the existing
 * public content API (KV-cached upstream), so first-fetch cost is
 * bounded by KV round-trips; subsequent fetches are cheap.
 *
 * Response is cached at the CDN with a short max-age + long SWR so
 * returning crawlers get a stale copy instantly while a fresh one
 * is revalidated in the background.
 */

import { createServerApi } from '$lib/server/api';
import type { RequestHandler } from './$types';

const MAX_SITEMAP_URLS = 500;
const PAGE_SIZE = 50;

/** Escape XML reserved characters in text nodes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  priority?: number;
  changefreq?: 'daily' | 'weekly' | 'monthly';
}

function renderSitemap(entries: SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
      if (entry.changefreq)
        parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority !== undefined)
        parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export const GET: RequestHandler = async ({
  params,
  url,
  platform,
  cookies,
}) => {
  const api = createServerApi(platform, cookies);

  // Resolve org by slug — 404 early if it doesn't exist.
  const org = await api.org.getPublicInfo(params.slug).catch(() => null);
  if (!org || typeof org !== 'object' || !('id' in org)) {
    return new Response('Not found', { status: 404 });
  }
  const orgId = (org as { id: string }).id;

  // Collect content up to MAX_SITEMAP_URLS. Each page is a separate
  // KV-cached call upstream; we stop as soon as the response is short.
  const items: Array<{
    slug: string;
    updatedAt?: string | Date | null;
    publishedAt?: string | Date | null;
  }> = [];
  let page = 1;
  while (items.length < MAX_SITEMAP_URLS) {
    const searchParams = new URLSearchParams();
    searchParams.set('orgId', orgId);
    searchParams.set('page', String(page));
    searchParams.set('limit', String(PAGE_SIZE));
    searchParams.set('sort', 'newest');

    const result = await api.content
      .getPublicContent(searchParams)
      .catch(() => null);
    const batch = (result?.items ?? []) as typeof items;
    if (batch.length === 0) break;
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  const origin = url.origin;
  const entries: SitemapEntry[] = [
    { loc: `${origin}/`, priority: 1.0, changefreq: 'daily' },
    { loc: `${origin}/explore`, priority: 0.9, changefreq: 'daily' },
    { loc: `${origin}/creators`, priority: 0.8, changefreq: 'weekly' },
    ...items.slice(0, MAX_SITEMAP_URLS - 3).map((item) => ({
      loc: `${origin}/content/${item.slug}`,
      lastmod: toIsoDate(item.publishedAt) ?? toIsoDate(item.updatedAt),
      priority: 0.7,
      changefreq: 'weekly' as const,
    })),
  ];

  return new Response(renderSitemap(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // 30min edge + browser cache, 1d stale-while-revalidate.
      // Content lists change on publish/unpublish — the VersionedCache
      // staleness detection handles freshness on the app UI, but for
      // crawlers hitting an XML file the short-ish TTL is a sensible
      // compromise between freshness and CDN hit rate.
      'Cache-Control':
        'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400',
    },
  });
};
