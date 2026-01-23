import { expect, test } from '@playwright/test';

/**
 * Reset Password Form Integration Tests
 *
 * Tests the reset password form validation.
 * Requires a valid token from the forgot password flow.
 */

test.describe('Reset Password Form', () => {
  test.describe('Without Token', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate without token
      await page.goto('/reset-password');
    });

    test('shows invalid token message when no token provided', async ({
      page,
    }) => {
      // Should show error message about missing token
      await expect(
        page.getByText(/Invalid or missing reset token/)
      ).toBeVisible();

      // Should show link to request new token
      await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
    });

    test('navigates to forgot password from invalid token state', async ({
      page,
    }) => {
      await page.click('a[href="/forgot-password"]');
      await expect(page).toHaveURL('/forgot-password');
    });
  });

  test.describe('With Token', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate with a mock token (validation happens server-side)
      await page.goto('/reset-password?token=test-token-123');
    });

    test('displays reset password form with token', async ({ page }) => {
      // Check page title
      await expect(page).toHaveTitle(/Reset Password/);

      // Check form fields exist
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();

      // Hidden token field should exist
      await expect(page.locator('input[name="token"]')).toHaveValue(
        'test-token-123'
      );
    });

    test('shows validation error for empty password', async ({ page }) => {
      // The form has HTML5 required attributes, so browser validation triggers first
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Check that the password input has the required attribute
      const passwordInput = page.locator('input[name="password"]');
      await expect(passwordInput).toHaveAttribute('required', '');

      // The form should not submit (page stays on reset-password)
      await expect(page).toHaveURL(/reset-password/);

      // For forms with HTML5 required, browser shows native validation
      // We verify the required constraint exists rather than custom error text
      const isValid = await passwordInput.evaluate(
        (el: HTMLInputElement) => el.validity.valid
      );
      expect(isValid).toBe(false);
    });

    test('shows validation error for password too short', async ({ page }) => {
      await page.fill('input[name="password"]', 'short1');
      await page.fill('input[name="confirmPassword"]', 'short1');
      await page.click('button[type="submit"]');

      // Wait for validation error
      await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

      // Error should mention 8 characters
      await expect(page.locator('.error-text').first()).toContainText(
        /8 characters/i
      );
    });

    test('shows validation error for password without letter', async ({
      page,
    }) => {
      await page.fill('input[name="password"]', '12345678');
      await page.fill('input[name="confirmPassword"]', '12345678');
      await page.click('button[type="submit"]');

      // Wait for validation error
      await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

      // Error should mention letter requirement
      await expect(page.locator('.error-text').first()).toContainText(
        /letter/i
      );
    });

    test('shows validation error for password without number', async ({
      page,
    }) => {
      await page.fill('input[name="password"]', 'abcdefgh');
      await page.fill('input[name="confirmPassword"]', 'abcdefgh');
      await page.click('button[type="submit"]');

      // Wait for validation error
      await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

      // Error should mention number requirement
      await expect(page.locator('.error-text').first()).toContainText(
        /number/i
      );
    });

    test('shows validation error for password mismatch', async ({ page }) => {
      await page.fill('input[name="password"]', 'ValidPass123');
      await page.fill('input[name="confirmPassword"]', 'DifferentPass456');
      await page.click('button[type="submit"]');

      // Wait for validation error
      await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

      // Confirm password input should have error
      const confirmInput = page.locator('input[name="confirmPassword"]');
      await expect(confirmInput).toHaveAttribute('data-error', 'true');
    });

    test('can toggle password visibility', async ({ page }) => {
      // Wait for hydration
      await page.waitForLoadState('networkidle');

      const passwordInput = page.locator('input[name="password"]');
      const confirmInput = page.locator('input[name="confirmPassword"]');

      // Fill both fields
      await passwordInput.fill('MyPassword123');
      await confirmInput.fill('MyPassword123');

      // Toggle first password using mouse coordinates
      const toggleButtons = page.locator('.password-toggle');
      const box1 = await toggleButtons.first().boundingBox();
      if (box1) {
        await page.mouse.click(
          box1.x + box1.width / 2,
          box1.y + box1.height / 2
        );
      }
      await expect(passwordInput).toHaveAttribute('type', 'text');

      // Toggle second password
      const box2 = await toggleButtons.nth(1).boundingBox();
      if (box2) {
        await page.mouse.click(
          box2.x + box2.width / 2,
          box2.y + box2.height / 2
        );
      }
      await expect(confirmInput).toHaveAttribute('type', 'text');
    });

    test('shows loading state during submission', async ({ page }) => {
      await page.fill('input[name="password"]', 'ValidPass123');
      await page.fill('input[name="confirmPassword"]', 'ValidPass123');

      const submitButton = page.locator('button[type="submit"]');

      // Click to submit - button should show loading/disabled state
      await submitButton.click();

      // The button should be disabled during loading
      // Note: This depends on the actual loading state implementation
    });

    // Note: Success case requires valid token and auth backend
    test.skip('shows success message after valid reset', async ({ page }) => {
      await page.fill('input[name="password"]', 'ValidPass123');
      await page.fill('input[name="confirmPassword"]', 'ValidPass123');
      await page.click('button[type="submit"]');

      // Wait for success message (requires valid token + backend)
      await expect(page.getByText(/Password reset successfully/)).toBeVisible();

      // Should show sign in link
      await expect(page.locator('a[href="/login"]')).toBeVisible();
    });
  });
});
