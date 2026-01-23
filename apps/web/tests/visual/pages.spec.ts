/**
 * Visual Regression Tests for Application Pages
 *
 * These tests capture full-page screenshots to detect unintended layout changes.
 * Run with: pnpm test:visual
 * Update baselines: pnpm test:visual:update
 *
 * NOTE: The dev server must be running on port 3000 before running these tests.
 */
import { expect, test } from '@playwright/test';

test.describe('Auth Pages Visual Regression', () => {
  test('Login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('Register page', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('register-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('Forgot password page', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('forgot-password-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Form Validation States', () => {
  test('Login form with validation errors', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Submit empty form to trigger validation
    const submitButton = page.getByRole('button', { name: /sign in|log in/i });
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(200); // Wait for validation to render
    }

    await expect(page).toHaveScreenshot('login-page-validation-errors.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02, // Slightly higher tolerance for dynamic content
    });
  });

  test('Register form with validation errors', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    // Submit empty form to trigger validation
    const submitButton = page.getByRole('button', {
      name: /sign up|register|create account/i,
    });
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(200);
    }

    await expect(page).toHaveScreenshot('register-page-validation-errors.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Responsive Breakpoints', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
  ];

  for (const viewport of viewports) {
    test(`Login page - ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot(`login-page-${viewport.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
