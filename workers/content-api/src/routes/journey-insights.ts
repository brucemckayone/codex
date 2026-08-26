import type { JourneyInsightsData } from '@codex/access';
import type { HonoEnv } from '@codex/shared-types';
import {
  journeyInsightsQuerySchema,
  orgJourneyRevenueQuerySchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

/**
 * Journey STUDIO-insights route (Codex-2pryk · Round-D · Codex-776gg · WP-7).
 *
 * The owner/admin reporting read for one course: `live` (financial) + `course`
 * (engagement) metrics for a reporting period (SPEC §11 / §14.4). Co-located on
 * content-api (port 4001) with the member-surface journey routes because the
 * engagement tables (`course_enrollments` / `practice_completions`) are owned by
 * `@codex/access`; the course-attributable money (`purchases.courseId`,
 * `course_subscriptions`, `payouts.courseSubscriptionId`) is read from the shared
 * schema in the same worker, so no cross-worker hop is needed.
 *
 * Mounted at `/api/journeys/insights` BEFORE `/api/journeys` in the worker (the
 * more-specific-prefix-first pattern the worker already uses for
 * `/api/content/public` before `/api/content`).
 *
 * AUTHORIZATION: `requireOrgManagement` (owner OR admin) re-derives the org from
 * the session membership and sets `ctx.organizationId`. The `organizationId` in
 * the query string is consumed ONLY by the procedure org resolver — the handler
 * forwards `ctx.organizationId`, NEVER the client value, so a client cannot
 * redirect the query to another org. Defence in depth: both the page→course
 * resolution and the service additionally scope to the managed org (a foreign
 * pageId or courseId → 404, never a leak).
 */
const app = new Hono<HonoEnv>();

/**
 * GET /api/journeys/insights?organizationId=&pageId=&period=
 *
 * Keyed by LANDING-PAGE id, like every other studio journey route — the studio
 * URL `/studio/journeys/[id]/insights` carries the page id, and `listJourneys`
 * returns page ids. The course-keyed aggregation therefore needs one resolution
 * hop first (Codex-xo3bl): before this, the route took the page id AS a
 * `courseId` and every request 404'd `Course not found`.
 *
 * @returns {JourneyInsightsData}
 */
app.get(
  '/',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: journeyInsightsQuerySchema,
    },
    handler: async (ctx): Promise<JourneyInsightsData> => {
      const { pageId, period } = ctx.input.query;

      // Resolve (and org-scope) the subject course FIRST — the same two-service
      // composition the curriculum routes use. A foreign, missing or non-course
      // page throws NotFoundError here, before any aggregation runs.
      const courseId = await ctx.services.courseJourney.resolveCourseIdForPage(
        ctx.organizationId,
        pageId
      );

      return ctx.services.courseInsights.getInsights(
        ctx.organizationId,
        courseId,
        period
      );
    },
  })
);

/**
 * GET /api/journeys/insights/org-revenue?organizationId=&period=
 *
 * BATCH authoritative gross revenue for every course-type journey the org owns,
 * keyed by landing-page id — the studio index badge (Codex-9p47t). Same
 * `requireOrgManagement` guard as the per-course insights read; the handler
 * forwards `ctx.organizationId`, never the client value.
 *
 * @returns {Record<string, number>} landing-page id → gross revenue (GBP pence);
 * pages with no revenue are omitted.
 */
app.get(
  '/org-revenue',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'api', // 100 req/min
    },
    input: {
      query: orgJourneyRevenueQuerySchema,
    },
    handler: async (ctx): Promise<Record<string, number>> => {
      const { period } = ctx.input.query;
      return ctx.services.courseInsights.getOrgJourneyRevenue(
        ctx.organizationId,
        period
      );
    },
  })
);

export default app;
