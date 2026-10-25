/**
 * /admin — platform support (Codex-2hxff.28). The platform owner only.
 *
 * Everyone else, signed in or not, gets a 404: no redirect to sign in, no
 * "forbidden". The guard reads the session's role and makes no API call.
 *
 * It is NOT the same 404 a missing page gets. /admin is `ssr = false`, so the
 * first request answers HTTP 200 with the app shell and never runs this load;
 * the 404 arrives with the client's `__data.json` fetch and is drawn by
 * `(platform)/+error.svelte`. The client manifest names the routes anyway.
 * So this hides the pages, nothing more: every admin-api route behind them is
 * `auth: 'platform_owner'`, and every support remote function repeats this
 * check before calling it.
 */
import { AUTH_ROLES } from '@codex/constants';
import { error } from '@sveltejs/kit';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, setHeaders }) => {
  setHeaders(CACHE_HEADERS.PRIVATE);
  if (locals.user?.role !== AUTH_ROLES.PLATFORM_OWNER) {
    error(404, 'Not Found');
  }
  return {};
};
