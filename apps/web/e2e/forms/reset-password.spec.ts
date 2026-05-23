import { expect, test } from '@playwright/test';

/**
 * Reset Password Form Integration Tests
 *
 * The page uses `_password` / `_confirmPassword` field names (the `_` prefix
 * is the documented anti-repopulation pattern from apps/web/CLAUDE.md — fields
 * starting with `_` are not echoed back on validation failure). It surfaces
 * server-side `result.error` strings only — there is no client-side validation
 * UI (no `.error-text`, no `data-error` attribute). Field-level Zod errors
 * therefore have no display path; the previous client-validation tests have
 * been removed accordingly.
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

      // Check form fields exist (note `_` prefix anti-repopulation pattern)
      await expect(page.locator('input[name="_password"]')).toBeVisible();
      await expect(
        page.locator('input[name="_confirmPassword"]')
      ).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();

      // Hidden token field should exist
      await expect(page.locator('input[name="token"]')).toHaveValue(
        'test-token-123'
      );
    });

    test('enforces HTML5 required attribute on empty password', async ({
      page,
    }) => {
      // The form has HTML5 required attributes, so browser validation triggers first
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Check that the password input has the required attribute
      const passwordInput = page.locator('input[name="_password"]');
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

    test('can toggle password visibility', async ({ page }) => {
      // Wait for hydration
      await page.waitForLoadState('networkidle');

      const passwordInput = page.locator('input[name="_password"]');
      const confirmInput = page.locator('input[name="_confirmPassword"]');

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
      // Wait for hydration so use:enhance is active (otherwise plain form POST)
      await page.waitForLoadState('networkidle');

      // Intercept the form POST so it stays in-flight (no auth worker needed).
      // Use ** suffix to match URLs with query params (?token=...).
      await page.route('**/reset-password**', (route) => {
        if (route.request().method() === 'POST') {
          return new Promise(() => {});
        }
        return route.continue();
      });

      await page.fill('input[name="_password"]', 'ValidPass123');
      await page.fill('input[name="_confirmPassword"]', 'ValidPass123');

      const submitButton = page.locator('button[type="submit"]');

      // Click and verify button enters loading state (aria-busy from Button's {loading} prop)
      await submitButton.click({ noWaitAfter: true });
      await expect(submitButton).toHaveAttribute('aria-busy', 'true', {
        timeout: 5000,
      });
    });

    // Note: Success case requires valid token and auth backend
    test.skip('shows success message after valid reset', async ({ page }) => {
      await page.fill('input[name="_password"]', 'ValidPass123');
      await page.fill('input[name="_confirmPassword"]', 'ValidPass123');
      await page.click('button[type="submit"]');

      // Wait for success message (requires valid token + backend)
      await expect(page.getByText(/Password reset successfully/)).toBeVisible();

      // Should show sign in link
      await expect(page.locator('a[href="/login"]')).toBeVisible();
    });
  });
});
