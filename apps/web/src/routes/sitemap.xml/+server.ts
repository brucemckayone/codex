/**
 * Platform sitemap.
 *
 * Emits sitemap.xml for the root platform domain (revelations.studio).
 * Lists the static informational routes. Per-org content is served by
 * the separate _org/[slug]/sitemap.xml endpoint at each org subdomain —
 * a single central sitemap would be noisy and wouldn't route crawlers
 * to each org's canonical subdomain origin.
 */
import type { RequestHandler } from './$types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Entry {
  loc: string;
  priority?: number;
  changefreq?: 'daily' | 'weekly' | 'monthly';
}

function renderSitemap(entries: Entry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
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

export const GET: RequestHandler = async ({ url }) => {
  const origin = url.origin;
  const entries: Entry[] = [
    { loc: `${origin}/`, priority: 1.0, changefreq: 'daily' },
    { loc: `${origin}/discover`, priority: 0.9, changefreq: 'daily' },
    { loc: `${origin}/pricing`, priority: 0.7, changefreq: 'monthly' },
    { loc: `${origin}/about`, priority: 0.5, changefreq: 'monthly' },
    { loc: `${origin}/become-creator`, priority: 0.7, changefreq: 'monthly' },
    { loc: `${origin}/terms`, priority: 0.3, changefreq: 'monthly' },
    { loc: `${origin}/privacy`, priority: 0.3, changefreq: 'monthly' },
  ];

  return new Response(renderSitemap(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control':
        'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
