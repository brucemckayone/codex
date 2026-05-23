import { COOKIES } from '@codex/constants';
import { parseCookieString } from './fixtures/auth.fixture';

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expires: number;
};

const DEFAULT_BASE_URL = 'http://lvh.me:5173';

/**
 * Convert a raw Set-Cookie string into the shape Playwright's
 * `BrowserContext.addCookies` expects, deriving the cookie `domain` from the
 * Playwright base URL so the same fixture works against both `lvh.me` (local)
 * and `localhost` (CI).
 *
 * Browsers refuse to send a `Domain=lvh.me` cookie to a `localhost` host (and
 * vice versa) — RFC 6265. Hardcoding either side silently breaks the other.
 */
export function buildPlaywrightCookies(
  rawCookie: string,
  baseUrl: string = process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL
): PlaywrightCookie[] {
  const domain = new URL(baseUrl).hostname;
  const cookies: PlaywrightCookie[] = [];

  for (const { name, value } of parseCookieString(rawCookie)) {
    const base: PlaywrightCookie = {
      name,
      value,
      domain,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: -1,
    };
    cookies.push(base);

    if (name === 'better-auth.session_token') {
      cookies.push({ ...base, name: COOKIES.SESSION_NAME });
    }
  }

  return cookies;
}
