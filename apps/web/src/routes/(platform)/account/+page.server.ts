/**
 * Account profile page server load
 * Fetches profile data from the identity API with cache-backed SSR
 */

import { COOKIES } from '@codex/constants';
import { getCookieConfig } from '@codex/urls';
import { fail, redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { invalidateAuthSession } from '$lib/server/auth-utils';
import { ApiError } from '$lib/server/errors';
import { buildPlatformUrl } from '$lib/utils/subdomain';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  try {
    const api = createServerApi(platform, cookies);
    const response = await api.account.getProfile();
    return { profile: response };
  } catch {
    return { profile: null };
  }
};

export const actions: Actions = {
  /**
   * Self-service account deletion. Requires the user to type "DELETE"
   * (validated here AND by identity-api). On success, tears down the web
   * session exactly like logout and redirects to login. On the owns-org
   * block (422) it surfaces the message and stays on the page.
   */
  deleteAccount: async ({ cookies, request, platform, url, locals }) => {
    if (!locals.user) {
      redirect(303, '/login?redirect=/account');
    }

    const formData = await request.formData();
    if (formData.get('confirm') !== 'DELETE') {
      return fail(400, { message: 'Type DELETE to confirm account deletion.' });
    }

    try {
      await createServerApi(platform, cookies).account.deleteAccount();
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.status, { message: err.message });
      }
      return fail(500, {
        message: 'Failed to delete your account. Please try again.',
      });
    }

    // Account soft-deleted — invalidate + clear the session like logout.
    const sessionCookie = cookies.get(COOKIES.SESSION_NAME);
    if (sessionCookie) {
      await invalidateAuthSession(platform, sessionCookie);
    }
    const host = request.headers.get('host') ?? undefined;
    const cookieConfig = getCookieConfig(platform?.env, host);
    cookies.delete(COOKIES.SESSION_NAME, {
      path: cookieConfig.path,
      domain: cookieConfig.domain,
    });

    redirect(303, buildPlatformUrl(url, '/login?deleted=1'));
  },
};
