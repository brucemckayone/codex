import { expect, test } from '@playwright/test';

/**
 * Auth Flow E2E Tests
 *
 * Tests the full authentication lifecycle through the browser:
 * register → verify email → login → session persistence → error cases.
 *
 * Prerequisites:
 * - SvelteKit dev server running (auto-started by Playwright config)
 * - Auth worker running on port 42069 (`cd workers/auth && pnpm dev`)
 */

const AUTH_WORKER_URL = 'http://localhost:42069';

const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e-${Date.now()}@test.com`,
  password: 'SecurePass123!@#',
};

/**
 * Verify email via the auth worker's test endpoint.
 * Retrieves the verification token from KV and calls BetterAuth's verify endpoint.
 */
async function verifyEmail(
  request: import('@playwright/test').APIRequestContext,
  email: string
): Promise<void> {
  // 1. Get verification token from KV via test endpoint
  const tokenRes = await request.get(
    `${AUTH_WORKER_URL}/api/test/verification-token/${encodeURIComponent(email)}`
  );

  if (!tokenRes.ok()) {
    throw new Error(
      `Failed to get verification token for ${email}: ${tokenRes.status()} ${await tokenRes.text()}`
    );
  }

  const { token } = (await tokenRes.json()) as { token: string };

  // 2. Call BetterAuth's verify endpoint with the token
  const verifyRes = await request.get(
    `${AUTH_WORKER_URL}/api/auth/verify-email?token=${token}`
  );

  if (!verifyRes.ok()) {
    throw new Error(
      `Failed to verify email: ${verifyRes.status()} ${await verifyRes.text()}`
    );
  }
}

test.describe
  .serial('Auth Flow E2E', () => {
    test.beforeAll(async ({ request }) => {
      try {
        const res = await request.get('http://localhost:42069/health');
        if (!res.ok()) test.skip(true, 'Auth worker not running on port 42069');
      } catch {
        test.skip(true, 'Auth worker not running on port 42069');
      }
    });

    test('registers a new user and redirects to /verify-email', async ({
      page,
    }) => {
      await page.goto('/register');

      await page.fill('input[name="name"]', TEST_USER.name);
      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.fill('input[name="confirmPassword"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/verify-email/, { timeout: 10_000 });
    });

    test('rejects login before email verification', async ({ page }) => {
      await page.goto('/login');

      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      // Should show error and stay on /login
      await expect(page.locator('[role="alert"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page).toHaveURL(/\/login/);
    });

    test('logs in after email verification and redirects to /library', async ({
      page,
      request,
    }) => {
      // Verify email via auth worker test endpoint
      await verifyEmail(request, TEST_USER.email);

      await page.goto('/login');

      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(/\/library/, { timeout: 10_000 });
    });

    test('session cookie persists across navigation', async ({ page }) => {
      // Login first
      await page.goto('/login');

      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/library/, { timeout: 10_000 });

      // Navigate to homepage — session should persist
      await page.goto('/');
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find((c) => c.name === 'codex-session');
      expect(sessionCookie).toBeDefined();
    });

    test('rejects duplicate registration', async ({ page }) => {
      await page.goto('/register');

      await page.fill('input[name="name"]', TEST_USER.name);
      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.fill('input[name="confirmPassword"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      await expect(page.locator('[role="alert"]')).toContainText(
        /already exists/i,
        { timeout: 10_000 }
      );
    });

    test('rejects wrong password', async ({ page }) => {
      await page.goto('/login');

      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', 'WrongPassword123!');
      await page.click('button[type="submit"]');

      await expect(page.locator('[role="alert"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page).toHaveURL(/\/login/);
    });
  });
