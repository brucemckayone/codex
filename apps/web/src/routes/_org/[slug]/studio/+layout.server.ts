/**
 * Studio layout - server load
 * Private route: disable edge caching for authenticated content
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ setHeaders }) => {
  setHeaders(CACHE_HEADERS.PRIVATE);
};
