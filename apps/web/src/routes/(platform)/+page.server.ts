/**
 * Platform landing page - server load.
 *
 * Uses PRIVATE because this page renders the auth-aware
 * SidebarRailUserSection from the (platform) layout. Any shared cache
 * (Cloudflare edge, miniflare in wrangler dev, intermediate proxies)
 * keys cache entries by URL — NOT by Cookie — so a `public, s-maxage=N`
 * response cached during an anonymous visit gets served to subsequent
 * authenticated visitors, producing a stale unauth render with the
 * Sign In link instead of the user's avatar trigger.
 *
 * The previous `DYNAMIC_PUBLIC_REVALIDATE` preset (`public, max-age=0,
 * s-maxage=300`) fixed the BROWSER-cache half of this bug (max-age=0
 * forces browser revalidation) but left the SHARED-cache half open.
 * CI surfaces it deterministically because miniflare's CF cache
 * emulation honours `s-maxage` for HTML by URL key alone.
 *
 * Trade-off: anonymous landing visits no longer benefit from a 5-minute
 * shared-cache window. That window was minor for `/` (a single SSR pass
 * is fast) and the correctness win is critical — without this, every
 * authenticated returning visitor can see stale unauth markup.
 */
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders(CACHE_HEADERS.PRIVATE);
};
