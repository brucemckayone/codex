/**
 * Creator studio layout - client types
 *
 * ssr = false makes the entire creator studio sub-tree client-rendered.
 * The parent creators layout still SSRs (auth, profile resolution).
 * Server loads (+layout.server.ts, +page.server.ts) still execute —
 * SvelteKit calls them via fetch during client-side navigation.
 */

export const ssr = false;
