import { DEFAULT_STREAMING_URL_TTL_SECONDS } from '@codex/access';
import { ValidationError } from '@codex/service-errors';
import type {
  CourseDashboardData,
  CourseSellPreview,
  EditorCurriculum,
  EnrolledJourneyCard,
  HonoEnv,
  InCoursePracticeData,
  JourneyCardView,
  JourneyCoursePage,
  JourneyCourseSummary,
  JourneyListItem,
  JourneyPageRecord,
  PracticeCompletionRecord,
} from '@codex/shared-types';
import {
  courseBySlugQuerySchema,
  courseParamsSchema,
  createJourneyBodySchema,
  inCoursePracticeParamsSchema,
  journeyOrgQuerySchema,
  journeyPageParamsSchema,
  journeyStudioListQuerySchema,
  listPublishedJourneysQuerySchema,
  recordCompletionBodySchema,
  saveCurriculumBodySchema,
  saveJourneyPageBodySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

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
      return ctx.services.courseJourney.getCoursePage(organizationId, slug);
    },
  })
);

/**
 * GET /api/journeys/courses/:courseId/sell-preview
 *
 * The STREAMED, off-critical-path payload of the sales page (SPEC §10): the
 * public 30s intro-film + practice-reel clips. Fully PUBLIC (`auth: 'optional'`,
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
      return ctx.services.courseJourney.listPublishedJourneys(organizationId, {
        featured: featured === 'true',
        limit,
      });
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
        ctx.input.query.organizationId
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
        ctx.input.query.slug
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
      return ctx.services.courseJourney.saveCurriculum(
        ctx.organizationId,
        courseId,
        ctx.input.body
      );
    },
  })
);

export default app;
