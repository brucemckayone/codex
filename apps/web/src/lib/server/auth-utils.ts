import { AUTH_COOKIES, COOKIES } from '@codex/constants';
import { logger } from '$lib/observability';
import { serverApiUrl } from './api';

/**
 * Extract session token from Set-Cookie header on an auth worker response.
 *
 * BetterAuth sets `better-auth.session_token` internally regardless of
 * cookie name config. We also check for the platform cookie name and
 * their __Secure- prefixed variants.
 */
export function extractSessionToken(res: Response): string | null {
  // Use getSetCookie() if available, otherwise fallback to get
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);

  if (!setCookies || setCookies.length === 0) return null;

  // Join them for the regex to work over all of them, or test individually
  const cookieString = setCookies.join('; ');

  // Try platform cookie name first, then BetterAuth's internal name
  const patterns = [
    new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`),
    new RegExp(`__Secure-${COOKIES.SESSION_NAME}=([^;]+)`),
    /better-auth\.session_token=([^;]+)/,
    /__Secure-better-auth\.session_token=([^;]+)/,
  ];

  for (const pattern of patterns) {
    const match = cookieString.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Invalidate a session server-side by calling BetterAuth's sign-out endpoint.
 * Deletes the session from PostgreSQL and KV cache.
 * Fails silently if the auth worker is unreachable.
 */
export async function invalidateAuthSession(
  platform: App.Platform | undefined,
  sessionCookie: string
): Promise<void> {
  try {
    const authUrl = serverApiUrl(platform, 'auth');
    await fetch(`${authUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}; ${AUTH_COOKIES.BETTER_AUTH}=${sessionCookie}`,
      },
      body: '{}',
    });
  } catch (err) {
    logger.warn('Failed to invalidate auth session server-side', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

/**
 * Fallback: extract session token from a JSON response body.
 * Used when the auth worker returns a token in the body instead
 * of a Set-Cookie header (e.g. verify-email with auto-sign-in).
 */
export function extractSessionTokenFromBody(
  body: Record<string, unknown>
): string | null {
  if (typeof body.token === 'string') return body.token;

  const session = body.session;
  if (session && typeof session === 'object' && session !== null) {
    const token = (session as Record<string, unknown>).token;
    if (typeof token === 'string') return token;
  }

  return null;
}
