/**
 * Authenticated E2E Testing Fixtures
 *
 * Provides Playwright fixtures for authenticated E2E tests.
 * Uses persistent test users with real sessions created via BetterAuth test-utils.
 *
 * Usage:
 * ```ts
 * import { test } from '../fixtures/auth';
 *
 * test('my authenticated test', async ({ page, authenticateAsUser }) => {
 *   await authenticateAsUser(); // Uses test user #1 by default
 *   await page.goto('/account');
 *   // Test authenticated page...
 * });
 *
 * test('parallel test with different user', async ({ page, authenticateAsUser }) => {
 *   await authenticateAsUser(2); // Uses test user #2
 *   await page.goto('/account');
 *   // No conflict with test user #1
 * });
 * ```
 */

import { test as base } from '@playwright/test';
import { getSessionCookieName, getTestUser } from '../helpers/auth';

/**
 * Authenticated test fixtures
 *
 * Extends Playwright's base test with authentication helpers.
 */
type AuthFixtures = {
  /**
   * Authenticate the browser context with a test user session
   *
   * Injects real session cookies from persistent test users into the
   * Playwright browser context. The SvelteKit server will recognize
   * these as valid authenticated sessions.
   *
   * @param userIndex - Test user index (1-10), defaults to 1
   *
   * @example
   * ```ts
   * test('authenticated test', async ({ page, authenticateAsUser }) => {
   *   await authenticateAsUser(); // Use user #1
   *   await page.goto('/account');
   *   // Page loads with authenticated session
   * });
   *
   * test('with specific user', async ({ page, authenticateAsUser }) => {
   *   await authenticateAsUser(3); // Use user #3
   *   await page.goto('/account');
   * });
   * ```
   */
  authenticateAsUser: (userIndex?: number) => Promise<void>;

  /**
   * Get test user info without authentication
   *
   * Returns metadata about a test user (ID, email) without modifying
   * the browser context. Useful for assertions or data setup.
   *
   * @param userIndex - Test user index (1-10), defaults to 1
   * @returns Test user metadata
   *
   * @example
   * ```ts
   * test('check user info', async ({ page, testUser }) => {
   *   const user = await testUser();
   *   console.log(user.userId); // 'e2e_...'
   *   console.log(user.email);   // 'e2e-test-1@example.com'
   * });
   * ```
   */
  testUser: (userIndex?: number) => Promise<{ userId: string; email: string }>;
};

export const test = base.extend<AuthFixtures>({
  // Fixture: Authenticate and inject cookies for a test user
  authenticateAsUser: async ({ page }, use) => {
    const authenticate = async (userIndex = 1) => {
      const user = await getTestUser(userIndex);

      // Clear any existing session cookies first
      const existingCookies = await page.context().cookies();
      const sessionCookieName = getSessionCookieName();
      const otherCookies = existingCookies.filter(
        (c) => c.name !== sessionCookieName
      );
      await page.context().addCookies(otherCookies);

      // Inject new session cookies into Playwright context
      await page.context().addCookies(
        user.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain === 'localhost' ? undefined : c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        }))
      );
    };

    await use(authenticate);
  },

  // Fixture: Get test user info without authentication
  testUser: async (_baseInfo, use) => {
    const getUser = async (userIndex = 1) => {
      const user = await getTestUser(userIndex);
      return {
        userId: user.userId,
        email: user.email,
      };
    };

    await use(getUser);
  },
});
