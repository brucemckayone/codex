import { COOKIES, getCookieConfig } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import { invalidateAuthSession } from '$lib/server/auth-utils';
import { buildPlatformUrl } from '$lib/utils/subdomain';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ cookies, request, platform, url }) => {
    const sessionCookie = cookies.get(COOKIES.SESSION_NAME);

    // Invalidate session server-side (DB row + KV cache)
    if (sessionCookie) {
      await invalidateAuthSession(platform, sessionCookie);
    }

    // Delete cookie from SvelteKit response
    const host = request.headers.get('host') ?? undefined;
    const cookieConfig = getCookieConfig(platform?.env, host);
    cookies.delete(COOKIES.SESSION_NAME, {
      path: cookieConfig.path,
      domain: cookieConfig.domain,
    });

    // Redirect to platform login (handles org subdomain → platform domain)
    redirect(303, buildPlatformUrl(url, '/login?logout=1'));
  },
};
