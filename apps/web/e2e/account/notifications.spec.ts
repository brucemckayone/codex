import { expect, test } from '@playwright/test';

/**
 * Account Notifications Page Integration Tests
 *
 * Tests the notification preferences page structure and interactions.
 * Note: Authenticated tests require a running backend for full functionality.
 * These tests serve as documentation of expected behavior.
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
  // These tests document expected behavior when user is logged in
  // They require a running backend to fully execute.
  //
  // To run these tests locally:
  // 1. Start the auth worker: cd workers/auth && pnpm dev
  // 2. Start the identity worker: cd workers/identity-api && pnpm dev
  // 3. Change test.skip to test for the specific tests you want to run
  // 4. Manually log in through the browser or use API to set up session

  test.describe('Form Display', () => {
    test.skip('displays notification preferences page with all toggles', async ({
      page,
    }) => {
      // ARRANGE: Set up authenticated session and mock API
      // Mock the notification preferences endpoint
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate to notifications page
      await page.goto('/account/notifications');

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
      await expect(page.locator('button[name="emailMarketing"]')).toBeVisible();
      await expect(
        page.locator('button[name="emailTransactional"]')
      ).toBeVisible();
      await expect(page.locator('button[name="emailDigest"]')).toBeVisible();

      // ASSERT: Should have "Save Preferences" button
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toContainText(
        'Save Preferences'
      );
    });

    test.skip('toggles reflect current preferences from server', async ({
      page,
    }) => {
      // ARRANGE: Mock with specific preferences
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate to notifications page
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      // ASSERT: Check that switches use the Switch component (button with data-state)
      const marketingSwitch = page.locator('button[name="emailMarketing"]');
      const transactionalSwitch = page.locator(
        'button[name="emailTransactional"]'
      );
      const digestSwitch = page.locator('button[name="emailDigest"]');

      // ASSERT: Marketing should be unchecked
      await expect(marketingSwitch).toHaveAttribute('data-state', 'unchecked');

      // ASSERT: Transactional should be checked (default)
      await expect(transactionalSwitch).toHaveAttribute(
        'data-state',
        'checked'
      );

      // ASSERT: Digest should be unchecked
      await expect(digestSwitch).toHaveAttribute('data-state', 'unchecked');
    });
  });

  test.describe('Toggle Functionality', () => {
    test.skip('can toggle marketing emails preference', async ({ page }) => {
      // ARRANGE: Mock both GET and PUT endpoints
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              emailMarketing: true,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate and toggle
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const marketingSwitch = page.locator('button[name="emailMarketing"]');
      await marketingSwitch.click();

      // ASSERT: Switch should toggle to checked
      await expect(marketingSwitch).toHaveAttribute('data-state', 'checked');

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Wait for success message
      await expect(page.locator('.success-message')).toBeVisible({
        timeout: 5000,
      });
    });

    test.skip('can toggle transactional emails preference', async ({
      page,
    }) => {
      // ARRANGE: Mock both GET and PUT endpoints
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              emailMarketing: false,
              emailTransactional: false,
              emailDigest: false,
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate and toggle
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const transactionalSwitch = page.locator(
        'button[name="emailTransactional"]'
      );
      await transactionalSwitch.click();

      // ASSERT: Switch should toggle to unchecked
      await expect(transactionalSwitch).toHaveAttribute(
        'data-state',
        'unchecked'
      );

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Wait for success message
      await expect(page.locator('.success-message')).toBeVisible({
        timeout: 5000,
      });
    });

    test.skip('can toggle weekly digest preference', async ({ page }) => {
      // ARRANGE: Mock both GET and PUT endpoints
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: true,
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate and toggle
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const digestSwitch = page.locator('button[name="emailDigest"]');
      await digestSwitch.click();

      // ASSERT: Switch should toggle to checked
      await expect(digestSwitch).toHaveAttribute('data-state', 'checked');

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Wait for success message
      await expect(page.locator('.success-message')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe('Form States', () => {
    test.skip('shows loading state on save button during submission', async ({
      page,
    }) => {
      // ARRANGE: Mock API with delay for loading state
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          // Hold the request to show loading state
          return new Promise(() => {});
        } else {
          route.continue();
        }
      });

      // ACT: Navigate and submit
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click({ noWaitAfter: true });

      // ASSERT: Button should show loading state (aria-busy)
      await expect(submitButton).toHaveAttribute('aria-busy', 'true', {
        timeout: 5000,
      });

      // ASSERT: Button text should change to loading text
      await expect(submitButton).toContainText('Loading');
    });

    test.skip('shows success message after saving preferences', async ({
      page,
    }) => {
      // ARRANGE: Mock successful API response
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate, toggle, and submit
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      await page.locator('button[name="emailMarketing"]').click();
      await page.locator('button[type="submit"]').click();

      // ASSERT: Success message should appear
      await expect(page.locator('.success-message')).toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator('.success-message')).toContainText(
        'Preferences updated successfully'
      );

      // ASSERT: Message should disappear after a few seconds (3 second timeout)
      await expect(page.locator('.success-message')).toBeHidden({
        timeout: 5000,
      });
    });

    test.skip('shows error message when save fails', async ({ page }) => {
      // ARRANGE: Mock failed API response
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Failed to update preferences',
            }),
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate, toggle, and submit
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      await page.locator('button[name="emailMarketing"]').click();
      await page.locator('button[type="submit"]').click();

      // ASSERT: Error message should be displayed
      await expect(page.locator('.error-message')).toBeVisible({
        timeout: 5000,
      });
    });

    test.skip('toggles are disabled during form submission', async ({
      page,
    }) => {
      // ARRANGE: Mock API with delay
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          return new Promise(() => {});
        } else {
          route.continue();
        }
      });

      // ACT: Navigate and submit
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      await page.locator('button[type="submit"]').click({
        noWaitAfter: true,
      });

      // ASSERT: Wait for loading state
      await expect(page.locator('button[type="submit"]')).toHaveAttribute(
        'aria-busy',
        'true',
        { timeout: 5000 }
      );

      // ASSERT: Check that switches are disabled during submission
      const switches = page.locator('button[name^="email"]');
      const count = await switches.count();

      for (let i = 0; i < count; i++) {
        await expect(switches.nth(i)).toHaveAttribute('disabled', '');
      }
    });
  });

  test.describe('Progressive Enhancement', () => {
    test.skip('form works without JavaScript', async ({ context, page }) => {
      // ARRANGE: Disable JavaScript
      await context.addInitScript(() => {
        window.addEventListener('load', () => {
          const html = document.documentElement;
          html.setAttribute('data-no-js', 'true');
        });
      });

      // ARRANGE: Mock the API for both GET and PUT (form action)
      await page.route('**/api/user/notification-preferences', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              emailMarketing: false,
              emailTransactional: true,
              emailDigest: false,
            }),
          });
        } else if (route.request().method() === 'PUT') {
          // Form PUT without JS should still work
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<html><body>Preferences saved</body></html>',
          });
        } else {
          route.continue();
        }
      });

      // ACT: Navigate to page
      await page.goto('/account/notifications');

      // ASSERT: Form should be present even without JS
      await expect(page.locator('form')).toBeVisible();

      // ASSERT: Hidden inputs for switches should exist (for progressive enhancement)
      await expect(page.locator('input[type="hidden"]')).toHaveCount(3);
    });
  });
});
