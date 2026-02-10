/**
 * Creator profile server load
 * Passes username from params
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  return {
    username: params.username,
    user: locals.user,
  };
};
