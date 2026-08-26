/**
 * Journey insights — data seam (WP-7, Codex-2pryk.3.4 · Round-D · Codex-776gg).
 *
 * `getJourneyInsights` returns one course's `live` (financial) + `course`
 * (engagement) metrics for the selected period, by calling the content-api
 * studio route `GET /api/journeys/insights`. Owner/admin only — the worker
 * enforces `requireOrgManagement` and re-derives scope from the session; the
 * `organizationId` arg is a filter for org resolution, NEVER the authorization
 * source (and the service re-scopes the course to that org). Money is GBP pence.
 *
 * `track` (sales-page views / referrer / campaign) is instrumented nowhere yet
 * (SPEC §14.4) and is surfaced legend-only via `UNTRACKED_TIER` — never fetched.
 *
 * Snapshot query semantics (like `sales.remote.ts`): every period change
 * re-fires the query; no TanStack DB live collection.
 */

import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import type { JourneyInsightsData } from '$lib/components/studio/journey-insights/metric-model';
import { createServerApi } from '$lib/server/api';

const insightsQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  /**
   * The journey's LANDING-PAGE id — `page.params.id` on every
   * `/studio/journeys/[id]/…` route (Codex-xo3bl). The worker resolves it to the
   * subject course. Named `courseId` originally, which read correctly at the call
   * site and was wrong on the wire: both ids are UUIDs, so the schema passed and
   * the aggregation 404'd `Course not found` on every single request.
   */
  pageId: z.string().uuid(),
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

/**
 * Studio journey insights for one journey in one period.
 *
 * @example
 * const insights = getJourneyInsights({
 *   organizationId: data.org.id,
 *   pageId: page.params.id,
 *   period: '30d',
 * });
 * // insights.current → JourneyInsightsData
 */
export const getJourneyInsights = query(
  insightsQueryArgsSchema,
  async ({ organizationId, pageId, period }): Promise<JourneyInsightsData> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.access.courseInsights(organizationId, pageId, period);
  }
);
