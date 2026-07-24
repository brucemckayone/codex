/**
 * Journey dashboard — server gate + data (Codex-2pryk · WP-4).
 *
 * `ssr = false` (HARDENING §E): the dashboard is an authed SPA subtree (instant
 * nav, not SEO-significant). The server `load` STILL runs — SvelteKit fetches
 * it — so the `canEnterCourse` gate and its redirect are enforced server-side
 * before any client render. `initProgressSync` is already initialised by the
 * org layout, so this subtree inherits cross-device progress sync.
 *
 * Gate ordering (secure): resolve slug→course, THEN `canEnterCourse`, THEN load
 * the enrollment + rollup — so a non-entitled user never receives progress data.
 *
 * ─── ROUND-D SEAM ───────────────────────────────────────────────────────────
 * `resolveCourseBySlug` / `resolveCanEnterCourse` / `fetchCourseDashboard` are
 * mocked in `$lib/server/journeys/round-d-seam.ts` (contract-shaped). Round-D
 * swaps those bodies for real `@codex/access` calls; this file does not change.
 */
import { error, redirect } from '@sveltejs/kit';
import { evaluateCourseGate } from '$lib/journeys/gate';
import {
  fetchCourseDashboard,
  resolveCanEnterCourse,
  resolveCourseBySlug,
} from '$lib/server/journeys/round-d-seam';
import { buildJourneyUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';

// SPA subtree — client-rendered, but the load (and its gate) run server-side.
export const ssr = false;

export const load: PageServerLoad = async (event) => {
  const { params, parent, url } = event;
  event.depends('app:auth');

  const { org, user } = await parent();
  const course = await resolveCourseBySlug(event, params.journeySlug);

  const canEnter =
    user && course
      ? await resolveCanEnterCourse(event, user.id, course.id)
      : false;

  const outcome = evaluateCourseGate({
    courseExists: course !== null,
    isAuthenticated: Boolean(user),
    canEnterCourse: canEnter,
  });

  if (outcome.kind === 'not-found') error(404, 'Course not found');
  if (outcome.kind === 'redirect-to-sales') {
    redirect(
      303,
      buildJourneyUrl(
        url,
        {
          slug: params.journeySlug,
          id: course?.id ?? params.journeySlug,
          organizationSlug: org?.slug ?? null,
        },
        { surface: 'sales' }
      )
    );
  }

  // Gate passed → user + course are non-null.
  const dashboard = await fetchCourseDashboard(event, user!.id, course!.id);
  if (!dashboard) error(404, 'Course not found');

  return { dashboard };
};
