import { COOKIES } from '@codex/constants';

/**
 * Extract session token from Set-Cookie header on an auth worker response.
 *
 * BetterAuth sets `better-auth.session_token` internally regardless of
 * cookie name config. We also check for the platform cookie name and
 * their __Secure- prefixed variants.
 */
export function extractSessionToken(res: Response): string | null {
  const setCookieHeader = res.headers.get('set-cookie');
  if (!setCookieHeader) return null;

  // Try platform cookie name first, then BetterAuth's internal name
  const patterns = [
    new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`),
    new RegExp(`__Secure-${COOKIES.SESSION_NAME}=([^;]+)`),
    /better-auth\.session_token=([^;]+)/,
    /__Secure-better-auth\.session_token=([^;]+)/,
  ];

  for (const pattern of patterns) {
    const match = setCookieHeader.match(pattern);
    if (match) return match[1];
  }

  return null;
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
