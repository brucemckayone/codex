/**
 * Studio E2E Test Helpers
 *
 * Utilities for navigating studio pages on org subdomains
 * and injecting auth cookies that work across subdomains.
 */

import { COOKIES } from '@codex/constants';
import type { OrgMemberContext, OrgMemberRole } from '@codex/shared-types';
import {
  authFixture,
  orgFixture,
  parseCookieString,
} from '@codex/test-utils/e2e';
import type { Page } from '@playwright/test';

const BASE_PORT = 5173;

/**
 * Navigate to the studio root on an org subdomain.
 * Waits for the studio layout to be visible.
 */
export async function navigateToStudio(page: Page, orgSlug: string) {
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}/studio`, {
    waitUntil: 'load',
  });
  // Wait for the studio layout container
  await page.waitForSelector('.studio-layout', {
    state: 'visible',
    timeout: 30000,
  });
  // Wait for Svelte 5 hydration
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Navigate to a specific studio page on an org subdomain.
 *
 * Studio uses `ssr = false` (apps/web/src/routes/_org/[slug]/studio/+layout.ts) —
 * the entire sub-tree is client-rendered. `waitUntil: 'load'` fires when the
 * initial HTML+JS bundle has loaded, but BEFORE Svelte has built the page
 * client-side. A single requestAnimationFrame after that is not enough: tests
 * race against hydration and remote-query resolution, then fail to find
 * elements that only appear once the page is mounted. Wait for the
 * `.studio-layout` shell to be visible — same pattern as `navigateToStudio`.
 */
export async function navigateToStudioPage(
  page: Page,
  orgSlug: string,
  path: string
) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}/studio${cleanPath}`, {
    waitUntil: 'load',
  });
  // Wait for the studio shell to mount (proves hydration has begun and the
  // page is being rendered, not just the HTML envelope).
  await page.waitForSelector('.studio-layout', {
    state: 'visible',
    timeout: 30000,
  });
  // Settle Svelte 5 reactive effects.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Navigate to an org page (non-studio) on an org subdomain.
 */
export async function navigateToOrgPage(
  page: Page,
  orgSlug: string,
  path: string = '/'
) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  await page.goto(`http://${orgSlug}.lvh.me:${BASE_PORT}${cleanPath}`, {
    waitUntil: 'load',
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Inject cookies for an org member into the page context.
 *
 * Cookies MUST be attached to `.lvh.me` (leading dot) so Chromium sends them
 * on requests to any `<slug>.lvh.me:5173` host. Playwright's `addCookies`
 * stores the cookie at the literal domain you give it; without the leading
 * dot, the cookie is scoped to the apex only and is NOT sent on subdomain
 * navigation — studio tests then see `locals.user = null` in
 * `+layout.server.ts` and get redirected to `/login`.
 */
export async function injectOrgCookies(
  page: Page,
  cookie: string
): Promise<void> {
  const parsedCookies = parseCookieString(cookie);
  const browserCookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax' | 'Strict' | 'None';
    expires: number;
  }[] = [];

  for (const { name, value } of parsedCookies) {
    browserCookies.push({
      name,
      value,
      domain: '.lvh.me',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: -1,
    });

    // Add the codex-session alias for session tokens
    if (name === 'better-auth.session_token') {
      browserCookies.push({
        name: COOKIES.SESSION_NAME,
        value,
        domain: '.lvh.me',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: -1,
      });
    }
  }

  await page.context().clearCookies();
  await page.context().addCookies(browserCookies);
}

/**
 * Create an org member and inject their cookies into the page.
 * Returns the member context for further assertions.
 */
export async function setupStudioUser(
  page: Page,
  options: {
    orgRole?: OrgMemberRole;
    orgSlug?: string;
    orgName?: string;
    platformRole?: string;
  } = {}
): Promise<OrgMemberContext> {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const role = options.orgRole ?? 'owner';
  const slug = options.orgSlug ?? `e2e-studio-${timestamp}-${rand}`;
  const name = options.orgName ?? `E2E Studio Org ${timestamp}`;
  const email = `e2e-${role}-${timestamp}-${rand}@test.codex`;
  const password = 'Test123!@#';

  const member = await orgFixture.createOrgMember({
    email,
    password,
    name: `E2E ${role} User`,
    orgRole: role,
    orgName: name,
    orgSlug: slug,
    platformRole: options.platformRole ?? 'creator',
  });

  await injectOrgCookies(page, member.cookie);
  return member;
}

/**
 * Shared studio auth for read-only test groups.
 * Creates a user once and returns cookies + context for reuse.
 */
export interface SharedStudioAuth {
  member: OrgMemberContext;
  cookie: string;
}

export async function registerSharedStudioUser(
  options: {
    orgRole?: OrgMemberRole;
    orgSlug?: string;
    orgName?: string;
    platformRole?: string;
  } = {}
): Promise<SharedStudioAuth> {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const role = options.orgRole ?? 'owner';
  const slug = options.orgSlug ?? `e2e-studio-${timestamp}-${rand}`;
  const name = options.orgName ?? `E2E Studio Org ${timestamp}`;
  const email = `e2e-shared-${role}-${timestamp}-${rand}@test.codex`;
  const password = 'Test123!@#';

  const member = await orgFixture.createOrgMember({
    email,
    password,
    name: `E2E Shared ${role} User`,
    orgRole: role,
    orgName: name,
    orgSlug: slug,
    platformRole: options.platformRole ?? 'creator',
  });

  return { member, cookie: member.cookie };
}

export async function injectSharedStudioAuth(
  page: Page,
  shared: SharedStudioAuth
): Promise<void> {
  await injectOrgCookies(page, shared.cookie);
}

export async function cleanupSharedStudioAuth(
  shared: SharedStudioAuth | null
): Promise<void> {
  if (shared) {
    await authFixture.logout(shared.cookie).catch(() => {});
  }
}
