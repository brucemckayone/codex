/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  INTEGRATION SEAM (Codex-2pryk.3.1 · WP-3) — conductor: rewire this file.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * This is the ONE module the public sales load imports its data from. Today it
 * delegates to the AGGRESSIVE-MODE fixtures (`journey-page.mock.ts`) so the FE is
 * built + verified against the FROZEN WP-0 contracts before the BE spine lands.
 *
 * POST-WP-2 INTEGRATION (single swap, do NOT touch +page.server.ts):
 *   1. Add `getCoursePage` (a `query()`) to `apps/web/src/lib/remote/journeys.remote.ts`,
 *      implementing the frozen `GetCoursePageQuery` signature — public read, org
 *      resolved from `locals`/subdomain, returns null when no PUBLISHED page matches.
 *      NO `canView` on this shell (HARDENING §E course-sell row).
 *   2. Add a PUBLIC preview resolver (no auth) that returns the existing 30s
 *      `preview.m3u8` manifest URLs for the intro/reel media (SPEC §10) — reuse
 *      the same public preview path `HeroInlineVideo`/`IntroVideoModal` already
 *      consume on the org landing hero.
 *   3. Re-point the two re-exports below at those real functions and delete
 *      `journey-page.mock.ts` + this note. The `+page.server.ts` shell/stream
 *      shape does not change — only the data source does.
 *
 * The `getCoursePage` export is typed against the frozen `GetCoursePageQuery`
 * alias, so the compiler guarantees the mock (and later the real query) returns
 * exactly the contracted `JourneyCoursePage` shape.
 */
import type { GetCoursePageQuery } from '$lib/page-builder';
import type { SellPreview } from '$lib/page-builder/render';
import { MOCK_COURSE_PAGE, MOCK_SELL_PREVIEW } from './journey-page.mock';

/**
 * Public sales-page read (WP-3). Returns null when no published page matches the
 * slug (→ the load throws 404). MOCK: matches the single fixture course.
 */
export const getCoursePage: GetCoursePageQuery = async ({ slug }) => {
  if (
    slug === MOCK_COURSE_PAGE.page.slug ||
    slug === MOCK_COURSE_PAGE.course.slug
  ) {
    return MOCK_COURSE_PAGE;
  }
  return null;
};

/** Params for the public sell-preview resolver. */
export interface ResolveSellPreviewInput {
  pageId: string;
  courseId: string;
}

/**
 * Resolve the public 30s sell previews for a page's intro/reel media — NO auth,
 * NO `canView` (HARDENING §E). Streamed off the critical path in the load. MOCK:
 * returns dev-CDN-style manifest URLs; real media wired at integration.
 */
export async function resolveSellPreview(
  _input: ResolveSellPreviewInput
): Promise<SellPreview | null> {
  return MOCK_SELL_PREVIEW;
}
