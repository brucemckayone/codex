/**
 * Studio layout - client types
 *
 * ssr = false makes the entire studio sub-tree client-rendered.
 * The parent org layout still SSRs (auth, branding, org resolution).
 * Server loads (+layout.server.ts, +page.server.ts) still execute —
 * SvelteKit calls them via fetch during client-side navigation.
 */
import type { LayoutServerLoad } from './$types';

export const ssr = false;

export interface LayoutData extends LayoutServerLoad {}
