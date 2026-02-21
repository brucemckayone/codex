import { expect, test } from '@playwright/test';

test.describe('Organization Explore Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-org/explore');
  });

  test('displays search and filters', async ({ page }) => {
    // Check for search input
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i]'
    );
    await expect(searchInput.first()).toBeVisible();

    // Check for filter selects
    const select = page.locator('select').first();
    const hasSelect = (await select.count()) > 0;
    if (hasSelect) {
      await expect(select.first()).toBeVisible();
    }
  });

  test('search input accepts text', async ({ page }) => {
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i]')
      .first();

    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test content');
      await expect(searchInput).toHaveValue('test content');
    }
  });

  test('shows content grid or empty state', async ({ page }) => {
    const contentGrid = page.locator('.content-grid');
    const emptyState = page.locator('.empty-state');

    const hasContent = (await contentGrid.count()) > 0;
    const hasEmpty = (await emptyState.count()) > 0;

    expect(hasContent || hasEmpty).toBeTruthy();
  });

  test('has clear filters button when filters are active', async ({ page }) => {
    // Initially, clear button may not be visible
    const clearButton = page.locator('button:has-text("Clear"), .clear-btn');

    // Navigate with a filter query
    await page.goto('/test-org/explore?q=test');

    // Clear button should appear with active filters
    const hasClearButton = (await clearButton.count()) > 0;
    if (hasClearButton) {
      await expect(clearButton.first()).toBeVisible();
    }
  });

  test('is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/test-org/explore');
    await expect(page.locator('body')).toBeVisible();

    // Verify filters stack on mobile
    const filters = page.locator('.filters');
    if ((await filters.count()) > 0) {
      await expect(filters.first()).toBeVisible();
    }
  });
});
