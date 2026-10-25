/**
 * /admin — platform support (Codex-2hxff.28). The platform owner only.
 *
 * Everyone else, signed in or not, gets the same 404 a missing page gets: no
 * redirect to sign in, no "forbidden", so the area's existence isn't
 * revealed. The guard reads the session's role and makes no API call. It
 * hides the pages only: every admin-api route behind them is
 * `auth: 'platform_owner'` and refuses on its own.
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
