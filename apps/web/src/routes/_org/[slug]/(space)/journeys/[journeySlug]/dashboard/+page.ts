/**
 * Journey member dashboard — SPA shell (Codex-2pryk.3.1 · WP-3).
 *
 * `ssr = false` makes this authed member portal client-rendered for instant
 * navigation (HARDENING §E course-dashboard row; mirrors the studio SPA idiom
 * in `_org/[slug]/studio/+layout.ts`). The parent org layout still SSRs (auth,
 * branding, org resolution) and `initProgressSync` on that layout already
 * covers this subtree.
 *
 * OUT OF WP-3 SCOPE (owned by WP-4): a `+page.server.ts` running the
 * `canEnterCourse` gate + redirect-to-sell, the enrollment/progress rollup, the
 * playlist rail / working pane / map-with-progress overlay, and the
 * `progressCollection` wiring. This shell establishes the route + SPA mode so
 * the post-purchase funnel is navigable.
 */
export const ssr = false;
