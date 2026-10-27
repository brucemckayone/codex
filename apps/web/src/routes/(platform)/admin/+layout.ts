/**
 * /admin is client-rendered, as the studio is: behind the platform-owner
 * guard, of no use to search engines, and navigation between its pages
 * should be instant. The guard in +layout.server.ts still runs before any
 * page mounts, through the client's data request; the first HTML response is
 * the shell, HTTP 200, whoever asks.
 */

export const ssr = false;
