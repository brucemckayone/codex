/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  INTEGRATION SEAM (Codex-2pryk.3.1 · WP-3) — WIRED to real data (Round-D).  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The ONE module the public sales load (`./+page.server.ts` + `./checkout`)
 * imports its data from. It now re-exports the REAL remote functions from
 * `$lib/remote/journeys.remote` (the AGGRESSIVE-MODE `journey-page.mock` fixture
 * has been deleted). The `+page.server.ts` shell/stream shape is unchanged — only
 * the data source moved from mock to the live content-api reads:
 *
 *   - `getCoursePage`     → `query()` implementing the frozen `GetCoursePageQuery`:
 *      resolves the org from the request host, then reads the published landing
 *      page + course by (orgId, slug). NO `canView` (HARDENING §E course-sell row).
 *   - `resolveSellPreview` → `query()` returning the public 30s `preview.m3u8`
 *      clips for the intro/reel media (SPEC §10), reusing the SAME public preview
 *      path (`hlsPreviewKey` → CDN URL, no signing) the org-landing hero uses.
 *
 *   - `getCoursePagePreview` → `query()` for the STUDIO live-preview iframe only
 *      (Codex-isr02 P0b-2): the SAME envelope for ANY status (drafts included),
 *      management-gated by the worker. The public load falls back to it (only for
 *      a signed-in user) when `getCoursePage` returns null, so a manager can
 *      preview an unpublished draft; a non-manager / anon still 404s (fail-closed).
 *
 * Kept as a thin re-export (rather than importing the remote directly in the
 * loads) so the seam's single-module contract — and the tests that mock it —
 * stay stable.
 */
export {
  getCoursePage,
  getCoursePagePreview,
  resolveSellPreview,
} from '$lib/remote/journeys.remote';
