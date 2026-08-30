import { DEFAULT_STREAMING_URL_TTL_SECONDS } from '@codex/access';
import { VersionedCache } from '@codex/cache';
import { ValidationError } from '@codex/service-errors';
import type {
  ContentCourseLinks,
  CourseCardSummary,
  CourseDashboardData,
  CourseSellPreview,
  EditorCurriculum,
  EnrolledCourseSummary,
  EnrolledJourneyCard,
  HonoEnv,
  InCoursePracticeData,
  JourneyCardView,
  JourneyCoursePage,
  JourneyCourseSummary,
  JourneyListItem,
  JourneyPageRecord,
  JourneySellMedia,
  PageOffer,
  PracticeCompletionRecord,
} from '@codex/shared-types';
import {
  contentCoursesParamsSchema,
  courseBySlugQuerySchema,
  courseParamsSchema,
  createJourneyBodySchema,
  inCoursePracticeParamsSchema,
  journeyOrgQuerySchema,
  journeyPageParamsSchema,
  journeyStudioListQuerySchema,
  listPublishedCoursesQuerySchema,
  listPublishedJourneysQuerySchema,
  MAX_IMAGE_SIZE_BYTES,
  recordCompletionBodySchema,
  SUPPORTED_IMAGE_MIME_TYPES,
  saveCurriculumBodySchema,
  saveJourneyPageBodySchema,
  setJourneyFeaturedBodySchema,
  updateJourneyOfferBodySchema,
  updateJourneySellMediaBodySchema,
  userEnrollmentsQuerySchema,
} from '@codex/validation';
import { multipartProcedure, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import {
  bumpOrgJourneysVersion,
  getCachedPublishedCourses,
  getCachedPublishedJourneys,
  isPublicPortalRead,
  PUBLIC_JOURNEYS_CACHE_CONTROL,
} from './journeys-cache';

/**
 * Journey member-surface routes (Codex-2pryk · Round-D · Codex-776gg).
 *
 * The web→worker plumbing behind the course DASHBOARD and IN-COURSE PLAYER
 * (SPEC §11 / §14) plus the PUBLIC COURSE SALES PAGE (SPEC §4/§5/§10). Co-located
 * on content-api (port 4001) with the access + streaming routes because the
 * in-course player needs a signed R2 URL from the SAME
 * `ContentAccessService.getStreamingUrl` the `/stream` route uses.
 *
 * Split of concerns (routes stay thin):
 *   - `ctx.services.courseJourney` — curriculum + progress + completion reads,
 *     and the public sales-page + sell-preview projections.
 *   - `ctx.services.access`        — the entitlement GATE (`canEnterCourse`) and
 *     the signed-stream authority (`getStreamingUrl`, which itself gates on
 *     `canView`). Signing is NEVER reinvented here.
 *
 * The dashboard + practice reads gate on `canEnterCourse` (entitlement, SPEC
 * §6.3) and return `null` (→ `{ data: null }`) on deny, so an authenticated but
 * un-entitled caller never receives curriculum data. The sales-page + sell
 * -preview reads are fully PUBLIC (NO `canView`; HARDENING §E course-sell row).
 */

const app = new Hono<HonoEnv>();

/**
 * CDN `Cache-Control` for the PUBLIC portal reads only (Codex-72k55).
 *
 * Registered on `'*'` but gated by an exact-path ALLOW-LIST rather than a path
 * pattern, because this router mixes public reads with `auth: 'required'`
 * (`/enrolled`, `/user/enrollments`), entitlement-gated reads
 * (`/courses/:courseId/dashboard`) and `requireOrgManagement` studio routes.
 * `public.ts` can safely blanket its whole router; this one cannot. See
 * `isPublicPortalRead` for why the allow-list is not a wildcard.
 */
app.use('*', async (c, next) => {
  await next();
  if (isPublicPortalRead(c.req.path)) {
    c.header('Cache-Control', PUBLIC_JOURNEYS_CACHE_CONTROL);
  }
});

/**
 * GET /api/journeys/courses?organizationId=
 *
 * List an org's PUBLISHED courses as discovery card summaries — the /explore
 * "Journeys" rail (SPEC §8.5). Fully PUBLIC (`auth: 'optional'`, NO `canView`;
 * HARDENING §E course-sell row), the same public-chrome surface as the sales
 * page. Returns `[]` when the org has no published courses. Declared BEFORE the
 * `/courses/:courseId/*` routes so the bare `/courses` match is unambiguous.
 *
 * Cache: KV cache-aside under `COLLECTION_ORG_JOURNEYS(orgId)` (Codex-72k55),
 * the same version key the landing rails use, so one portal write stales this
 * rail and those together. CDN header set per-route — see
 * `PUBLIC_JOURNEYS_CACHE_CONTROL` for why this router cannot use `app.use('*')`.
 * @returns {CourseCardSummary[]}
 */
app.get(
  '/courses',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: listPublishedCoursesQuerySchema,
    },
    handler: async (ctx): Promise<CourseCardSummary[]> => {
      const { organizationId } = ctx.input.query;

      const fetchCourses = () =>
        ctx.services.courseJourney.listPublishedCourses(
          organizationId,
          ctx.env.R2_PUBLIC_URL_BASE
        );

      if (!ctx.env.CACHE_KV) return fetchCourses();

      // `waitUntil` is REQUIRED on every read path (Codex-e32xz): without it
      // the data-slot put is cancelled when the response returns and the cache
      // never records a hit.
      const cache = new VersionedCache({
        kv: ctx.env.CACHE_KV,
        waitUntil: (p) => ctx.executionCtx.waitUntil(p),
      });
      return getCachedPublishedCourses(cache, organizationId, fetchCourses);
    },
  })
);

/**
 * GET /api/journeys/courses/by-slug?organizationId=&slug=
 *
 * Resolve a course summary (chrome + URL building) by its org-scoped slug.
 * `auth: 'optional'` — returns only PUBLISHED-course public chrome, so it serves
 * both the member flow and public landings; no user data leaks. Returns `null`
 * when no such course exists.
 * @returns {JourneyCourseSummary | null}
 */
app.get(
  '/courses/by-slug',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: courseBySlugQuerySchema,
    },
    handler: async (ctx): Promise<JourneyCourseSummary | null> => {
      const { organizationId, slug } = ctx.input.query;
      return ctx.services.courseJourney.getCourseBySlug(organizationId, slug);
    },
  })
);

/**
 * GET /api/journeys/content/:contentId/courses
 *
 * The PUBLISHED course(s) that include a content item as a practice — the
 * standalone content page's journey cross-link (Codex-2pryk.3.10, F19/F20).
 * `auth: 'optional'` and fully PUBLIC: it reveals only published-course public
 * chrome (title/slug/org), never body or stream (NO `canView`), so it serves an
 * anonymous visitor the same as an owner — mirroring the by-slug / sales-page
 * reads (HARDENING §E course-sell row). Returns `{ courses: [] }` when the item
 * belongs to no published course.
 * @returns {ContentCourseLinks}
 */
app.get(
  '/content/:contentId/courses',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      params: contentCoursesParamsSchema,
    },
    handler: async (ctx): Promise<ContentCourseLinks> => {
      const { contentId } = ctx.input.params;
      return ctx.services.courseJourney.getContentCourses(contentId);
    },
  })
);

/**
 * GET /api/journeys/pages/by-slug?organizationId=&slug=
 *
 * The awaited shell of the PUBLIC course sales page (SPEC §4/§5): the published
 * landing page + its subject course + ordered curriculum + testimonials, as one
 * `JourneyCoursePage` envelope. Fully PUBLIC — `auth: 'optional'`, NO `canView`
 * on the shell (HARDENING §E course-sell row); the org is resolved web-side and
 * passed as `organizationId` (the slug is org-scoped, mirroring `by-slug`).
 * Returns `null` when no published page/course matches (→ the load 404s). The
 * streamed sell-preview media is a separate read (`sell-preview` below).
 * @returns {JourneyCoursePage | null}
 */
app.get(
  '/pages/by-slug',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      // Same `{ organizationId, slug }` shape as the course by-slug read — here
      // `slug` is the org-scoped LANDING-PAGE slug (both are varchar(160)).
      query: courseBySlugQuerySchema,
    },
    handler: async (ctx): Promise<JourneyCoursePage | null> => {
      const { organizationId, slug } = ctx.input.query;
      // The URL base is env-owned, so the ROUTE supplies it and the service
      // resolves `courses.coverImageKey` → the page's `og:image` (the sell
      // page's only share image; the hero still is on the STREAMED read).
      return ctx.services.courseJourney.getCoursePage(
        organizationId,
        slug,
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

/**
 * GET /api/journeys/courses/:courseId/sell-preview
 *
 * The STREAMED, off-critical-path payload of the sales page (SPEC §10): the
 * public 30s intro-film + practice-reel clips, plus the guide's portrait still and
 * talking-head clip (journey-sections contract A15 — both guide slots were
 * write-only codebase-wide before it, so the published guide section could never
 * show either). Fully PUBLIC (`auth: 'optional'`,
 * NO `canView`). Clips reuse the SAME public preview path the org-landing hero
 * consumes — `mediaItems.hlsPreviewKey` → a CDN URL via `R2_PUBLIC_URL_BASE`,
 * NO R2 signing (mirrors `public.ts` `resolveR2Urls`). The URL base is supplied
 * by the route (env-owned) and resolved inside the service. Returns `null` when
 * the course is not published/non-deleted; a clip is `null` when its media has
 * no transcoded preview.
 * @returns {CourseSellPreview | null}
 */
app.get(
  '/courses/:courseId/sell-preview',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      params: courseParamsSchema,
    },
    handler: async (ctx): Promise<CourseSellPreview | null> => {
      const { courseId } = ctx.input.params;
      return ctx.services.courseJourney.getCourseSellPreview(
        courseId,
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

/**
 * GET /api/journeys/courses/:courseId/dashboard
 *
 * Dashboard payload (SPEC §11): enrollment + ordered stages + the
 * `practice_completions ⋈ stage_practices` rollup scoped to the user. Gated on
 * `canEnterCourse` (entitlement) — deny → `null`.
 * @returns {CourseDashboardData | null}
 */
app.get(
  '/courses/:courseId/dashboard',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      params: courseParamsSchema,
    },
    handler: async (ctx): Promise<CourseDashboardData | null> => {
      const userId = ctx.user.id;
      const { courseId } = ctx.input.params;

      const canEnter = await ctx.services.access.canEnterCourse(
        userId,
        courseId
      );
      if (!canEnter) return null;

      return ctx.services.courseJourney.getCourseDashboard(userId, courseId);
    },
  })
);

/**
 * GET /api/journeys/user/enrollments?organizationId=
 *
 * The member LIBRARY "Your journeys" shelf (SPEC §8.4): every course the CALLER
 * is enrolled in within one org, each with its progress rollup. The user is
 * derived from the session (`auth: 'required'`) — NEVER a query param — so the
 * read is strictly scoped to `(session user, organizationId)`; another user's
 * enrollments can never be requested. Returns `[]` when the caller has none.
 * @returns {EnrolledCourseSummary[]}
 */
app.get(
  '/user/enrollments',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: userEnrollmentsQuerySchema,
    },
    handler: async (ctx): Promise<EnrolledCourseSummary[]> => {
      const userId = ctx.user.id;
      const { organizationId } = ctx.input.query;
      return ctx.services.courseJourney.listEnrolledCourses(
        userId,
        organizationId,
        // Resolves each course's cover key to a CDN URL, exactly as `/enrolled`
        // and the public course list already do. Without it every library
        // journey card would report `coverImageUrl: null` and the DTO field
        // would be dead weight (Codex-tnwnu).
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

/**
 * GET /api/journeys/courses/:courseId/practices/:contentSlug
 *
 * In-course player payload (SPEC §14): the practice + ordered playlist +
 * server-known completions + resume position, plus a SIGNED streaming URL for
 * media (minted by `ContentAccessService.getStreamingUrl`, which enforces
 * `canView` + signs — the single authority). Written practices carry `bodyHtml`
 * and null stream URLs. Gated on `canEnterCourse` — deny → `null`.
 * @returns {InCoursePracticeData | null}
 */
app.get(
  '/courses/:courseId/practices/:contentSlug',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      params: inCoursePracticeParamsSchema,
    },
    handler: async (ctx): Promise<InCoursePracticeData | null> => {
      const userId = ctx.user.id;
      const { courseId, contentSlug } = ctx.input.params;

      const canEnter = await ctx.services.access.canEnterCourse(
        userId,
        courseId
      );
      if (!canEnter) return null;

      const data = await ctx.services.courseJourney.getInCoursePractice(
        userId,
        courseId,
        contentSlug
      );
      if (!data) return null;

      // Media practices get a signed HLS URL from the SAME signing authority the
      // /stream route uses (getStreamingUrl also re-checks canView). Written
      // practices render from bodyHtml — no stream, URLs stay null.
      if (data.practice.contentType !== 'written') {
        const stream = await ctx.services.access.getStreamingUrl(userId, {
          contentId: data.practice.contentId,
          expirySeconds: DEFAULT_STREAMING_URL_TTL_SECONDS,
        });
        return {
          ...data,
          streamingUrl: stream.streamingUrl,
          waveformUrl: stream.waveformUrl,
        };
      }

      return data;
    },
  })
);

/**
 * POST /api/journeys/practices/completions
 *
 * Record a practice completion, idempotently (SPEC §11 / D-E). The
 * `uq_practice_completion_user_content` unique index makes a repeat a no-op;
 * the service reads back the canonical row on conflict. Scoped to the
 * authenticated user — the body carries no userId.
 * @returns {PracticeCompletionRecord}
 */
app.post(
  '/practices/completions',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      body: recordCompletionBodySchema,
    },
    handler: async (ctx): Promise<PracticeCompletionRecord> => {
      const { contentId, source } = ctx.input.body;
      return ctx.services.courseJourney.recordPracticeCompletion(
        ctx.user.id,
        contentId,
        source
      );
    },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// MEMBER DISCOVERY (Codex-oi2w4 · home / explore / library surfacing)
//
// The public browse reads that make journeys reachable from the member space.
// `/published` is fully PUBLIC (`auth: 'optional'`, NO `canView`) — the org is
// resolved web-side and passed as `organizationId`. `/enrolled` is a PER-USER
// read (`auth: 'required'`) — `userId` comes from the SESSION (never the body);
// the org scopes the shelf to the space being browsed.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/journeys/published?organizationId=&featured=true&limit=
 *
 * Published course-journeys as public discovery cards (SPEC §8.5) — the org home
 * "featured" rail (`featured=true`) + the Explore grid (all). Fully PUBLIC; no
 * per-user state. Returns `[]` when the org has no published journeys.
 *
 * Cache: KV cache-aside under `COLLECTION_ORG_JOURNEYS(orgId)` (Codex-72k55), so
 * the portal rails join the content/categories/stats reads beside them on the
 * landing page instead of hitting Postgres every render. `featured` and `limit`
 * take separate data slots under the shared org version key — the landing page
 * reads this endpoint TWICE per render (featured picks + the full rail), so the
 * two must not collide.
 * @returns {JourneyCardView[]}
 */
app.get(
  '/published',
  procedure({
    policy: {
      auth: 'optional',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: listPublishedJourneysQuerySchema,
    },
    handler: async (ctx): Promise<JourneyCardView[]> => {
      const { organizationId, featured, limit } = ctx.input.query;
      const isFeatured = featured === 'true';

      const fetchJourneys = () =>
        ctx.services.courseJourney.listPublishedJourneys(organizationId, {
          featured: isFeatured,
          limit,
          r2PublicUrlBase: ctx.env.R2_PUBLIC_URL_BASE,
        });

      if (!ctx.env.CACHE_KV) return fetchJourneys();

      // See `/courses` above — `waitUntil` is what makes the write survive.
      const cache = new VersionedCache({
        kv: ctx.env.CACHE_KV,
        waitUntil: (p) => ctx.executionCtx.waitUntil(p),
      });
      return getCachedPublishedJourneys(
        cache,
        organizationId,
        { featured: isFeatured, limit },
        fetchJourneys
      );
    },
  })
);

/**
 * GET /api/journeys/enrolled?organizationId=
 *
 * The session user's enrolled journeys in the org, with a progress rollup — the
 * library "Your journeys" shelf + "Jump back in" continue rail (SPEC §8.4/§11).
 * `auth: 'required'`; `userId` from the session, `organizationId` scopes results
 * to the browsed space (a user only ever sees their OWN enrollments). Returns
 * `[]` for a user with no enrollments in the org.
 * @returns {EnrolledJourneyCard[]}
 */
app.get(
  '/enrolled',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: journeyOrgQuerySchema,
    },
    handler: async (ctx): Promise<EnrolledJourneyCard[]> => {
      return ctx.services.courseJourney.listEnrolledJourneys(
        ctx.user.id,
        ctx.input.query.organizationId,
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR / STUDIO management (Codex-isr02 · the page-builder write path)
//
// The authoring side of a journey — list / create / load-for-builder / save.
// AUTHORIZATION mirrors `journey-insights.ts`: `requireOrgManagement` (owner OR
// admin) re-derives the org from the session membership and sets
// `ctx.organizationId`. The `organizationId` in the query string is consumed
// ONLY by the procedure org resolver — every handler forwards `ctx.organizationId`
// (and `ctx.user.id` for the creator), NEVER the client value; the service ALSO
// scopes to that org, so a manager of org A can never touch org B's pages.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/journeys/studio/journeys?organizationId=&status=
 * The studio index — the org's journeys/pages, newest-edited first, optional
 * status filter, with `live` course rollups.
 * @returns {JourneyListItem[]}
 */
app.get(
  '/studio/journeys',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      query: journeyStudioListQuerySchema,
    },
    handler: async (ctx): Promise<JourneyListItem[]> => {
      return ctx.services.courseJourney.listJourneysForOrg(
        ctx.organizationId,
        ctx.input.query.status
      );
    },
  })
);

/**
 * POST /api/journeys/studio/journeys?organizationId=  { title, pageType }
 * Create a new journey (course → course + landing_page rows in one tx; landing →
 * page only), as a draft. Returns the new page id + slug (the builder navigates
 * to `/studio/journeys/:id/page`).
 * @returns {{ id: string; slug: string }}
 */
app.post(
  '/studio/journeys',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      query: journeyOrgQuerySchema,
      body: createJourneyBodySchema,
    },
    handler: async (ctx): Promise<{ id: string; slug: string }> => {
      return ctx.services.courseJourney.createJourney(
        ctx.organizationId,
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * GET /api/journeys/studio/journeys/preview/by-slug?organizationId=&slug=
 *
 * The STUDIO live-preview read (Codex-isr02 P0b-2): the same `JourneyCoursePage`
 * envelope as the public sell page but for ANY status, so the builder iframe can
 * render an UNPUBLISHED draft. `requireOrgManagement` AUTHORIZES the
 * client-supplied `organizationId` against the session user's owner/admin
 * membership before using it as `ctx.organizationId` (the handler forwards that
 * verified value, never the raw client one); a non-manager / foreign caller is
 * denied here, so the public sell load's preview fallback fail-closes to 404.
 * The 4-segment path cannot collide with `:pageId` (3 segments), and is
 * registered before it regardless.
 * @returns {JourneyCoursePage | null}
 */
app.get(
  '/studio/journeys/preview/by-slug',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      query: courseBySlugQuerySchema,
    },
    handler: async (ctx): Promise<JourneyCoursePage | null> => {
      return ctx.services.courseJourney.getCoursePagePreview(
        ctx.organizationId,
        ctx.input.query.slug,
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

/**
 * GET /api/journeys/studio/journeys/:pageId?organizationId=
 * Load a page draft into the builder (any status; org-scoped → null if foreign).
 * @returns {JourneyPageRecord | null}
 */
app.get(
  '/studio/journeys/:pageId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    handler: async (ctx): Promise<JourneyPageRecord | null> => {
      return ctx.services.courseJourney.getJourneyForBuilder(
        ctx.organizationId,
        ctx.input.params.pageId
      );
    },
  })
);

/**
 * PUT /api/journeys/studio/journeys/:pageId?organizationId=  { ...record }
 * Persist the builder's draft (sections/brand/title/slug/status). Publishing a
 * course page publishes its subject course too. 204 on success.
 * @returns {null}
 */
app.put(
  '/studio/journeys/:pageId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
      body: saveJourneyPageBodySchema,
    },
    handler: async (ctx): Promise<null> => {
      // The URL id and the body id must identify the SAME page — else the URL
      // names a different resource than the one mutated (audit/caching/least-
      // surprise; review L1). Not an IDOR — both are org-scoped by the service —
      // but a mismatch is a client bug, so reject it.
      if (ctx.input.params.pageId !== ctx.input.body.id) {
        throw new ValidationError(
          'Path id does not match the page id in the body'
        );
      }
      await ctx.services.courseJourney.saveJourneyPage(
        ctx.organizationId,
        ctx.input.body
      );
      // A save can flip `status` to published (or away from it) and can rewrite
      // the title the cards show, so the public rails must go stale.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return null;
    },
  })
);

/**
 * PATCH /api/journeys/studio/journeys/:pageId/offer?organizationId=  { ...offer }
 *
 * Set the journey's ways-in + prices (pence, GBP). The ONLY write path to a
 * course's price: it persists the page's offer presentation AND the authoritative
 * `courses.price_cents` in one transaction, so the sales page and the checkout can
 * never disagree about whether the journey is buyable.
 *
 * Separate from the page save (`PUT :pageId`) deliberately — pricing is a commerce
 * mutation with a different blast radius than page copy, and a creator must be able
 * to change a price without republishing the page body. `strict` rate limit for the
 * same reason (matching the checkout/sensitive-mutation preset).
 *
 * The 4-segment path cannot collide with the 3-segment `:pageId` route.
 * @returns {PageOffer}
 */
app.patch(
  '/studio/journeys/:pageId/offer',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
      body: updateJourneyOfferBodySchema,
    },
    handler: async (ctx): Promise<PageOffer> => {
      const offer = await ctx.services.courseJourney.updateJourneyOffer(
        ctx.organizationId,
        ctx.input.params.pageId,
        ctx.input.body
      );
      // `priceCents` is on every portal card, so a price change that did not
      // reach the rails would advertise the OLD price for up to the cache TTL.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return offer;
    },
  })
);

/**
 * GET /api/journeys/studio/journeys/:pageId/media?organizationId=
 *
 * The journey's SELL MEDIA (Codex-eqh0z): the four `media_items` refs the sales
 * page's `introVideo` / `reel` / `guide` sections resolve their primary content
 * from, plus the still cover URL. The builder's media panel opens on this.
 *
 * Separate from `GET :pageId` (the page draft) because these columns live on the
 * subject COURSE, not the landing page, and because the page-save body is
 * `.strict()` — folding them into that record would make every save 400.
 * @returns {JourneySellMedia}
 */
app.get(
  '/studio/journeys/:pageId/media',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    handler: async (ctx): Promise<JourneySellMedia> => {
      return ctx.services.courseJourney.getJourneySellMedia(
        ctx.organizationId,
        ctx.input.params.pageId,
        ctx.env.R2_PUBLIC_URL_BASE
      );
    },
  })
);

/**
 * PATCH /api/journeys/studio/journeys/:pageId/media?organizationId=  { ...ids }
 *
 * Set the journey's sell media — the write path that did not exist before
 * Codex-eqh0z, which is why `introVideo`, `reel` and `guide` could never show
 * their primary content.
 *
 * A TOTAL write: an omitted slot is `null` and CLEARS. Every non-null id is
 * org-scoped in the service (the media's creator must hold an active membership
 * in this org) and a foreign id is rejected with 403 BEFORE anything is written
 * — `media_items` has no `organization_id`, so the FK alone would accept another
 * org's media onto this org's public sales page.
 *
 * The 4-segment path cannot collide with the 3-segment `:pageId` route.
 * @returns {JourneySellMedia}
 */
app.patch(
  '/studio/journeys/:pageId/media',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
      body: updateJourneySellMediaBodySchema,
    },
    handler: async (ctx): Promise<JourneySellMedia> =>
      // The write path does not touch the two UPLOADED stills (the cover and,
      // since A32, the hero image), but their keys come back on the same
      // `.returning()` row — so the base goes IN and the service resolves them.
      //
      // This replaces a second, full `getJourneySellMedia` read that existed
      // purely to recover `coverImageUrl` from the hard `null` the service used
      // to echo. One round-trip instead of two, and — the reason for the change —
      // the hero image would otherwise have needed the identical compensation
      // added here a second time.
      ctx.services.courseJourney.updateJourneySellMedia(
        ctx.organizationId,
        ctx.input.params.pageId,
        ctx.input.body,
        ctx.env.R2_PUBLIC_URL_BASE
      ),
  })
);

/**
 * PATCH /api/journeys/studio/journeys/:pageId/featured?organizationId=  { featured }
 *
 * Feature (or un-feature) a journey portal on the ORG HOMEPAGE — the write path to
 * `landing_pages.featured` that did not exist before. `GET /published?featured=true`
 * has filtered on this column since it shipped, so the home rail was readable but
 * never curatable: it showed whatever a seed happened to set.
 *
 * Separate from the page save (`PUT :pageId`) deliberately — that body is `.strict()`
 * AND shared with the builder's autosave, so folding `featured` in would either 400
 * every existing save or silently drop the value while reporting "Page saved" (the
 * failure `offer` and `seo` already caused there). Curation is also a different
 * gesture from authoring: the creator features a finished portal from the studio
 * index without reopening its body.
 *
 * `rateLimit: 'api'` (100/min), NOT the sibling offer route's `strict` (20/min) — the
 * divergence is deliberate: featuring is a cheap, reversible curation toggle, and a
 * creator arranging the homepage rail flips several portals in one sitting. `strict`
 * would lock them out mid-curation. Pricing earns `strict` because it moves money;
 * this does not.
 *
 * Orthogonal to publish status — the published-journeys read filters `status` on its
 * own, so featuring a draft stores intent with no public effect.
 *
 * The 4-segment path cannot collide with the 3-segment `:pageId` route.
 * @returns 204 No Content
 */
app.patch(
  '/studio/journeys/:pageId/featured',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
      body: setJourneyFeaturedBodySchema,
    },
    handler: async (ctx): Promise<null> => {
      await ctx.services.courseJourney.setJourneyFeatured(
        ctx.organizationId,
        ctx.input.params.pageId,
        ctx.input.body.featured
      );
      // `featured` decides which rail a card appears in AND leads the ordering of
      // both, so the featured and unfeatured slots must BOTH go stale. One bump
      // on the shared org version key does that atomically.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return null;
    },
  })
);

/**
 * POST /api/journeys/studio/journeys/:pageId/cover?organizationId=
 *
 * Upload (or replace) the journey's still COVER image — the poster the journey
 * card renders (Codex-eqh0z). `courses` had three VIDEO refs and no poster
 * column at all, which is why `JourneyCard` was typographic-only.
 *
 * Content-Type: multipart/form-data. Form field: `cover` (file).
 *
 * The cover is NOT a `media_items` ref: `media_items` is CHECK-constrained to
 * ('video','audio'), so a still image cannot live there. It reuses the category
 * cover pipeline instead — sm/md/lg WebP variants under a deterministic
 * per-course key, so a re-upload overwrites in place and never orphans an
 * object. The page is resolved (and org-scoped) BEFORE R2 is written, so an
 * out-of-org id can never seed an orphaned cover.
 * @returns {{ coverImageUrl: string }}
 */
app.post(
  '/studio/journeys/:pageId/cover',
  multipartProcedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    files: {
      cover: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx): Promise<{ coverImageUrl: string }> => {
      // Resolve (and org-scope) the subject course FIRST — a foreign or
      // non-course page must 404 before any R2 object exists.
      const courseId = await ctx.services.courseJourney.resolveCourseIdForPage(
        ctx.organizationId,
        ctx.input.params.pageId
      );

      const processed = await ctx.services.imageProcessing.processCourseCover(
        courseId,
        new File([ctx.files.cover.buffer], ctx.files.cover.name, {
          type: ctx.files.cover.type,
        })
      );

      // The org-aware service owns the DB write (same split as categories).
      await ctx.services.courseJourney.setCourseCoverImageKey(
        ctx.organizationId,
        ctx.input.params.pageId,
        processed.coverImageKey
      );

      // `coverImageUrl` is on every portal card — without this bump a creator
      // uploads a cover, sees it in the builder, and the rails keep rendering the
      // typographic fallback until the TTL lapses.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );

      return { coverImageUrl: processed.url };
    },
  })
);

/**
 * DELETE /api/journeys/studio/journeys/:pageId/cover?organizationId=
 *
 * Clear the journey's cover — the card falls back to its typographic form.
 *
 * Clears the DB key only; the R2 variants are left in place. Keys are
 * deterministic per course id, so a later re-upload overwrites them rather than
 * accumulating orphans, and the objects are unreachable in the meantime (no
 * client is ever handed a raw key).
 * @returns {null} 204
 */
app.delete(
  '/studio/journeys/:pageId/cover',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    successStatus: 204,
    handler: async (ctx): Promise<null> => {
      await ctx.services.courseJourney.setCourseCoverImageKey(
        ctx.organizationId,
        ctx.input.params.pageId,
        null
      );
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return null;
    },
  })
);

/**
 * POST /api/journeys/studio/journeys/:pageId/hero-image?organizationId=
 *
 * Upload (or replace) the journey's HERO IMAGE — the still the sales page's
 * loudest section paints (Codex-490z7, contract amendment A32).
 *
 * Content-Type: multipart/form-data. Form field: `image` (file).
 *
 * WHY A SECOND STILL ENDPOINT rather than a slot on the cover route: the two
 * stills are different sizes with different jobs (the cover serves a card at
 * `md`, the hero paints edge to edge at `lg`) and they clear independently. A
 * `?slot=` discriminator on one route would make the response shape conditional
 * and give both a single cache-bump story they do not share.
 *
 * Modelled verbatim on the cover route above, including the ORDERING that matters:
 * the page is resolved (and org-scoped) BEFORE R2 is written, so an out-of-org or
 * non-course page 404s and can never seed an orphaned object. The hero is NOT a
 * `media_items` ref — that table is CHECK-constrained to ('video','audio'), which
 * is precisely why this endpoint had to exist for a creator to use a photograph.
 * Keys are deterministic per course, so a re-upload overwrites in place.
 * @returns {{ heroImageUrl: string }}
 */
app.post(
  '/studio/journeys/:pageId/hero-image',
  multipartProcedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    files: {
      image: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx): Promise<{ heroImageUrl: string }> => {
      // Resolve (and org-scope) the subject course FIRST — a foreign or
      // non-course page must 404 before any R2 object exists.
      const courseId = await ctx.services.courseJourney.resolveCourseIdForPage(
        ctx.organizationId,
        ctx.input.params.pageId
      );

      const processed = await ctx.services.imageProcessing.processCourseHero(
        courseId,
        new File([ctx.files.image.buffer], ctx.files.image.name, {
          type: ctx.files.image.type,
        })
      );

      // The org-aware service owns the DB write (same split as the cover).
      await ctx.services.courseJourney.setCourseHeroImageKey(
        ctx.organizationId,
        ctx.input.params.pageId,
        processed.heroImageKey
      );

      // BELT AND BRACES, and stated honestly rather than copied from the cover.
      // I checked what the org journeys version actually keys: only the two
      // CACHED list reads (`getCachedPublishedCourses` :134,
      // `getCachedPublishedJourneys` :477). The hero image reaches a visitor
      // through `/courses/:courseId/sell-preview`, which is an UNCACHED read, and
      // no card carries a hero today — so unlike the cover, this bump changes
      // nothing a creator can currently see.
      //
      // It stays for two reasons: the two still-image endpoints must not diverge
      // in their cache story for a reader to have to work out which one bumps,
      // and the moment a card does render a hero the omission would be a stale
      // rail with no obvious cause. The cost is one KV write on an
      // org-manager-only, rate-limited route.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );

      return { heroImageUrl: processed.url };
    },
  })
);

/**
 * DELETE /api/journeys/studio/journeys/:pageId/hero-image?organizationId=
 *
 * Clear the journey's uploaded hero image.
 *
 * This does NOT leave the hero blank — it drops the page back to A32's next link,
 * `courses.heroMediaId`'s poster frame, and then to the section's synthetic
 * plate. That graceful degradation is why the uploaded image is its own column
 * rather than a replacement for the media ref.
 *
 * Clears the DB key only; the R2 variants are left in place. Keys are
 * deterministic per course id, so a later re-upload overwrites them rather than
 * accumulating orphans, and the objects are unreachable in the meantime (no
 * client is ever handed a raw key).
 * @returns {null} 204
 */
app.delete(
  '/studio/journeys/:pageId/hero-image',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    successStatus: 204,
    handler: async (ctx): Promise<null> => {
      await ctx.services.courseJourney.setCourseHeroImageKey(
        ctx.organizationId,
        ctx.input.params.pageId,
        null
      );
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return null;
    },
  })
);

/**
 * GET /api/journeys/studio/journeys/:pageId/curriculum?organizationId=
 *
 * The admin CURRICULUM read for the two-pane editor (Codex-03cwh): the journey's
 * subject-course stages + practice joins, INCLUDING practices whose linked
 * content is still a draft (unlike the public/member reads), each with the
 * picker metadata the inspector needs (title/type/thumbnail/status). The course
 * is resolved from the landing-page `:pageId` (org-scoped) — a foreign, missing,
 * or non-course page 404s. The 4-segment path cannot collide with the 3-segment
 * `:pageId` route.
 * @returns {EditorCurriculum}
 */
app.get(
  '/studio/journeys/:pageId/curriculum',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
    },
    handler: async (ctx): Promise<EditorCurriculum> => {
      const courseId = await ctx.services.courseJourney.resolveCourseIdForPage(
        ctx.organizationId,
        ctx.input.params.pageId
      );
      return ctx.services.courseJourney.getCourseCurriculumForEditor(
        ctx.organizationId,
        courseId
      );
    },
  })
);

/**
 * PUT /api/journeys/studio/journeys/:pageId/curriculum?organizationId=  { stages }
 *
 * Bulk-save the whole curriculum (stages + practice joins) for the journey's
 * subject course in ONE transaction — diff against the persisted state and
 * reconcile (insert/rename/reorder/soft-delete stages; insert/remove/reorder
 * practice joins), space-guarding every practice's content to the course's org.
 * The stage reorder respects the `(courseId, sortOrder)` unique index. Returns
 * the freshly-persisted curriculum (server ids for newly-added stages).
 * @returns {EditorCurriculum}
 */
app.put(
  '/studio/journeys/:pageId/curriculum',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api',
    },
    input: {
      params: journeyPageParamsSchema,
      query: journeyOrgQuerySchema,
      body: saveCurriculumBodySchema,
    },
    handler: async (ctx): Promise<EditorCurriculum> => {
      const courseId = await ctx.services.courseJourney.resolveCourseIdForPage(
        ctx.organizationId,
        ctx.input.params.pageId
      );
      const curriculum = await ctx.services.courseJourney.saveCurriculum(
        ctx.organizationId,
        courseId,
        ctx.input.body
      );
      // Every card reports `stageCount`/`practiceCount`, which this write is the
      // authoring path for.
      bumpOrgJourneysVersion(
        ctx.env,
        ctx.executionCtx,
        ctx.organizationId,
        ctx.obs
      );
      return curriculum;
    },
  })
);

export default app;
