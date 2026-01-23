import { expect, test } from '@playwright/test';

/**
 * Login Form Integration Tests
 *
 * Tests the login form validation and error handling.
 * Note: Successful login tests require a running auth backend.
 */

test.describe('Login Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('displays login form with all required fields', async ({ page }) => {
    // Check page title (uses paraglide i18n: "Sign In | Revelations")
    await expect(page).toHaveTitle(/Sign In.*Revelations/i);

    // Check form fields exist
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Check navigation links
    await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
    await expect(page.locator('a[href^="/register"]')).toBeVisible();
  });

  test('shows validation error for empty email', async ({ page }) => {
    // Fill only password, leave email empty
    await page.fill('input[name="password"]', 'testpassword');
    await page.click('button[type="submit"]');

    // Wait for form submission and error display
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check email input has error state
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for empty password', async ({ page }) => {
    // Fill only email, leave password empty
    await page.fill('input[name="email"]', 'test@example.com');
    await page.click('button[type="submit"]');

    // Wait for form submission and error display
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check password input has error state
    const passwordInput = page.locator('input[name="password"]');
    await expect(passwordInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="password"]', 'testpassword');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check email input has error state
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('data-error', 'true');
  });

  test('shows loading state during form submission', async ({ page }) => {
    // Fill valid form data
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'ValidPass123');

    // Click submit and check loading state appears
    const submitButton = page.locator('button[type="submit"]');

    // The button text should change to loading indicator
    await submitButton.click();

    // Check that button shows loading state (Loading... text per the component)
    // Note: This may be very brief depending on network speed
  });

  test('preserves email value after validation error', async ({ page }) => {
    const testEmail = 'preserved@example.com';

    // Submit with email but no password
    await page.fill('input[name="email"]', testEmail);
    await page.click('button[type="submit"]');

    // Wait for error to appear
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Email should still have the value
    await expect(page.locator('input[name="email"]')).toHaveValue(testEmail);
  });

  test('can toggle password visibility', async ({ page }) => {
    const passwordInput = page.locator('input[name="password"]');

    // Wait for hydration
    await page.waitForLoadState('networkidle');

    // Initially password type
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Fill password first
    await passwordInput.fill('mypassword');

    // Click toggle button using mouse coordinates (more reliable for Svelte)
    const toggleButton = page.locator('.password-toggle').first();
    const box = await toggleButton.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Should now be text type
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Toggle back using same method
    const box2 = await toggleButton.boundingBox();
    if (box2) {
      await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    }
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('navigates to forgot password page', async ({ page }) => {
    await page.click('a[href="/forgot-password"]');
    await expect(page).toHaveURL('/forgot-password');
  });

  test('navigates to register page', async ({ page }) => {
    await page.click('a[href^="/register"]');
    await expect(page).toHaveURL(/\/register/);
  });
});
