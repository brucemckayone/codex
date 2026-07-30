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
import { error, redirect } from '@sveltejs/kit';
import { evaluateCourseGate } from '$lib/journeys/gate';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { resolveCanEnterCourse } from '$lib/server/journeys/round-d-seam';
import { buildJourneyUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';
import {
  getCoursePage,
  getCoursePagePreview,
  resolveSellPreview,
} from './journey-data';

export const load: PageServerLoad = async (event) => {
  const {
    params,
    parent,
    setHeaders,
    depends,
    locals,
    platform,
    cookies,
    url,
  } = event;

  // Ensure the org layout (auth + branding + org resolution) has resolved before
  // we commit cache headers — mirrors the org-landing precedent.
  const { user } = await parent();

  // AWAIT: the SEO-critical, first-paint envelope. Null → no PUBLISHED page.
  let coursePage = await getCoursePage({ slug: params.journeySlug });

  // Draft live-preview (Codex-isr02 P0b-2): when there's no published page but a
  // user IS signed in, try the management-gated preview read so an org manager
  // can preview an UNPUBLISHED draft in the builder iframe. The worker's
  // requireOrgManagement is the sole authority — a non-manager (or anon, who
  // never reaches this branch) gets null → 404 (fail-closed). This shell is
  // minimal for a fresh draft; the builder streams live sections/brand over the
  // page-preview bridge, which +page.svelte overlays on top.
  //
  // Which of the two reads served the page is the ONLY signal that separates a
  // draft preview from the live page, and the creator could not see it — "I am
  // not sure if live pages are preview pages" (Codex-xzwl5). It is threaded to
  // the view so it can say so, and so a draft is never indexed.
  let draftPreview = false;
  if (!coursePage && locals.user) {
    coursePage = await getCoursePagePreview({ slug: params.journeySlug });
    draftPreview = coursePage !== null;
  }

  if (!coursePage) {
    throw error(404, 'This portal could not be found.');
  }

  // AWAIT the entitlement flag: it now DECIDES THE REDIRECT below (Codex-aectb)
  // — an entitled viewer is sent to their dashboard rather than sold the course
  // again — and, on the preview bypass where no redirect fires, still flips the
  // ABOVE-THE-FOLD hero CTA (anon/not-entitled → "join" → checkout; entitled →
  // "go to your dashboard"). Either way it is first-paint, never streamed. The
  // sales page itself stays fully PUBLIC (no `canView` gate). We skip the worker
  // round-trip entirely for anonymous visitors (the
  // SEO-critical common case): no session ⇒ definitionally not enrolled. The
  // check is `.catch()`-guarded so an entitlement-resolver hiccup degrades to
  // the public/join CTA rather than throwing.
  //
  // AWAIT the offer alongside it (Codex-2pryk.2.4.3): the `invite` section's
  // prices and the paths it offers are now read from the authoritative
  // `getCourseOffer` rather than from the authored `priceLabel` a creator typed
  // into the builder. It runs in PARALLEL with the enrolment check, so this adds
  // no wall-clock to the critical path. `.catch(() => null)` because a pricing
  // hiccup must not 500 an SEO-critical sales page — the section degrades to a
  // price-less CTA and never falls back to authored numbers.
  const [enrolled, offer] = await Promise.all([
    user
      ? resolveCanEnterCourse(event, user.id, coursePage.course.id).catch(
          () => false
        )
      : Promise.resolve(false),
    createServerApi(platform, cookies)
      .courses.offer(coursePage.course.id)
      .catch(() => null),
  ]);

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

  // ── Already hold it ⇒ this is the wrong surface (Codex-aectb) ───────────────
  // A user who owns the course was still served the marketing page, with only
  // the hero CTA relabelled. Send them to their dashboard instead. Placed AFTER
  // the header commit so the 303 inherits `private, no-cache` — correct for a
  // per-user redirect, and never shared-cacheable.
  //
  // ONE DECISION FUNCTION, BOTH DIRECTIONS: the dashboard load redirects HERE
  // when `evaluateCourseGate` returns anything but `ok`; this page redirects
  // THERE when the same pure gate returns `ok`. The two conditions partition the
  // gate's outcome space, so for any one set of inputs exactly one of the two
  // surfaces renders — the pair cannot ping-pong.
  //
  // ENTITLEMENT, NOT ENROLMENT: `resolveCanEnterCourse` asks
  // `hasCourseEntitlement` (a live grant or a granting subscription tier), and
  // deliberately NOT for a `course_enrollments` row. A refunded user KEEPS their
  // enrollment row after the entitlement is revoked, so triggering on enrolment
  // would bounce them sell→dashboard→sell forever. Entitlement is the only
  // loop-free choice because it is the exact predicate the dashboard gates on.
  //
  // NEVER REDIRECT ON UNCERTAINTY: `enrolled` is `.catch(() => false)`-guarded
  // above, so a resolver hiccup RENDERS the sales page rather than redirecting.
  // That asymmetry is what makes the pair provably loop-free — the failure mode
  // of BOTH surfaces is "land on sales and stay there".
  //
  // BYPASS: `?preview=1` (the builder's View-live link) and `draftPreview` —
  // which can only be true when the management-gated preview read succeeded, so
  // it is already proof the viewer is an org manager. A creator inspecting their
  // own page must see the page, not their dashboard. No role or membership read
  // is needed: the sell page is fully public to anonymous visitors, so this
  // redirect is a UX convenience, not a security boundary, and the bypass
  // discloses nothing.
  if (!(url.searchParams.has('preview') || draftPreview)) {
    const gate = evaluateCourseGate({
      // A slug with no page/course already threw 404 above.
      courseExists: true,
      isAuthenticated: Boolean(user),
      canEnterCourse: enrolled,
    });
    if (gate.kind === 'ok') {
      redirect(
        303,
        buildJourneyUrl(
          url,
          {
            // The COURSE slug, not the landing-page slug — the dashboard
            // resolves its course by that (`resolveCourseBySlug`) and the two
            // are independently authored, so they can differ.
            slug: coursePage.course.slug,
            id: coursePage.course.id,
            organizationSlug: params.slug,
          },
          { surface: 'dashboard' }
        )
      );
    }
  }

  return {
    coursePage,
    orgSlug: params.slug,
    enrolled,
    // The authoritative offer the `invite` section prices itself from. Null when
    // the read failed — sections show no price rather than a wrong one.
    offer,
    draftPreview,
    // STREAM: public sell previews (no auth). `.catch()` → null on any failure.
    sellPreview: resolveSellPreview({
      pageId: coursePage.page.id,
      courseId: coursePage.course.id,
    }).catch(() => null),
  };
};
