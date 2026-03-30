import { COOKIES, getCookieConfig } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ cookies, request, platform }) => {
    const host = request.headers.get('host') ?? undefined;
    const cookieConfig = getCookieConfig(platform?.env, host);
    cookies.delete(COOKIES.SESSION_NAME, {
      path: cookieConfig.path,
      domain: cookieConfig.domain,
    });
    redirect(303, '/login');
  },
};
