/**
 * /admin is client-rendered, as the studio is: behind the platform-owner
 * guard, of no use to search engines, and navigation between its pages
 * should be instant. The guard in +layout.server.ts still runs first.
 */

export const ssr = false;
