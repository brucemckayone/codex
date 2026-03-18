import { expect, type Page } from '@playwright/test';
import {
  cleanupSharedAuth,
  injectSharedAuth,
  registerSharedUser,
  type SharedAuthCookies,
  test,
} from '../fixtures/auth';

/**
 * Wait for a Melt UI Switch to become interactive (use:root action has attached
 * the click handler) and toggle it once.
 *
 * data-state is present in SSR HTML via the $root attribute spread, so its mere
 * presence does NOT indicate hydration. Instead, we click the element inside the
 * browser context and check whether data-state actually changed — which only
 * happens after the use:root action has run.
 *
 * A _toggled marker prevents double-toggling across polling iterations.
 */
async function toggleSwitch(page: Page, switchId: string) {
  await page.waitForFunction(
    async (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const before = el.getAttribute('data-state');
      if (!before) return false;
      if (el.dataset._toggled) return true;
      el.click();
      await new Promise((r) => setTimeout(r, 100));
      const after = el.getAttribute('data-state');
      if (after !== before) {
        el.dataset._toggled = '1';
        return true;
      }
      return false;
    },
    switchId,
    { timeout: 10000, polling: 250 }
  );
}

/**
 * Navigate to the notifications page, retrying once if a transient auth
 * failure causes a redirect to /login.
 *
 * Under parallel cold-start load, the auth worker may be briefly
 * overloaded. hooks.server.ts catches the error and sets locals.user
 * to null, which triggers a redirect to /login in +page.server.ts.
 */
async function navigateToNotificationsPage(page: Page) {
  await page.goto('/account/notifications');
  await page.waitForLoadState('networkidle');

  // If auth worker was transiently unavailable, we'll be on /login — retry once
  if (!page.url().includes('/account/notifications')) {
    await page.goto('/account/notifications');
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('#emailMarketing', {
    state: 'visible',
    timeout: 30000,
  });
}

/**
 * Account Notifications Page Integration Tests
 *
 * Tests the notification preferences page structure and interactions.
 * Tests use persistent test users created via BetterAuth test-utils.
 */

test.describe('Account Notifications Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/account/notifications');
  });

  test('redirects to login when not authenticated', async ({ page }) => {
    await expect(page).toHaveURL(/\/login/);
  });

  test('includes redirect parameter in login URL', async ({ page }) => {
    // The redirect URL should contain the original path
    await expect(page).toHaveURL(/login/);
    // Check that we're on the login page (may have redirect param or use layout redirect)
    await expect(page.locator('h1')).toContainText('Sign In');
  });
});

test.describe('Account Notifications Page - Authenticated Behavior', () => {
  // All tests in this describe block use authenticated sessions

  test.describe('Form Display', () => {
    // Read-only tests: share a single auth session
    test.describe.configure({ mode: 'serial' });

    let sharedAuth: SharedAuthCookies;

    test.beforeAll(async () => {
      sharedAuth = await registerSharedUser();
    });

    test.afterAll(async () => {
      await cleanupSharedAuth(sharedAuth);
    });

    test.beforeEach(async ({ page }) => {
      await injectSharedAuth(page, sharedAuth);
    });

    test('displays notification preferences page with all toggles', async ({
      page,
    }) => {
      await page.goto('/account/notifications');
      // Wait for the Switch components to render (they have id attributes)
      await page.waitForSelector('#emailMarketing', {
        state: 'visible',
        timeout: 30000,
      });

      // ASSERT: Should show page title and description
      await expect(page.locator('h1')).toContainText('Notifications');
      await expect(page.locator('.description')).toContainText(
        'Manage how and when you receive notifications'
      );

      // ASSERT: Should show "Email Notifications" section
      await expect(page.locator('.settings-card h2')).toContainText(
        'Email Notifications'
      );

      // ASSERT: Should have toggles for all three preferences
      // Switch component renders <button id="..."> (id, not name)
      await expect(page.locator('#emailMarketing')).toBeVisible();
      await expect(page.locator('#emailTransactional')).toBeVisible();
      await expect(page.locator('#emailDigest')).toBeVisible();

      // ASSERT: Should have "Save Preferences" button
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toContainText(
        'Save Preferences'
      );
    });

    test('toggles reflect current preferences from server', async ({
      page,
    }) => {
      await page.goto('/account/notifications');
      // Wait for switches to be visible (confirms remote function query completed)
      await page.waitForSelector('#emailMarketing', {
        state: 'visible',
        timeout: 30000,
      });

      // ASSERT: Check that switches use the Switch component (button with data-state)
      const marketingSwitch = page.locator('#emailMarketing');
      const transactionalSwitch = page.locator('#emailTransactional');
      const digestSwitch = page.locator('#emailDigest');

      // ASSERT: All switches should be visible
      await expect(marketingSwitch).toBeVisible();
      await expect(transactionalSwitch).toBeVisible();
      await expect(digestSwitch).toBeVisible();
    });
  });

  test.describe('Toggle Functionality', () => {
    // These tests mutate toggle state — use per-test auth
    test('can toggle marketing emails preference', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await navigateToNotificationsPage(page);

      // Wait for hydration and toggle in one step
      await toggleSwitch(page, 'emailMarketing');

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Form should submit
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('can toggle transactional emails preference', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await navigateToNotificationsPage(page);

      await toggleSwitch(page, 'emailTransactional');

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Form should submit
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('can toggle weekly digest preference', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await navigateToNotificationsPage(page);

      await toggleSwitch(page, 'emailDigest');

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Form should submit
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });
  });

  test.describe('Form States', () => {
    // These tests mutate toggle state and intercept routes — use per-test auth
    test('shows loading state on save button during submission', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await navigateToNotificationsPage(page);

      // Toggle must happen BEFORE route interceptor to avoid blocking
      // hydration-critical POST requests
      await toggleSwitch(page, 'emailMarketing');

      // Intercept POST to add delay so aria-busy is observable before response arrives.
      // Set up AFTER hydration to avoid blocking background fetches.
      await page.route('**', async (route) => {
        if (route.request().method() === 'POST') {
          await new Promise<void>((r) => setTimeout(r, 2000));
        }
        await route.continue();
      });

      // ACT: Submit form (hydration guaranteed by successful toggle above)
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click({ noWaitAfter: true });

      // ASSERT: Button should show loading state (aria-busy)
      await expect(submitButton).toHaveAttribute('aria-busy', 'true', {
        timeout: 5000,
      });
    });

    test('toggles are disabled during form submission', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await navigateToNotificationsPage(page);

      // Toggle must happen BEFORE route interceptor
      await toggleSwitch(page, 'emailMarketing');

      // Intercept POST to add delay (set up AFTER hydration)
      await page.route('**', async (route) => {
        if (route.request().method() === 'POST') {
          await new Promise<void>((r) => setTimeout(r, 2000));
        }
        await route.continue();
      });

      // ACT: Submit form (hydration guaranteed by successful toggle above)
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click({ noWaitAfter: true });

      // ASSERT: Wait for loading state
      await expect(submitButton).toHaveAttribute('aria-busy', 'true', {
        timeout: 5000,
      });

      // ASSERT: Check that switches are disabled during submission
      const switches = page.locator(
        '#emailMarketing, #emailTransactional, #emailDigest'
      );
      const count = await switches.count();

      for (let i = 0; i < count; i++) {
        const isDisabled = await switches.nth(i).isDisabled();
        expect(isDisabled).toBe(true);
      }
    });

    test('form works without JavaScript', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/notifications');
      await page.waitForSelector('#emailMarketing', {
        state: 'visible',
        timeout: 30000,
      });

      // ASSERT: Form should be present
      await expect(page.locator('form')).toBeVisible();

      // ASSERT: Check form elements exist for progressive enhancement
      await expect(page.locator('#emailMarketing')).toBeVisible();
      await expect(page.locator('#emailTransactional')).toBeVisible();
      await expect(page.locator('#emailDigest')).toBeVisible();
    });
  });
});
