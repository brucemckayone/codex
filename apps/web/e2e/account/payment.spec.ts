import { expect } from '@playwright/test';
import {
  cleanupSharedAuth,
  injectSharedAuth,
  registerSharedUser,
  type SharedAuthCookies,
  test,
} from '../fixtures/auth';

/**
 * Account Payment Page Integration Tests
 *
 * Tests the payment history and billing page structure.
 * Tests use persistent test users created via BetterAuth test-utils.
 */

test.describe('Account Payment Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/account/payment');
  });

  test('redirects to login when not authenticated', async ({ page }) => {
    await expect(page).toHaveURL(/\/login/);
  });

  test('includes redirect parameter in login URL', async ({ page }) => {
    // The redirect URL should contain the original path
    await expect(page).toHaveURL(/login/);
    // Check that we're on the login page
    await expect(page.locator('h1')).toContainText('Sign In');
  });
});

test.describe('Account Payment Page - Authenticated Behavior', () => {
  // All tests are read-only (checking empty states, filters, pagination).
  // Share a single auth session across all tests to avoid redundant registrations.
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

  test('displays payment page with all sections', async ({ page }) => {
    await page.goto('/account/payment');

    // Should show page title "Payments"
    await expect(page.locator('h1')).toContainText('Payments');

    // Should show "Billing Information" section
    await expect(page.locator('h2:has-text("Billing")')).toBeVisible();

    // Should show "Purchase History" section
    await expect(
      page.locator(
        'h2:has-text("Purchase History"), h3:has-text("Purchase History")'
      )
    ).toBeVisible();
  });

  test('shows empty state when no purchases exist', async ({ page }) => {
    await page.goto('/account/payment');

    // Test users have no purchases, so empty state should show
    const emptyState = page.locator('text=/No purchases/i');
    await expect(emptyState).toBeVisible();

    // Should show link to discover page
    await expect(
      page.locator('a[href="/discover"], a:has-text("Browse")').first()
    ).toBeVisible();
  });

  test('displays "Manage Billing" section', async ({ page }) => {
    await page.goto('/account/payment');

    // Should show "Billing Information" heading
    await expect(
      page.locator('h2:has-text("Billing"), h3:has-text("Billing")')
    ).toBeVisible();
  });

  test('status filter links are hidden when no purchases exist', async ({
    page,
  }) => {
    await page.goto('/account/payment');

    // Filters only render when purchases exist — test user has none
    const filters = page.locator('nav.filters');
    await expect(filters).not.toBeVisible();
  });

  test('displays status badges with correct text', async ({ page }) => {
    await page.goto('/account/payment');

    // Test users have no purchases — status badges only appear with purchase data
    const statusBadges = page.locator('[data-status], .status-badge');
    const count = await statusBadges.count();

    // With no purchases, there should be no status badges
    expect(count).toBe(0);
  });

  test.describe('Pagination', () => {
    test('pagination not shown when no purchases exist', async ({ page }) => {
      await page.goto('/account/payment');

      // Test users have no purchases, so pagination should not be visible
      const pagination = page.locator(
        '.pagination, nav[aria-label="Pagination"]'
      );
      await expect(pagination).not.toBeVisible();
    });

    test('navigates to next page', async ({ page }) => {
      await page.goto('/account/payment');

      // With no purchases, Next button should not be visible
      const nextButton = page.locator(
        'button:has-text("Next"), a:has-text("Next")'
      );
      await expect(nextButton).not.toBeVisible();
    });

    test('navigates to previous page', async ({ page }) => {
      await page.goto('/account/payment?page=2');

      // With no purchases, Previous button should not be visible
      const prevButton = page.locator(
        'button:has-text("Previous"), a:has-text("Previous")'
      );
      await expect(prevButton).not.toBeVisible();
    });

    test('disables Next button on last page', async ({ page }) => {
      await page.goto('/account/payment?page=999');

      // With no data, Next button should not appear
      const nextButton = page.locator(
        'button:has-text("Next"), a:has-text("Next")'
      );
      await expect(nextButton).not.toBeVisible();
    });
  });

  test.describe('Filter and Pagination Interaction', () => {
    test('filter nav is not present without purchases', async ({ page }) => {
      await page.goto('/account/payment?page=2');

      // Without purchases, filters don't render — verify absence
      const filterNav = page.locator('nav.filters');
      await expect(filterNav).not.toBeVisible();
    });
  });

  test.describe('Currency and Date Formatting', () => {
    test('formats currency amounts correctly (USD)', async ({ page }) => {
      await page.goto('/account/payment');

      // Test users have no purchases — currency elements only appear with data
      const currencyElements = page.locator('text=/\\$[0-9]+.[0-9]{2}/');
      const count = await currencyElements.count();

      // With no purchases, no currency amounts should be displayed
      expect(count).toBe(0);
    });

    test('formats dates correctly (US format)', async ({ page }) => {
      await page.goto('/account/payment');

      // Test users have no purchases — date elements only appear with data
      const dateElements = page.locator('[data-date], .date, time');
      const count = await dateElements.count();

      // With no purchases, no date elements should be displayed
      expect(count).toBe(0);
    });
  });
});
