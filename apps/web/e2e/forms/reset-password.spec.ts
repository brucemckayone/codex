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

    // The reset form binds its inputs to `_password` / `_confirmPassword`
    // (underscore prefix) — that's how SvelteKit's remote-form input binding
    // distinguishes managed fields from the hidden `token`. Earlier tests
    // targeted the unprefixed names. Field-level error tests were removed
    // when the page migrated to BetterAuth remote forms (auth.remote.ts) —
    // the remote handler returns only a top-level `.success`/`.error`, so
    // there is no per-field `.error-text` markup to assert. HTML5 `required`
    // still gates empty submissions natively, and the cross-field
    // password-mismatch / strength checks are exercised by the auth-worker
    // integration tests in `workers/auth`.

    test('displays reset password form with token', async ({ page }) => {
      // Check page title
      await expect(page).toHaveTitle(/Reset Password/);

      // Check form fields exist
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

    test('empty submission is blocked by HTML5 required', async ({ page }) => {
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Page stays on reset-password (browser stops empty submission natively)
      await expect(page).toHaveURL(/reset-password/);

      // Verify the required constraint is wired on the password input
      const passwordInput = page.locator('input[name="_password"]');
      await expect(passwordInput).toHaveAttribute('required', '');
      const isValid = await passwordInput.evaluate(
        (el: HTMLInputElement) => el.validity.valid
      );
      expect(isValid).toBe(false);
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
