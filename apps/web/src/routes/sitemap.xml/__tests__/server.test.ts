/**
 * Structural tests for the platform sitemap (apex domain).
 *
 * Covers:
 *  - HTTP shape (status, content-type, cache headers)
 *  - All 7 static informational URLs present
 *  - url.origin propagates correctly (subdomain-correct for any caller env)
 *  - XML well-formedness (declaration, urlset wrapper, per-entry structure)
 *  - priority + changefreq attributes per entry
 *
 * Out of scope: dynamic content enumeration (that's the org sitemap's job;
 * see _org/[slug]/sitemap.xml). Adjacent open bead Codex-ygrh covers
 * dynamic content sitemap work — this test suite does NOT overlap.
 */

import { describe, expect, it } from 'vitest';
import { GET } from '../+server';

type SitemapEvent = Parameters<typeof GET>[0];

function makeEvent(origin: string): SitemapEvent {
  // The handler only reads event.url; cast everything else away.
  return { url: new URL(origin) } as unknown as SitemapEvent;
}

describe('platform sitemap', () => {
  describe('HTTP shape', () => {
    it('returns 200 OK', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      expect(response.status).toBe(200);
    });

    it('sets content-type to application/xml; charset=utf-8', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      expect(response.headers.get('content-type')).toBe(
        'application/xml; charset=utf-8'
      );
    });

    it('sets Cache-Control to public + 1h max-age + 1d SWR', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=3600');
      expect(cacheControl).toContain('s-maxage=3600');
      expect(cacheControl).toContain('stale-while-revalidate=86400');
    });
  });

  describe('content', () => {
    it('lists all 7 static URLs', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();

      for (const path of [
        '/',
        '/discover',
        '/pricing',
        '/about',
        '/become-creator',
        '/terms',
        '/privacy',
      ]) {
        expect(body).toContain(`<loc>https://revelations.studio${path}</loc>`);
      }
    });

    it('emits exactly 7 <url> entries', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      const urlOpens = body.match(/<url>/g) ?? [];
      const urlCloses = body.match(/<\/url>/g) ?? [];
      expect(urlOpens.length).toBe(7);
      expect(urlCloses.length).toBe(7);
    });

    it('each entry has both priority and changefreq', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      const priorities = body.match(/<priority>/g) ?? [];
      const changefreqs = body.match(/<changefreq>/g) ?? [];
      expect(priorities.length).toBe(7);
      expect(changefreqs.length).toBe(7);
    });

    it('priority is formatted to 1 decimal place', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      // Homepage = 1.0, discover = 0.9, terms/privacy = 0.3
      expect(body).toMatch(/<priority>1\.0<\/priority>/);
      expect(body).toMatch(/<priority>0\.9<\/priority>/);
      expect(body).toMatch(/<priority>0\.3<\/priority>/);
    });
  });

  describe('XML structure', () => {
    it('starts with the XML declaration', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true
      );
    });

    it('wraps entries in <urlset> with sitemap protocol namespace', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      expect(body).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      );
      expect(body).toContain('</urlset>');
    });

    it('has no orphan tags (open/close counts match)', async () => {
      const response = await GET(
        makeEvent('https://revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      const locOpens = body.match(/<loc>/g) ?? [];
      const locCloses = body.match(/<\/loc>/g) ?? [];
      expect(locOpens.length).toBe(locCloses.length);
    });
  });

  describe('url.origin propagation (subdomain-correct)', () => {
    it('uses http://lvh.me:3000 in local dev', async () => {
      const response = await GET(makeEvent('http://lvh.me:3000/sitemap.xml'));
      const body = await response.text();
      expect(body).toContain('<loc>http://lvh.me:3000/</loc>');
      expect(body).toContain('<loc>http://lvh.me:3000/discover</loc>');
      expect(body).not.toContain('revelations.studio');
    });

    it('uses https://dev.revelations.studio on deployed dev', async () => {
      const response = await GET(
        makeEvent('https://dev.revelations.studio/sitemap.xml')
      );
      const body = await response.text();
      expect(body).toContain('<loc>https://dev.revelations.studio/</loc>');
      expect(body).toContain(
        '<loc>https://dev.revelations.studio/discover</loc>'
      );
    });

    it('preserves port when present', async () => {
      const response = await GET(
        makeEvent('http://localhost:5173/sitemap.xml')
      );
      const body = await response.text();
      expect(body).toContain('<loc>http://localhost:5173/</loc>');
    });
  });
});
