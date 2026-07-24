/**
 * In-course practice player — server gate + data (Codex-2pryk · WP-4).
 *
 * `ssr = false` (HARDENING §E): authed SPA. The server `load` runs and enforces
 * BOTH gates before any client render (SPEC §8.6 / §6.3):
 *   - `canEnterCourse` → the in-course chrome (playlist, progress, mark-complete).
 *   - `canView`        → the signed practice STREAM (media only; written bodies
 *                        are gated by course entry).
 * A member who can enter the course but somehow can't view a specific stream
 * still gets the chrome; the stream URL is withheld.
 *
 * ─── ROUND-D SEAM ───────────────────────────────────────────────────────────
 * The resolver + practice fetch are mocked in
 * `$lib/server/journeys/round-d-seam.ts`; Round-D swaps them for real
 * `@codex/access` calls (incl. R2-signed stream URLs). This file is unchanged.
 */
import { error, redirect } from '@sveltejs/kit';
import { evaluateCourseGate } from '$lib/journeys/gate';
import {
  fetchInCoursePractice,
  resolveCanEnterCourse,
  resolveCanView,
  resolveCourseBySlug,
} from '$lib/server/journeys/round-d-seam';
import { buildJourneyUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';

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

  const practice = await fetchInCoursePractice(
    event,
    user!.id,
    course!.id,
    params.contentSlug
  );
  if (!practice) error(404, 'Practice not found');

  // `canView` gates the media stream. Written practices are gated by course
  // entry alone. Withhold the stream URL if the view check fails.
  const streamViewable =
    practice.practice.contentType === 'written'
      ? true
      : await resolveCanView(event, user!.id, practice.practice.contentId);

  return {
    practice: {
      ...practice,
      streamingUrl: streamViewable ? practice.streamingUrl : null,
    },
  };
};
