import { expect, test } from '@playwright/test';

/**
 * Minimal E2E Tests
 */

test.describe('Homepage', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Revelations/);
  });
});

test.describe('API Health Check', () => {
  test('should return healthy status', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
  });
});
