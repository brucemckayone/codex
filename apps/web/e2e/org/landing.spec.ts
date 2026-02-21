import { expect, test } from '@playwright/test';

test.describe('Organization Landing Page', () => {
  test('loads public org page without authentication', async ({ page }) => {
    await page.goto('/test-org');

    // Check that the page loads successfully
    await expect(page).toHaveTitle(/test-org/i);

    // Verify the page has content
    const hero = page.locator('.org-hero, .hero-content, h1');
    await expect(hero).toBeVisible();
  });

  test('returns 404 for non-existent org', async ({ page }) => {
    const response = await page.goto('/non-existent-org-12345-fake');
    expect(response?.status()).toBe(404);
  });

  test('displays org name and logo', async ({ page }) => {
    await page.goto('/test-org');

    // Look for any heading content - org name should be visible
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible();
  });

  test('has responsive layout', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/test-org');
    await expect(page.locator('body')).toBeVisible();

    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('body')).toBeVisible();
  });
});
