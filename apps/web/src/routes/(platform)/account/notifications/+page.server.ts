import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  // Prevent caching of sensitive user data
  setHeaders({
    'Cache-Control': 'private, no-cache',
  });

  if (!locals.user) {
    redirect(303, '/login?redirect=/account/notifications');
  }

  // Fetch current notification preferences from the API
  // The remote function getNotificationPreferences has defaults built in
  try {
    const api = createServerApi(platform, cookies);
    const preferences = await api.account.getNotificationPreferences();

    return {
      preferences: {
        emailMarketing: preferences.emailMarketing ?? false,
        emailTransactional: preferences.emailTransactional ?? true,
        emailDigest: preferences.emailDigest ?? false,
      },
    };
  } catch {
    // Return defaults if API call fails
    return {
      preferences: {
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      },
    };
  }
};
