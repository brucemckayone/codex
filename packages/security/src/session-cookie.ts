/**
 * Session cookie extraction.
 *
 * A leaf module on purpose. `session-auth.ts` imports `@codex/database` at
 * module scope, so anything that reads a session cookie from there would drag
 * drizzle and the Neon client in with it — including the rate limiter, which
 * needs the cookie only as a bucket key. Keeping this dependency-free is what
 * lets both callers share one implementation instead of duplicating it.
 */

import { AUTH_COOKIES } from '@codex/constants';

/**
 * Extract the session token from a raw Cookie header.
 *
 * SECURITY: string scanning only — no eval, and the cookie name is regex-escaped
 * before use.
 *
 * BetterAuth stores the cookie as `{token}.{signature}` but persists only the
 * token, so the token half is what both a DB lookup and a rate-limit bucket key
 * must use. Four names are accepted (the configured name and BetterAuth's own,
 * each with and without the `__Secure-` prefix) because the prefix is present
 * only on HTTPS origins.
 *
 * @param cookieHeader - Raw Cookie header value
 * @param cookieName - Name of the session cookie
 * @returns Session token, or null when no accepted cookie is present
 */
export function extractSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) return null;

  const cookieNames = [
    cookieName,
    `__Secure-${cookieName}`,
    AUTH_COOKIES.BETTER_AUTH,
    `__Secure-${AUTH_COOKIES.BETTER_AUTH}`,
  ];
  let matchedValue: string | null = null;

  for (const name of new Set(cookieNames)) {
    // SECURITY: Escape special regex characters in cookie name
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedName}=([^;]+)`);
    const match = cookieHeader.match(regex);

    if (match?.[1]) {
      matchedValue = match[1];
      break;
    }
  }

  if (!matchedValue) return null;

  // URL decode the cookie value first
  const decodedValue = decodeURIComponent(matchedValue);

  // BetterAuth uses `{token}.{signature}` format - extract just the token
  const dotIndex = decodedValue.indexOf('.');
  if (dotIndex > 0) {
    return decodedValue.substring(0, dotIndex);
  }

  return decodedValue;
}
