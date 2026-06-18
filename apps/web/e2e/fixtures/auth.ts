/**
 * Authenticated E2E Testing Fixtures
 *
 * Provides Playwright fixtures for authenticated E2E tests.
 * Uses fresh unique users per test via @codex/test-utils authFixture.
 *
 * Usage:
 * ```ts
 * import { test } from '../fixtures/auth';
 *
 * test('my authenticated test', async ({ page, authenticateAsUser }) => {
 *   await authenticateAsUser(); // Creates and logs in a fresh user
 *   await page.goto('/account');
 *   // Test authenticated page...
 * });
 * ```
 */

import {
  authFixture,
  buildPlaywrightCookies,
  orgFixture,
  type PlaywrightCookie,
} from '@codex/test-utils/e2e';
import { test as base, type Page } from '@playwright/test';

/**
 * Check if the Auth Worker is healthy and ready to accept requests
 */
async function checkAuthWorkerHealthy(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:42069/health');
    return response.status === 200 || response.status === 503;
  } catch {
    return false;
  }
}

type AuthenticateAsUserFixture = {
  authenticateAsUser: () => Promise<void>;
};

/**
 * Organization Member Fixtures
 */
type OrgMemberFixture = {
  createOrgMember: typeof orgFixture.createOrgMember;
  createOrgWithMembers: typeof orgFixture.createOrgWithMembers;
  getMemberByRole: typeof orgFixture.getMemberByRole;
};

type AuthFixtures = AuthenticateAsUserFixture & OrgMemberFixture;

export const test = base.extend<AuthFixtures>({
  authenticateAsUser: async ({ page }, use) => {
    // Verify auth worker is healthy first
    const isHealthy = await checkAuthWorkerHealthy();
    if (!isHealthy) {
      console.warn(
        'Auth Worker not running on port 42069 - authentication may fail'
      );
    }

    let userCookie: string | null = null;

    const authenticate = async () => {
      // Fresh unique user per test — no caching, no indices
      const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.codex`;
      const user = await authFixture.registerUser({
        email,
        password: 'Test123!@#',
        name: 'E2E Test User',
      });
      userCookie = user.cookie;

      await page.context().clearCookies();
      await page.context().addCookies(buildPlaywrightCookies(user.cookie));
    };

    await use(authenticate);

    // Cleanup: invalidate the session after each test
    if (userCookie) {
      await authFixture.logout(userCookie).catch(() => {});
    }
  },

  // Org member fixtures (using shared logic from test-utils)
  createOrgMember: async ({ page: _page }, use) => {
    await use(orgFixture.createOrgMember);
  },
  createOrgWithMembers: async ({ page: _page }, use) => {
    await use(orgFixture.createOrgWithMembers);
  },
  getMemberByRole: async ({ page: _page }, use) => {
    await use(orgFixture.getMemberByRole);
  },
});

export { expect } from '@playwright/test';

/**
 * Shared auth helper for beforeAll patterns.
 *
 * Registers a single user and returns cookies that can be injected
 * into page contexts via beforeEach. Use for describe blocks where
 * all tests are read-only (no mutations that leak between tests).
 *
 * Usage:
 * ```ts
 * let sharedCookies: SharedAuthCookies;
 *
 * test.beforeAll(async () => {
 *   sharedCookies = await registerSharedUser();
 * });
 *
 * test.beforeEach(async ({ page }) => {
 *   await injectSharedAuth(page, sharedCookies);
 * });
 * ```
 */
export interface SharedAuthCookies {
  cookies: PlaywrightCookie[];
  rawCookie: string;
}

export async function registerSharedUser(): Promise<SharedAuthCookies> {
  const isHealthy = await checkAuthWorkerHealthy();
  if (!isHealthy) {
    console.warn(
      'Auth Worker not running on port 42069 - shared auth may fail'
    );
  }

  const email = `e2e-shared-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.codex`;
  const user = await authFixture.registerUser({
    email,
    password: 'Test123!@#',
    name: 'E2E Shared User',
  });

  return {
    cookies: buildPlaywrightCookies(user.cookie),
    rawCookie: user.cookie,
  };
}

export async function injectSharedAuth(
  page: Page,
  shared: SharedAuthCookies
): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies(shared.cookies);
}

export async function cleanupSharedAuth(
  shared: SharedAuthCookies | null
): Promise<void> {
  if (shared) {
    await authFixture.logout(shared.rawCookie).catch(() => {});
  }
}
