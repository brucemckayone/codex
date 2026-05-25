/**
 * Auth cookie helpers for Playwright E2E tests.
 *
 * Two input shapes converge here:
 *   1. Cookie REQUEST-header strings (semicolon-separated `name1=val1; ...`)
 *      — parsed by `parseCookieString` from `@codex/test-utils/e2e`. Used by
 *      `helpers/studio.ts` `injectOrgCookies`.
 *   2. Set-Cookie RESPONSE headers (from `page.request.post` returns)
 *      — parsed by `parseSetCookieHeaders` below. Used by seed-user login.
 *
 * After parsing to `{ name, value }[]`, both inputs feed `aliasSessionCookies`,
 * which adds the codex-session alias for BetterAuth's session_token cookie.
 *
 * See `apps/web/e2e/CLAUDE.md` for the dual-cookie rationale.
 */

import { COOKIES } from '@codex/constants';
import type { APIResponse, BrowserContext } from '@playwright/test';

export type BrowserCookie = Parameters<BrowserContext['addCookies']>[0][number];

const COOKIE_DEFAULTS = {
  domain: '.lvh.me',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
  expires: -1,
} as const satisfies Omit<BrowserCookie, 'name' | 'value'>;

/**
 * Convert `{ name, value }` pairs into Playwright-shaped BrowserCookies,
 * adding the `codex-session` alias whenever `better-auth.session_token` is
 * present. SvelteKit reads the session via `COOKIES.SESSION_NAME` while
 * BetterAuth emits its default name — both must be set on `.lvh.me`.
 */
export function aliasSessionCookies(
  parsed: Array<{ name: string; value: string }>,
  overrides: Partial<typeof COOKIE_DEFAULTS> = {}
): BrowserCookie[] {
  const base = { ...COOKIE_DEFAULTS, ...overrides };
  const cookies: BrowserCookie[] = [];
  for (const { name, value } of parsed) {
    cookies.push({ ...base, name, value });
    if (name === 'better-auth.session_token') {
      cookies.push({ ...base, name: COOKIES.SESSION_NAME, value });
    }
  }
  return cookies;
}

/**
 * Parse a single Set-Cookie response-header value into a `{ name, value }`
 * pair (drops options: Domain, Path, Expires, etc.). Returns null when the
 * header is malformed.
 */
function parseOneSetCookie(
  setCookieValue: string
): { name: string; value: string } | null {
  const pair = setCookieValue.split(';')[0];
  if (!pair) return null;
  const eq = pair.indexOf('=');
  if (eq < 0) return null;
  return {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
  };
}

/**
 * Extract `{ name, value }` pairs from a Playwright APIResponse's Set-Cookie
 * headers (from `page.request.*` calls).
 *
 * `aliasSessionCookies` re-applies a uniform `.lvh.me` scope so the cookies
 * are accepted on every subdomain navigation (per the lvh.me note in
 * apps/web/e2e/CLAUDE.md).
 */
export function parseSetCookieHeaders(
  response: APIResponse
): Array<{ name: string; value: string }> {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => parseOneSetCookie(h.value))
    .filter((x): x is { name: string; value: string } => x !== null);
}

/**
 * Extract `{ name, value }` pairs from a list of raw Set-Cookie header
 * values (e.g. from Node `fetch` `response.headers.getSetCookie()`).
 *
 * Companion to {@link parseSetCookieHeaders} for callers that use the global
 * Node `fetch` instead of Playwright's `page.request`.
 */
export function parseSetCookieStrings(
  setCookieHeaders: string[]
): Array<{ name: string; value: string }> {
  return setCookieHeaders
    .map(parseOneSetCookie)
    .filter((x): x is { name: string; value: string } => x !== null);
}
