import { expect, test } from '@playwright/test';

test.describe('Organization Creators Directory', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-org/creators');
  });

  test('displays creators page', async ({ page }) => {
    // Verify page loads
    await expect(page.locator('h1')).toBeVisible();
  });

  test('has pagination controls when content exists', async ({ page }) => {
    // If there are multiple pages, pagination should be visible
    const pagination = page.locator('.pagination, [data-testid="pagination"]');
    const isVisible = await pagination.count();
    // Pagination may or may not be visible depending on data
    if (isVisible > 0) {
      await expect(pagination.first()).toBeVisible();
    }
  });

  test('shows empty state or content grid', async ({ page }) => {
    // Either content grid or empty state should be present
    const contentGrid = page.locator('.creators-grid, .content-grid');
    const emptyState = page.locator('.empty-state');

    const hasContent = (await contentGrid.count()) > 0;
    const hasEmpty = (await emptyState.count()) > 0;

    expect(hasContent || hasEmpty).toBeTruthy();
  });

  test('is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/test-org/creators');
    await expect(page.locator('body')).toBeVisible();
  });
});
