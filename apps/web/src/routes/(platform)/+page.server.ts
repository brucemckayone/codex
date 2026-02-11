/**
 * Platform landing page - server load
 * Sets public cache headers for edge caching
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders(CACHE_HEADERS.STATIC_PUBLIC);
};
