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
 * The resolver + practice fetch go through `$lib/server/journeys/round-d-seam.ts`,
 * which calls the real `@codex/access` routes (incl. R2-signed stream URLs).
 *
 * Alongside the practice we fetch the course dashboard (same enrollment-gated
 * rollup the dashboard page reads) ONLY to surface the current stage's reflective
 * `gloss` in the working pane. It runs in parallel and `.catch()`es to null, so a
 * failure degrades the "why" line — it never weakens a gate or rejects the load.
 */
import { error, redirect } from '@sveltejs/kit';
import { evaluateCourseGate } from '$lib/journeys/gate';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  fetchCourseDashboard,
  fetchInCoursePractice,
  resolveCanView,
  resolveCourseBySlug,
  resolveCourseEntry,
} from '$lib/server/journeys/round-d-seam';
import { logReadFailure } from '$lib/server/read-failure';
import { buildContentUrl, buildJourneyUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';

export const ssr = false;

export const load: PageServerLoad = async (event) => {
  const { params, parent, url } = event;
  event.depends('app:auth');

  const { org, user } = await parent();
  const course = await resolveCourseBySlug(event, params.journeySlug);

  const entry =
    user && course ? await resolveCourseEntry(event, user.id, course.id) : null;

  const outcome = evaluateCourseGate({
    courseExists: course !== null,
    isAuthenticated: Boolean(user),
    canEnterCourse: entry?.canEnter ?? false,
  });

  if (outcome.kind === 'not-found') error(404, 'Course not found');
  if (outcome.kind === 'redirect-to-sales') {
    // A course paused by a payment dispute is refused here too. Its lessons
    // keep the dispute notice (owner decision 2026-10-24, Codex-2hxff.60), so
    // the refusal's own `disputeHold` sends the reader to this lesson's content
    // page, which shows it with no Buy or Subscribe.
    if (entry?.disputeHold && org) {
      redirect(
        303,
        buildContentUrl(url, {
          slug: params.contentSlug,
          id: params.contentSlug,
          organizationSlug: org.slug ?? null,
        })
      );
    }
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

  // Past the gate, both are present — the outcome is derived from their
  // existence. Narrow here so the rest of the load needs no non-null assertion.
  if (!user || !course) error(404, 'Course not found');

  // Practice payload (gated) + the enrollment rollup (for the stage gloss) in
  // parallel; the dashboard degrades to null without affecting the practice gate.
  const [practice, dashboard] = await Promise.all([
    fetchInCoursePractice(event, user.id, course.id, params.contentSlug),
    // Survivable (only the stage gloss is lost), so logged, not thrown.
    fetchCourseDashboard(event, user.id, course.id).catch((err: unknown) => {
      logReadFailure(
        'Course dashboard not loaded',
        { courseId: course.id },
        err
      );
      return null;
    }),
  ]);
  if (!practice) error(404, 'Practice not found');

  // `canView` gates the media stream. Written practices are gated by course
  // entry alone. Withhold the stream URL if the view check fails.
  const streamViewable =
    practice.practice.contentType === 'written'
      ? true
      : await resolveCanView(event, user.id, practice.practice.contentId);

  // The current stage's reflective line (SPEC §5 `gloss`), if the rollup carries
  // it — surfaced as the working pane's "why". Absent → the line just doesn't render.
  const stageGloss =
    dashboard?.stages.find((s) => s.id === practice.stage.id)?.gloss ?? null;

  // A course lesson is a paid page: its text, or a signed stream URL whose
  // token outlives a refund, is stored nowhere (owner decision, 2026-10-25:
  // "Yes, don't store paid pages"; Codex-hyz1c). SvelteKit already sends this
  // ssr=false page's __data.json `private, no-store`; said here so it never
  // rests on a default. A parent layout must not set Cache-Control: SvelteKit
  // throws on a header set twice, which would fail every lesson.
  event.setHeaders(CACHE_HEADERS.FRESH);

  return {
    practice: {
      ...practice,
      streamingUrl: streamViewable ? practice.streamingUrl : null,
    },
    stageGloss,
  };
};
