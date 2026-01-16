import { COOKIES, getCookieConfig, getServiceUrl } from '@codex/constants';
import { logger } from '$lib/observability';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, platform, cookies }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return {
      success: false,
      error: 'Missing verification token.',
    };
  }

  try {
    const authUrl = getServiceUrl('auth', platform?.env);

    // Attempt verification via API
    // Assuming POST for mutation, or GET if BetterAuth follows generic link pattern
    // Let's try POST with JSON body for API consistency
    const res = await fetch(`${authUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      // If 404/400, token invalid
      return {
        success: false,
        error: 'Invalid or expired verification link.',
      };
    }

    // Capture session if returned
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const sessionMatch = setCookie.match(
        new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
      );
      if (sessionMatch) {
        const cookieConfig = getCookieConfig(platform?.env, {
          maxAge: COOKIES.SESSION_MAX_AGE,
        });
        cookies.set(COOKIES.SESSION_NAME, sessionMatch[1], cookieConfig);
      }
    }

    return {
      success: true,
    };
  } catch (err) {
    logger.error('Verify email error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: 'An unexpected error occurred.',
    };
  }
};
