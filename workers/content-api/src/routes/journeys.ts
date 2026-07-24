import { DEFAULT_STREAMING_URL_TTL_SECONDS } from '@codex/access';
import type {
  CourseDashboardData,
  HonoEnv,
  InCoursePracticeData,
  JourneyCourseSummary,
  PracticeCompletionRecord,
} from '@codex/shared-types';
import {
  courseBySlugQuerySchema,
  courseParamsSchema,
  inCoursePracticeParamsSchema,
  recordCompletionBodySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

/**
 * Journey member-surface routes (Codex-2pryk · Round-D · Codex-776gg).
 *
 * The web→worker plumbing behind the course DASHBOARD and IN-COURSE PLAYER
 * (SPEC §11 / §14). Co-located on content-api (port 4001) with the access +
 * streaming routes because the in-course player needs a signed R2 URL from the
 * SAME `ContentAccessService.getStreamingUrl` the `/stream` route uses.
 *
 * Split of concerns (routes stay thin):
 *   - `ctx.services.courseJourney` — curriculum + progress + completion reads.
 *   - `ctx.services.access`        — the entitlement GATE (`canEnterCourse`) and
 *     the signed-stream authority (`getStreamingUrl`, which itself gates on
 *     `canView`). Signing is NEVER reinvented here.
 *
 * The dashboard + practice reads gate on `canEnterCourse` (entitlement, SPEC
 * §6.3) and return `null` (→ `{ data: null }`) on deny, so an authenticated but
 * un-entitled caller never receives curriculum data.
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
