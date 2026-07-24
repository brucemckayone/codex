import type { JourneyInsightsData } from '@codex/access';
import type { HonoEnv } from '@codex/shared-types';
import { journeyInsightsQuerySchema } from '@codex/validation';
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
 * redirect the query to another org. Defence in depth: the service additionally
 * scopes the course to the managed org (a foreign courseId → 404, never a leak).
 */
const app = new Hono<HonoEnv>();

/**
 * GET /api/journeys/insights?organizationId=&courseId=&period=
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
      const { courseId, period } = ctx.input.query;
      return ctx.services.courseInsights.getInsights(
        ctx.organizationId,
        courseId,
        period
      );
    },
  })
);

export default app;
