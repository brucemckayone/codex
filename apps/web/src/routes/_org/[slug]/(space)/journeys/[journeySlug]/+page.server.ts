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
import { extractPlainText } from '@codex/validation';
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
  // AWAIT the offer alongside it (Codex-2pryk.2.4.3): every price and every path
  // on this page is read from the authoritative `getCourseOffer` rather than from
  // the authored `priceLabel` a creator typed into the builder.
  // `.catch(() => null)` because a pricing hiccup must not 500 an SEO-critical
  // sales page — the sections degrade to a price-less CTA and never fall back to
  // authored numbers.
  //
  // ── THIS COMMENT USED TO CLAIM THE AWAIT WAS FREE. IT IS NOT. ──────────────
  // It read "it runs in PARALLEL with the enrolment check, so this adds no
  // wall-clock to the critical path". True for a signed-in visitor, FALSE for an
  // anonymous one — the case the paragraph above calls the SEO-critical common
  // case. With no session the enrolment leg is already-resolved
  // `Promise.resolve(false)`, so there is nothing to overlap and the offer's full
  // round-trip is the load's THIRD serial hop (`parent()` → `getCoursePage`,
  // itself two worker calls → `courses.offer`), landing entirely on TTFB. The
  // response is `private, no-cache` (see the cache decision below), so there is
  // no shared cache to absorb it and every crawl pays it again.
  //
  // MEASURED — dev stack, studio-alpha/bone-deep, signed out, curl
  // `time_starttransfer`, A/B interleaved over two rounds, min of n=8 (the
  // statistic least polluted by a busy dev box):
  //     offer awaited                          2.144s · 2.710s
  //     offer replaced by Promise.resolve      1.094s · 1.189s
  // and `GET /courses/:id/offer` alone is p50 0.97s (n=15). So the hop is real,
  // and here it is about a second.
  //
  // IT STAYS AWAITED ANYWAY, because what reads it changed after that claim was
  // written. The offer is no longer consumed only by the below-the-fold `invite`
  // section: `JourneyRenderer` derives `purchasable` from it
  // (`render/JourneyRenderer.svelte:118`), and that flag decides whether the
  // ABOVE-THE-FOLD hero CTA exists at all (`render/sections/HeroSection.svelte`)
  // and whether the floating pill renders. `+page.svelte` also prices the page's
  // JSON-LD and `product:price:*` from it, and a head is flushed long before a
  // streamed promise settles. Streaming would ship first paint — and the SSR HTML
  // a crawler reads — with the page's primary conversion affordance missing and
  // its machine-readable price absent. That trades a second of TTFB for a wrong
  // page, so this is now a DELIBERATE first-paint dependency, not an oversight.
  //
  // THE REAL FIX, which does not belong in this file: the offer is auth-agnostic
  // apart from its `entitled` flag, changes only through the three studio
  // monetisation writes, and is keyed by a stable course id — the exact shape
  // `@codex/cache` `VersionedCache` exists for. Cache it in the worker under a
  // version key, or fold it into the `access.coursePage` read so it costs no
  // extra hop, and the second goes away without moving it off the critical path.
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
  // the hero CTA relabelled. Send them to their dashboard instead.
  //
  // ON THE ORDERING — this sits after `setHeaders` because that call has to run
  // before any throw or it never runs at all; the redirect must not be able to
  // skip it. It does NOT mean the 303 carries those headers. Verified against the
  // installed SvelteKit 2.55.0 source: a `Redirect` thrown from a load unwinds to
  // the outer catch in `runtime/server/respond.js:514`, which builds the response
  // with `redirect_response()` (`runtime/server/utils.js:136` —
  // `new Response(undefined, { status, headers: { location } })`) and then adds
  // ONLY cookies. The `setHeaders` bag is applied in the `resolve()` SUCCESS
  // continuation (`respond.js:441`), which a thrown redirect never reaches. So the
  // 303 carries `location` alone. Harmless: it has no body and a 303 is not
  // heuristically cacheable by shared caches, so there is nothing to leak.
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
  // BYPASS: a `preview` query param (the builder's View-live link sends
  // `?preview=1`) or `draftPreview` — which can only be true when the
  // management-gated preview read succeeded, so it is already proof the viewer is
  // an org manager. A creator inspecting their own page must see the page, not
  // their dashboard, and no role or membership read is needed to tell.
  //
  // The test is `.has()`, so ANY value bypasses — `?preview=0` and
  // `?preview=false` included. Deliberate: PRESENCE is the signal, matching the
  // `searchParams.has('session_id')` idiom in checkout/success/+page.server.ts.
  // Being loose costs nothing here — the sell page is fully public to anonymous
  // visitors, so this redirect is a UX convenience and not a security boundary.
  // The most a hand-typed `?preview=anything` earns is the marketing page the
  // same person could already read while signed out.
  if (!(url.searchParams.has('preview') || draftPreview)) {
    const gate = evaluateCourseGate({
      // A slug with no page/course already threw 404 above.
      courseExists: true,
      isAuthenticated: Boolean(user),
      canEnterCourse: enrolled,
    });
    // A course with no slug has NO reachable dashboard URL, so there is nowhere
    // confident to send anyone: `buildJourneyUrl` would fall back to
    // `journey.id`, and the dashboard resolves its course by SLUG only
    // (`resolveCourseBySlug`), so `/journeys/<uuid>/dashboard` is a guaranteed 404
    // the visitor cannot escape — every retry of the sell page would 303 them
    // straight back into it. Treated as doubt, and doubt means render where you
    // are, exactly as a failed entitlement lookup does.
    //
    // Currently unreachable: `courses.slug` is `.notNull()`
    // (packages/database/src/schema/journeys.ts:134) and `JourneyCourseView.slug`
    // is `string` (packages/shared-types/src/journeys.ts:650). The guard is here
    // because `apps/web` has `strictNullChecks` OFF, so if that DTO were ever
    // relaxed — as the sibling `JourneyCourseSummary.slug` (`string | null`,
    // :391) already is — nothing would warn and this would silently become a
    // dead-end redirect.
    //
    // NOTE this does NOT mirror the dashboard's `course?.id ?? params.journeySlug`
    // fallback, and deliberately so. The dashboard can fall back because its
    // target — the sell page — resolves by PAGE slug, which is exactly what
    // `params.journeySlug` holds, so the fallback URL genuinely works. Going the
    // other way the key changes (page slug → course slug), so the mirrored
    // fallback would build a URL that resolves to nothing. Not redirecting is the
    // only option here that keeps a way back.
    if (gate.kind === 'ok' && coursePage.course.slug) {
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

  // ── The head tags the ROOT LAYOUT renders on this page's behalf (O32) ───────
  // `routes/+layout.svelte` used to emit `<meta name="description">` and
  // `og:type` unconditionally, and `<svelte:head>` dedupes only `<title>` — so a
  // page that set its own got TWO tags rather than an override. Measured on a
  // journey page before this change, in document order:
  //     meta[property="og:type"]  ["website", "product"]
  //     meta[name="description"]  ["Discover transformative content from
  //                                 independent creators", "<the course lede>"]
  // A parser takes the FIRST value of a repeated Open Graph property, so the
  // page's own `og:type="product"` was dead on arrival, and every journey page's
  // search snippet was shadowed by the generic platform tagline.
  //
  // The root now renders exactly one of each FROM THIS BAG (falling back to the
  // platform defaults when a load publishes none), which is why these two values
  // are computed here and NOT in `+page.svelte`'s `<svelte:head>`: two emitters
  // is the bug, so there is deliberately only one.
  //
  // `||`, never `??`: a creator who BLANKS the SEO panel's description leaves an
  // empty string behind, and an empty `<meta content="">` is worse than the
  // derived lede. Same reason `extractPlainText` is chained with `||` — a lede
  // that is structurally valid TipTap JSON with no text nodes extracts to '',
  // which the old `course.lede ? extractPlainText(...) : fallback` shape would
  // have published as an empty description.
  const pageMeta = {
    description:
      coursePage.page.seo?.description ||
      extractPlainText(coursePage.course.lede) ||
      `${coursePage.course.title} — a guided course.`,
    // `product`, not `website`: this page sells one thing, and the
    // `product:price:*` meta `+page.svelte` emits only makes sense under that
    // vertical. Matches the `ContentDetailView` precedent of overriding the root's
    // vertical per surface — except that it now actually overrides it.
    ogType: 'product' as const,
  };

  return {
    coursePage,
    orgSlug: params.slug,
    enrolled,
    // Rendered by the ROOT layout, once, so the page overrides rather than
    // duplicates. See the derivation above.
    pageMeta,
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
