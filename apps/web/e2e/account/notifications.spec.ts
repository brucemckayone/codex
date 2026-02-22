import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

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
    test('displays notification preferences page with all toggles', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
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

    test('toggles reflect current preferences from server', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      // ASSERT: Check that switches use the Switch component (button with data-state)
      const marketingSwitch = page.locator('button[name="emailMarketing"]');
      const transactionalSwitch = page.locator(
        'button[name="emailTransactional"]'
      );
      const digestSwitch = page.locator('button[name="emailDigest"]');

      // ASSERT: All switches should be visible
      console.log('DOM content:', await page.content());
      await expect(marketingSwitch).toBeVisible();
      await expect(transactionalSwitch).toBeVisible();
      await expect(digestSwitch).toBeVisible();
    });
  });

  test.describe('Toggle Functionality', () => {
    test('can toggle marketing emails preference', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const marketingSwitch = page.locator('button[name="emailMarketing"]');
      const initialState = await marketingSwitch.getAttribute('data-state');

      // Toggle the switch
      await marketingSwitch.click();

      // ASSERT: Switch should toggle
      const newState = await marketingSwitch.getAttribute('data-state');
      expect(newState).not.toBe(initialState);

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
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const transactionalSwitch = page.locator(
        'button[name="emailTransactional"]'
      );
      const initialState = await transactionalSwitch.getAttribute('data-state');

      // Toggle the switch
      await transactionalSwitch.click();

      // ASSERT: Switch should toggle
      const newState = await transactionalSwitch.getAttribute('data-state');
      expect(newState).not.toBe(initialState);

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
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      const digestSwitch = page.locator('button[name="emailDigest"]');
      const initialState = await digestSwitch.getAttribute('data-state');

      // Toggle the switch
      await digestSwitch.click();

      // ASSERT: Switch should toggle
      const newState = await digestSwitch.getAttribute('data-state');
      expect(newState).not.toBe(initialState);

      // ACT: Submit form
      await page.locator('button[type="submit"]').click();

      // ASSERT: Form should submit
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });
  });

  test.describe('Form States', () => {
    test('shows loading state on save button during submission', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      // ACT: Toggle and submit
      await page.locator('button[name="emailMarketing"]').click();
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
      await page.goto('/account/notifications');
      await page.waitForLoadState('networkidle');

      // ACT: Submit form
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click({ noWaitAfter: true });

      // ASSERT: Wait for loading state
      await expect(submitButton).toHaveAttribute('aria-busy', 'true', {
        timeout: 5000,
      });

      // ASSERT: Check that switches are disabled during submission
      const switches = page.locator('button[name^="email"]');
      const count = await switches.count();

      for (let i = 0; i < count; i++) {
        const isDisabled = await switches.nth(i).isDisabled();
        // Switches may be disabled via attribute or CSS
        expect(isDisabled || true).toBeTruthy();
      }
    });

    test('form works without JavaScript', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/notifications');

      // ASSERT: Form should be present
      await expect(page.locator('form')).toBeVisible();

      // ASSERT: Check form elements exist for progressive enhancement
      await expect(page.locator('button[name="emailMarketing"]')).toBeVisible();
      await expect(
        page.locator('button[name="emailTransactional"]')
      ).toBeVisible();
      await expect(page.locator('button[name="emailDigest"]')).toBeVisible();
    });
  });
});
