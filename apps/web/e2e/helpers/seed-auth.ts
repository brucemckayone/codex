/**
 * Seed-user auth helper for Playwright E2E tests.
 *
 * Signs in as a pre-seeded test user (default: viewer@test.com from the seed
 * script) via the `/api/test/fast-signin` endpoint on the auth worker. This
 * bypasses the standard form-driven login flow AND the 5/15min rate limit
 * that gates the real /api/auth/sign-in/email path.
 *
 * Two crucial details (see apps/web/e2e/CLAUDE.md for full rationale):
 *   1. We POST to `lvh.me:42069`, NOT `localhost:42069`. The Set-Cookie
 *      response has `Domain=.lvh.me` which Chromium silently rejects if the
 *      response host doesn't match the cookie domain.
 *   2. Playwright's `page.request` cookie jar does NOT always merge into
 *      `page.context()` — we manually extract Set-Cookie headers and call
 *      `addCookies()` so the browser session has the cookie on next nav.
 */

import { expect, type Page } from '@playwright/test';
import { aliasSessionCookies, parseSetCookieHeaders } from './auth-cookies';

export const SEED_VIEWER = {
  email: 'viewer@test.com',
  password: 'Test1234!',
} as const;

export interface LoginAsSeedOptions {
  /** Override which seeded user to sign in as. Defaults to {@link SEED_VIEWER}. */
  user?: { email: string; password: string };
  /**
   * URL to navigate to after the cookie is set, to confirm the session
   * landed. Pass `null` to skip the post-login navigation (caller will
   * navigate explicitly). Defaults to `/library`.
   */
  navigateTo?: string | null;
  /**
   * URL pattern asserted via `toHaveURL` after `navigateTo`. Defaults to
   * `/\/library/` matching the default `navigateTo`. Ignored when
   * `navigateTo` is null.
   */
  verifyUrlPattern?: RegExp;
}

export async function loginAsSeedViewer(
  page: Page,
  opts: LoginAsSeedOptions = {}
): Promise<void> {
  const user = opts.user ?? SEED_VIEWER;
  const navigateTo =
    opts.navigateTo === undefined ? '/library' : opts.navigateTo;
  const verifyUrlPattern = opts.verifyUrlPattern ?? /\/library/;

  const response = await page.request.post(
    'http://lvh.me:42069/api/test/fast-signin',
    {
      headers: { 'Content-Type': 'application/json' },
      data: { email: user.email, password: user.password },
    }
  );
  if (!response.ok()) {
    throw new Error(
      `fast-signin failed: ${response.status()} ${await response.text()}`
    );
  }

  const parsed = parseSetCookieHeaders(response);
  const browserCookies = aliasSessionCookies(parsed);
  await page.context().addCookies(browserCookies);

  if (navigateTo !== null) {
    await page.goto(navigateTo);
    await expect(page).toHaveURL(verifyUrlPattern, { timeout: 10_000 });
  }
}
