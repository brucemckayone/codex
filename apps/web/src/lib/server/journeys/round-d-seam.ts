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
 *   resolveCanEnterCourse → api.access.canEnterCourse(courseId)              [WP-2]
 *   resolveCanView        → api.access.canView(contentId)                   [WP-2]
 *   fetchCourseDashboard  → api.access.courseDashboard(courseId)
 *   fetchInCoursePractice → api.access.inCoursePractice(courseId, contentSlug)
 *                           (+ server-side sanitise of written bodyHtml)
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

import type { RequestEvent } from '@sveltejs/kit';
import { sanitizeContentHtml } from '$lib/editor/render';
import type {
  CompletionSource,
  CourseDashboardData,
  InCoursePracticeData,
  JourneyCourseSummary,
  PracticeCompletionRecord,
} from '$lib/journeys/types';
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

/** `api.access.canEnterCourse` (WP-2 resolver; worker derives the user). */
export async function resolveCanEnterCourse(
  ctx: SeamContext,
  _userId: string | null,
  courseId: string
): Promise<boolean> {
  return apiFor(ctx).access.canEnterCourse(courseId);
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
 * SECURITY: a written practice's `bodyHtml` is stored content rendered by the
 * worker and arrives here UNSANITISED — a stored-XSS vector, since the player
 * emits it via `{@html}`. We sanitise it HERE, the earliest server-only point
 * (before the value leaves the server), with the SAME isomorphic-dompurify pass
 * the standalone content page applies in `renderContentBody` — so the player's
 * `{@html}` receives the identical safe treatment as the standalone page.
 */
export async function fetchInCoursePractice(
  ctx: SeamContext,
  _userId: string,
  courseId: string,
  contentSlug: string
): Promise<InCoursePracticeData | null> {
  const data = await apiFor(ctx).access.inCoursePractice(courseId, contentSlug);
  if (!data) return null;

  return {
    ...data,
    bodyHtml: data.bodyHtml ? await sanitizeContentHtml(data.bodyHtml) : null,
  };
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
