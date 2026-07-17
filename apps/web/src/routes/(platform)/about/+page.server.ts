/**
 * About page - server load
 * Sets public cache headers for edge caching.
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  // Rendered under the (platform) layout, which injects the auth-aware user
  // section — so even this near-static page varies by auth. Shared caches key
  // by URL, NOT by Cookie, so a `public` copy would show signed-in users the
  // logged-out header. PRIVATE keeps it out of shared caches.
  setHeaders(CACHE_HEADERS.PRIVATE);
};
