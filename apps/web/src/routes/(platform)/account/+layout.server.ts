/**
 * Account layout - server load
 * Auth guard: redirects unauthenticated users to login.
 */
import { redirect } from '@sveltejs/kit';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, setHeaders }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  setHeaders(CACHE_HEADERS.PRIVATE);
};
