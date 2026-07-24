/**
 * Public journey sales page — server load (Codex-2pryk.3.1 · WP-3).
 *
 * SHELL + STREAM (apps/web CLAUDE.md; HARDENING §E course-sell row):
 *   - AWAIT the critical envelope — the page's `sections` + `course` + `stages`
 *     + `testimonials` in one `getCoursePage` read. This drives SEO
 *     (`<svelte:head>` + JSON-LD) and the structural first paint, so it MUST
 *     resolve before the load returns.
 *   - STREAM the secondary sell-preview media (the public 30s `preview.m3u8`,
 *     SPEC §10) as a bare, `.catch()`-guarded promise. It is off the critical
 *     path: a slow or failed media resolution degrades to a poster skeleton and
 *     never blocks first paint / SEO.
 *
 * NO `canView` on this shell — the sales page is fully public (HARDENING §E).
 * `canView` is only ever needed for the authed guide video + the free-taste
 * door, neither of which gates the sell page.
 *
 * Data comes exclusively through the `./journey-data` INTEGRATION SEAM (mocked
 * for AGGRESSIVE-MODE today; rewired to the real remote functions post-WP-2).
 */
import { error } from '@sveltejs/kit';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import { getCoursePage, resolveSellPreview } from './journey-data';

export const load: PageServerLoad = async ({
  params,
  parent,
  setHeaders,
  depends,
}) => {
  // Ensure the org layout (auth + branding + org resolution) has resolved before
  // we commit cache headers — mirrors the org-landing precedent.
  await parent();

  // AWAIT: the SEO-critical, first-paint envelope. Null → no published page.
  const coursePage = await getCoursePage({ slug: params.journeySlug });
  if (!coursePage) {
    throw error(404, 'This journey could not be found.');
  }

  // Version-keyed invalidation dependency. NOTE (flagged for the conductor):
  // the page/course payload should cache under new `CacheType.PAGE_CONFIG` /
  // `COURSE_CONFIG` keyed on the STABLE pageId/courseId (never slug). The
  // client staleness dispatch is currently substring-matched on `:content`
  // (`_org/[slug]/+layout.svelte`), so a new `:pages`/`:courses` key is inert
  // until that dispatch is made exact-key — a prerequisite refactor, NOT owned
  // by WP-3. `depends` is wired here so the invalidation lands once it is.
  depends('cache:versions');

  // ── DYNAMIC_PUBLIC cache-header decision (WP-3): PRIVATE — decided, not deferred ──
  // The page PAYLOAD is auth-agnostic (and once WP-2 lands it is KV-cached under
  // PAGE_CONFIG/COURSE_CONFIG version keys, so PRIVATE costs an SSR render, not
  // a DB query). But the RENDERED HTML is auth-varying: the org layout injects
  // `user` into the shell and the sell CTA branches on it (anon → "Join";
  // enrolled → "Go to your dashboard"). Shared caches key by URL, NOT Cookie, so
  // any `public`/`s-maxage` response cached for an anonymous visitor would be
  // served to signed-in users too — the org-landing / content-detail bug class.
  // PRIVATE is therefore correct and matches the content-detail precedent
  // (content/[contentSlug]/+page.server.ts). The DYNAMIC_PUBLIC upgrade — split
  // an auth-agnostic, CDN-cacheable sell body out of the auth-varying chrome and
  // serve THAT `public, s-maxage` — is a deliberate shell-split refactor, out of
  // WP-3 scope. See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

  return {
    coursePage,
    orgSlug: params.slug,
    // STREAM: public sell previews (no auth). `.catch()` → null on any failure.
    sellPreview: resolveSellPreview({
      pageId: coursePage.page.id,
      courseId: coursePage.course.id,
    }).catch(() => null),
  };
};
