/**
 * Round-D integration seam (Codex-2pryk · WP-4) — the member-surface web→worker
 * boundary for the course dashboard + in-course player.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * WP-4 (dashboard + in-course player) is stacked on WP-2's resolver. Every
 * web→worker call the SSR gate and the mark-complete command need is ISOLATED
 * here so the FE, the progress store, the gate structure, and the mark-complete
 * flow stay decoupled from the transport. The functions below now call the real
 * `createServerApi(...).access.*` routes (added in Round-D Phase 1); the return
 * SHAPES are frozen against `$lib/journeys/types`, so callers never change.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  MAPPING (seam fn → real call)
 * ═══════════════════════════════════════════════════════════════════════════
 *   resolveCourseBySlug   → resolve org from host → api.access.courseBySlug(orgId, slug)
 *   resolveCourseEntry    → api.access.courseEntry(courseId)                 [WP-2]
 *   resolveCanEnterCourse → resolveCourseEntry(…).canEnter
 *   resolveCanView        → api.access.canView(contentId)                   [WP-2]
 *   fetchCourseDashboard  → api.access.courseDashboard(courseId)
 *   fetchInCoursePractice → api.access.inCoursePractice(courseId, contentSlug)
 *                           (+ server-side render + sanitise of the stored
 *                           written body)
 *   persistPracticeCompletion → api.access.persistCompletion(input)
 *
 * The worker derives the user from the FORWARDED SESSION COOKIE, so the
 * entitlement/read/write calls take no `userId` argument — the `userId` params
 * kept on these seam signatures are vestigial (retained only so the frozen
 * callers don't change). Entitlement reads are per-request / never cross-user
 * cached (HARDENING §E) — the request()-per-call client guarantees that.
 *
 * server-only ($lib/server/*): never bundled to the client.
 */

import type { CourseEntryResponse } from '@codex/access';
import type { RequestEvent } from '@sveltejs/kit';
import type {
  CompletionSource,
  CourseDashboardData,
  InCoursePracticeData,
  JourneyCourseSummary,
  PracticeCompletionRecord,
} from '$lib/journeys/types';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { getSubdomainContext } from '$lib/utils/subdomain';

/**
 * The request context each seam call needs. Structurally satisfied by both a
 * SvelteKit server-load event and a remote-function `getRequestEvent()`.
 * `platform` + `cookies` build the session-forwarding server API client; `url`
 * resolves the org host for the (org-scoped) course-by-slug lookup; `locals` is
 * carried for callers' convenience (unused by the calls themselves — the worker
 * derives the user from the session cookie).
 */
export type SeamContext = Pick<
  RequestEvent,
  'platform' | 'cookies' | 'locals' | 'url'
>;

/** Session-forwarding server API client, built from a seam context. */
function apiFor(ctx: SeamContext): ReturnType<typeof createServerApi> {
  return createServerApi(ctx.platform, ctx.cookies);
}

/**
 * content-api course lookup by (orgId, slug). Course slugs are ORG-SCOPED, so we
 * resolve the org from the request host — the same subdomain→slug the router
 * uses (`getSubdomainContext`) — then its id (`getPublicInfo`, public + KV-cached),
 * then look the course up. Returns null off an org host or when no course matches.
 */
export async function resolveCourseBySlug(
  ctx: SeamContext,
  slug: string
): Promise<JourneyCourseSummary | null> {
  const context = getSubdomainContext(ctx.url.hostname);
  if (context.type !== 'organization') return null;

  const api = apiFor(ctx);
  const org = await api.org.getPublicInfo(context.slug);
  if (!org || typeof org !== 'object' || !('id' in org)) return null;

  return api.access.courseBySlug(org.id, slug);
}

/**
 * `api.access.courseEntry` (WP-2 resolver; worker derives the user): whether
 * the user may enter, and on a refusal the open payment dispute that explains
 * it (Codex-2hxff.60). For the surfaces that must not sell the course again
 * to a disputed owner: the sales page and the in-course player.
 */
export async function resolveCourseEntry(
  ctx: SeamContext,
  _userId: string | null,
  courseId: string
): Promise<CourseEntryResponse> {
  return apiFor(ctx).access.courseEntry(courseId);
}

/** The boolean half of {@link resolveCourseEntry}, for gates that need only that. */
export async function resolveCanEnterCourse(
  ctx: SeamContext,
  userId: string | null,
  courseId: string
): Promise<boolean> {
  return (await resolveCourseEntry(ctx, userId, courseId)).canEnter;
}

/** `api.access.canView` (gates the signed stream; works unauthenticated). */
export async function resolveCanView(
  ctx: SeamContext,
  _userId: string | null,
  contentId: string
): Promise<boolean> {
  return apiFor(ctx).access.canView(contentId);
}

/**
 * Enrollment + progress rollup (`practice_completions ⋈ stage_practices` scoped
 * to the enrollment — SPEC §11). Null when the user isn't enrolled / no course.
 */
export async function fetchCourseDashboard(
  ctx: SeamContext,
  _userId: string,
  courseId: string
): Promise<CourseDashboardData | null> {
  return apiFor(ctx).access.courseDashboard(courseId);
}

/**
 * In-course player payload (practice + SIGNED stream URL + playlist).
 *
 * A written practice's body arrives AS STORED (TipTap JSON or legacy
 * markdown) and is rendered HERE with the standalone content page's
 * `renderContentBody`: the same TipTap/markdown render and the same
 * isomorphic-dompurify pass, so the player's `{@html}` gets exactly the page's
 * safe HTML, and an editor-written practice is no longer empty (Codex-woj7k).
 * Server-only, so the stored body never reaches the browser.
 *
 * Two failures are said out loud rather than shown as "no written guidance":
 * - a content-api older than this web (a rollback) sends only the markdown
 *   column, as `bodyHtml`: rendered as markdown, and logged as deploy skew
 *   (an empty column is `bodyUnavailable`: the text may be editor JSON);
 * - stored text that rendered to nothing (renderContentBody failed and logged
 *   why): `bodyUnavailable`, so the pane says it did not load.
 */
export async function fetchInCoursePractice(
  ctx: SeamContext,
  _userId: string,
  courseId: string,
  contentSlug: string
): Promise<InCoursePracticeData | null> {
  const data = await apiFor(ctx).access.inCoursePractice(courseId, contentSlug);
  if (!data) return null;

  const { body, bodyHtml: legacyBodyHtml, ...rest } = data;
  const contentId = data.practice.contentId;

  let stored = body ?? null;
  let bodyUnavailable = false;
  if (body === undefined && data.practice.contentType === 'written') {
    logger.error('In-course practice arrived without its stored body', {
      courseId,
      contentId,
    });
    if (legacyBodyHtml) {
      stored = { contentBody: legacyBodyHtml, contentBodyJson: null };
    } else {
      // The older worker sent only the markdown column, and it is empty: the
      // text may well be editor JSON this web cannot see. "Didn't load" is the
      // honest copy, never "no written guidance".
      bodyUnavailable = true;
    }
  }

  // Imported LAZILY so this seam's module-eval doesn't eagerly pull the heavy
  // editor render chain ($lib/editor/render → ./extensions), which is
  // CJS-interop-hostile to vitest's SSR eval and — via progress.ts →
  // journeys.remote → round-d-seam — was breaking the collections/access-context
  // unit suites. The real build is unaffected (SvelteKit strips the remote body
  // from the client bundle). [[feedback_vite_ssr_module_load_cascade]]
  let bodyHtml: string | null = null;
  if (stored) {
    const { hasStoredText, renderContentBody } = await import(
      '$lib/editor/render'
    );
    bodyHtml = await renderContentBody(stored, {
      contentId,
      surface: 'course-player',
    });
    bodyUnavailable = hasStoredText(stored) && bodyHtml == null;
  }
  return { ...rest, bodyHtml, bodyUnavailable };
}

/**
 * INSERT a `practice_completions` row (once per user — the unique index makes a
 * repeat a no-op). Returns the completion so the optimistic store write settles.
 */
export async function persistPracticeCompletion(
  ctx: SeamContext,
  _userId: string,
  input: { contentId: string; source: CompletionSource }
): Promise<PracticeCompletionRecord> {
  return apiFor(ctx).access.persistCompletion(input);
}
