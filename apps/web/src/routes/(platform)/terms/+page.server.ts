/**
 * Terms of Service - server load.
 *
 * PLACEHOLDER PAGE (Codex-6wkr1). It exists so the global Footer's `/terms`
 * link stops 404ing; the real wording is not published yet and the page says
 * so. Replace the whole route when it lands.
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  // PRIVATE, matching `(platform)/about`: this page renders under the
  // (platform) layout, which injects the auth-aware user section. Shared caches
  // key by URL and NOT by Cookie, so a `public` copy cached during an anonymous
  // visit would serve signed-in visitors the logged-out header. Near-static
  // body, still viewer-varying chrome.
  setHeaders(CACHE_HEADERS.PRIVATE);
};
