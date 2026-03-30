/**
 * Studio E2E Test Helpers
 *
 * Utilities for navigating studio pages on org subdomains
 * and injecting auth cookies that work across subdomains.
 */

import { COOKIES } from '@codex/constants';
import { dbHttp, schema } from '@codex/database';
import type { OrgMemberContext, OrgMemberRole } from '@codex/shared-types';
import {
  authFixture,
  orgFixture,
  parseCookieString,
} from '@codex/test-utils/e2e';
import type { Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

const BASE_PORT = 5173;

/**
 * Upgrade a user's platform role from 'customer' to 'creator'.
 *
 * The orgFixture registers users with platform role 'customer' by default,
 * but content-api endpoints require 'creator' or 'admin' platform role.
 * After upgrading, the user must re-login to get a fresh session with
 * the new role in the session data.
 */
async function upgradePlatformRole(
  userId: string,
  platformRole: string = 'creator'
): Promise<void> {
  await dbHttp
    .update(schema.users)
    .set({ role: platformRole })
    .where(eq(schema.users.id, userId));
}

/**
 * Re-login a user to get a fresh session cookie after a role change.
 */
async function reLoginUser(
  email: string,
  password: string
): Promise<string | null> {
  try {
    const response = await fetch(
      'http://localhost:42069/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }
    );

    const setCookies = response.headers.getSetCookie();
    if (!setCookies.length) return null;

    // Extract name=value pairs from set-cookie headers
    const cookieParts = setCookies.map((sc) => {
      const firstSemi = sc.indexOf(';');
      return firstSemi > 0 ? sc.substring(0, firstSemi) : sc;
    });

    return cookieParts.join('; ');
  } catch {
    return null;
  }
}

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
  // Wait for Svelte 5 hydration
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
 * Sets cookies on `.lvh.me` domain so they work on all subdomains.
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
      domain: 'lvh.me',
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
        domain: 'lvh.me',
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
  });

  // Upgrade platform role so content-api accepts requests
  const targetRole = options.platformRole ?? 'creator';
  if (member.user.role !== targetRole) {
    await upgradePlatformRole(member.user.id, targetRole);
    const freshCookie = await reLoginUser(email, password);
    if (freshCookie) {
      member.cookie = freshCookie;
    }
  }

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
  });

  // Upgrade platform role so content-api accepts requests
  const targetRole = options.platformRole ?? 'creator';
  if (member.user.role !== targetRole) {
    await upgradePlatformRole(member.user.id, targetRole);
    const freshCookie = await reLoginUser(email, password);
    if (freshCookie) {
      member.cookie = freshCookie;
    }
  }

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
