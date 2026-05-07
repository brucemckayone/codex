/**
 * Platform landing page - server load.
 *
 * Uses DYNAMIC_PUBLIC_REVALIDATE because this page renders the auth-aware
 * SidebarRailUserSection from the (platform) layout. STATIC_PUBLIC's
 * 1-hour browser cache caused logged-in users to see cached unauthed
 * markup — DYNAMIC_PUBLIC_REVALIDATE keeps the CDN win (s-maxage=300)
 * for anonymous visitors but forces the browser to revalidate so the
 * next navigation reflects the current session.
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE);
};
