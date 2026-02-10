import { COOKIES, getCookieConfig, getServiceUrl } from '@codex/constants';
import { logger } from '$lib/observability';
import {
  extractSessionToken,
  extractSessionTokenFromBody,
} from '$lib/server/auth-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, platform, cookies }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    // Post-registration landing — user needs to check their inbox
    return {
      status: 'pending' as const,
    };
  }

  try {
    const authUrl = getServiceUrl('auth', platform?.env);

    // BetterAuth exposes verify-email as a GET endpoint with token as query param.
    // Use redirect: 'manual' to capture Set-Cookie headers from the response
    // before BetterAuth redirects — fetch follows redirects by default and
    // drops intermediate Set-Cookie headers.
    const verifyUrl = new URL(`${authUrl}/api/auth/verify-email`);
    verifyUrl.searchParams.set('token', token);
    const res = await fetch(verifyUrl.toString(), { redirect: 'manual' });

    // BetterAuth returns 302 on success (redirect) or 200 with session
    if (!res.ok && !res.redirected && res.status !== 302) {
      return {
        status: 'error' as const,
        error: 'Invalid or expired verification link.',
      };
    }

    // Capture session if returned (autoSignInAfterVerification)
    // Try Set-Cookie headers first, then fall back to response body
    let sessionToken = extractSessionToken(res);
    if (!sessionToken) {
      const body = await res.json().catch(() => ({}));
      sessionToken = extractSessionTokenFromBody(
        body as Record<string, unknown>
      );
    }
    if (sessionToken) {
      const cookieConfig = getCookieConfig(platform?.env, url.host, {
        maxAge: COOKIES.SESSION_MAX_AGE,
      });
      cookies.set(COOKIES.SESSION_NAME, sessionToken, cookieConfig);
    }

    return {
      status: 'success' as const,
    };
  } catch (err) {
    logger.error('Verify email error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 'error' as const,
      error: 'An unexpected error occurred.',
    };
  }
};
