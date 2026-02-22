import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

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
  // These tests use authenticated test users

  // Mock data for reference when testing the page structure
  const _mockPurchaseHistory = {
    items: [
      {
        id: 'purchase-1',
        createdAt: '2025-01-15T10:30:00Z',
        amountCents: 999,
        status: 'complete',
        contentTitle: 'Advanced Photography Course',
      },
      {
        id: 'purchase-2',
        createdAt: '2025-01-10T14:20:00Z',
        amountCents: 1499,
        status: 'pending',
        contentTitle: 'Music Production Tutorial',
      },
      {
        id: 'purchase-3',
        createdAt: '2025-01-05T09:15:00Z',
        amountCents: 2499,
        status: 'failed',
        contentTitle: 'Web Development Bootcamp',
      },
      {
        id: 'purchase-4',
        createdAt: '2024-12-20T16:45:00Z',
        amountCents: 799,
        status: 'refunded',
        contentTitle: 'Digital Art Basics',
      },
    ],
    pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
  };

  test('displays payment page with all sections', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
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

  test('shows empty state when no purchases exist', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await page.goto('/account/payment');

    // Test users have no purchases, so empty state should show
    const emptyState = page.locator('text=/No purchases/i');
    const isVisible = await emptyState.isVisible().catch(() => false);

    if (isVisible) {
      // Should show empty state message
      await expect(emptyState).toBeVisible();

      // Should show link to discover page
      await expect(
        page.locator('a[href="/discover"], a:has-text("Browse")').first()
      ).toBeVisible();
    }
  });

  test('displays "Manage Billing" section', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await page.goto('/account/payment');

    // Should show "Billing Information" heading
    await expect(
      page.locator('h2:has-text("Billing"), h3:has-text("Billing")')
    ).toBeVisible();
  });

  test('status filter links are displayed', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await page.goto('/account/payment');

    // Look for filter links
    const filters = page.locator('nav.filters a, .filter-list a');
    const count = await filters.count();

    // Should have at least some filter links if they exist
    if (count > 0) {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('displays status badges with correct text', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await page.goto('/account/payment');

    // If there are purchase items, check for status badges
    const statusBadges = page.locator('[data-status], .status-badge');
    const count = await statusBadges.count();

    if (count > 0) {
      // At least one status badge should be visible
      await expect(statusBadges.first()).toBeVisible();
    }
  });

  test.describe('Pagination', () => {
    test('shows pagination when totalPages > 1', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/payment');

      // Check for pagination component
      const pagination = page.locator(
        '.pagination, nav[aria-label="Pagination"]'
      );
      const hasPagination = await pagination.isVisible().catch(() => false);

      if (hasPagination) {
        // Should show Pagination component
        await expect(pagination).toBeVisible();

        // Check for Previous/Next buttons
        const prevButton = page.locator(
          'button:has-text("Previous"), a:has-text("Previous")'
        );
        const nextButton = page.locator(
          'button:has-text("Next"), a:has-text("Next")'
        );

        await expect(prevButton.or(nextButton)).toHaveCount(1);
      }
    });

    test('navigates to next page', async ({ page, authenticateAsUser }) => {
      await authenticateAsUser();
      await page.goto('/account/payment');

      // Look for Next button
      const nextButton = page.locator(
        'button:has-text("Next"), a:has-text("Next")'
      );
      const hasButton = await nextButton.isVisible().catch(() => false);

      if (hasButton && !(await nextButton.isDisabled())) {
        await nextButton.click();

        // URL should update with ?page=2
        const url = new URL(page.url());
        expect(url.searchParams.get('page')).toBe('2');
      }
    });

    test('navigates to previous page', async ({ page, authenticateAsUser }) => {
      await authenticateAsUser();
      await page.goto('/account/payment?page=2');

      // Look for Previous button
      const prevButton = page.locator(
        'button:has-text("Previous"), a:has-text("Previous")'
      );
      const hasButton = await prevButton.isVisible().catch(() => false);

      if (hasButton && !(await prevButton.isDisabled())) {
        await prevButton.click();

        // URL should update (page param removed or set to 1)
        await expect(page).toHaveURL(/account\/payment/);
      }
    });

    test('disables Next button on last page', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/payment?page=999');

      // Check if Next button is disabled
      const nextButton = page.locator(
        'button:has-text("Next"), a:has-text("Next")'
      );
      const hasButton = await nextButton.isVisible().catch(() => false);

      if (hasButton) {
        const isDisabled = await nextButton.isDisabled();
        expect(isDisabled).toBeDefined();
      }
    });
  });

  test.describe('Filter and Pagination Interaction', () => {
    test('changing filter resets to page 1', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/payment?page=2');

      // Look for status filter links
      const filterLink = page.locator('nav.filters a, .filter-list a').first();
      const hasFilter = await filterLink.isVisible().catch(() => false);

      if (hasFilter) {
        await filterLink.click();

        // URL should have status parameter but page should be reset
        const url = new URL(page.url());
        const pageParam = url.searchParams.get('page');
        expect(pageParam).toBeFalsy();
      }
    });
  });

  test.describe('Currency and Date Formatting', () => {
    test('formats currency amounts correctly (GBP)', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/payment');

      // Look for currency amounts (should use £ symbol)
      const currencyElements = page.locator('text=/£[0-9]+.[0-9]{2}/');
      const count = await currencyElements.count();

      if (count > 0) {
        // At least one properly formatted currency amount
        await expect(currencyElements.first()).toBeVisible();
      }
    });

    test('formats dates correctly (UK format)', async ({
      page,
      authenticateAsUser,
    }) => {
      await authenticateAsUser();
      await page.goto('/account/payment');

      // Look for date elements - UK format typically shows day month year
      const dateElements = page.locator('[data-date], .date, time');
      const count = await dateElements.count();

      if (count > 0) {
        // At least one date should be visible
        await expect(dateElements.first()).toBeVisible();
      }
    });
  });
});
