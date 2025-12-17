/**
 * Cookie utilities for e2e tests
 * Shared session cookie extraction for auth and admin fixtures
 */

/**
 * Extract session cookies from Set-Cookie header
 * Better Auth uses both `better-auth.session_token` AND `better-auth.session_data`
 */
export function extractSessionCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('No Set-Cookie header found in response');
  }

  // Extract better-auth.session_token
  const tokenMatch = setCookieHeader.match(
    /better-auth\.session_token=([^;]+)/
  );

  // Extract better-auth.session_data (the last one, as there may be a deletion cookie first)
  const dataMatches = Array.from(
    setCookieHeader.matchAll(/better-auth\.session_data=([^;]*)/g)
  );
  let sessionData: string | null = null;
  for (const match of dataMatches) {
    if (match[1] && match[1].length > 0) {
      sessionData = match[1];
    }
  }

  if (tokenMatch) {
    // Send both cookies (Better Auth requires both for session validation)
    const cookies = [`better-auth.session_token=${tokenMatch[1]}`];
    if (sessionData) {
      cookies.push(`better-auth.session_data=${sessionData}`);
    }
    return cookies.join('; ');
  }

  // Fallback: try codex-session (configured name)
  const codexMatch = setCookieHeader.match(/codex-session=([^;]+)/);
  if (codexMatch) {
    return `codex-session=${codexMatch[1]}`;
  }

  throw new Error(
    `No session cookie found in Set-Cookie header: ${setCookieHeader}`
  );
}
