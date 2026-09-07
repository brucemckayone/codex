/**
 * Privacy Policy - server load.
 *
 * PLACEHOLDER PAGE (Codex-6wkr1). It exists so the global Footer's `/privacy`
 * link stops 404ing; the real wording is not published yet and the page says
 * so. Replace the whole route when it lands.
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  // PRIVATE for the same reason as `(platform)/about` and `/terms` — the
  // (platform) layout's auth-aware user section makes the response
  // viewer-varying, and shared caches key by URL, never by Cookie.
  setHeaders(CACHE_HEADERS.PRIVATE);
};
