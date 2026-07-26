import { DEFAULT_STREAMING_URL_TTL_SECONDS } from '@codex/access';
import type {
  CourseCardSummary,
  CourseDashboardData,
  CourseSellPreview,
  HonoEnv,
  InCoursePracticeData,
  JourneyCoursePage,
  JourneyCourseSummary,
  PracticeCompletionRecord,
} from '@codex/shared-types';
import {
  courseBySlugQuerySchema,
  courseParamsSchema,
  inCoursePracticeParamsSchema,
  listPublishedCoursesQuerySchema,
  recordCompletionBodySchema,
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
 * GET /api/journeys/courses?organizationId=
 *
 * List an org's PUBLISHED courses as discovery card summaries — the /explore
 * "Journeys" rail (SPEC §8.5). Fully PUBLIC (`auth: 'optional'`, NO `canView`;
 * HARDENING §E course-sell row), the same public-chrome surface as the sales
 * page. Returns `[]` when the org has no published courses. Declared BEFORE the
 * `/courses/:courseId/*` routes so the bare `/courses` match is unambiguous.
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
      return ctx.services.courseJourney.listPublishedCourses(organizationId);
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

export default app;
