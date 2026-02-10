import { expect, test } from '@playwright/test';

/**
 * Register Form Integration Tests
 *
 * Tests the registration form validation and error handling.
 * Validates email format, password strength, and password matching.
 */

test.describe('Register Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('displays registration form with all fields', async ({ page }) => {
    // Check page title (uses paraglide i18n: "Create Account | Codex")
    await expect(page).toHaveTitle(/Create Account.*Codex/i);

    // Check form fields exist
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Check password hint text
    await expect(
      page.getByText('At least 8 characters, one letter and one number.')
    ).toBeVisible();

    // Check login link
    await expect(page.locator('a[href^="/login"]')).toBeVisible();
  });

  test('shows validation error for empty email', async ({ page }) => {
    // Fill other fields but leave email empty
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="password"]', 'ValidPass123');
    await page.fill('input[name="confirmPassword"]', 'ValidPass123');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Email input should have error state
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'not-an-email');
    await page.fill('input[name="password"]', 'ValidPass123');
    await page.fill('input[name="confirmPassword"]', 'ValidPass123');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check for email-specific error
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for password too short', async ({ page }) => {
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'short1'); // Less than 8 chars
    await page.fill('input[name="confirmPassword"]', 'short1');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check error message mentions length requirement
    await expect(page.locator('.error-text').first()).toContainText(
      /8 characters/i
    );
  });

  test('shows validation error for password without letter', async ({
    page,
  }) => {
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', '12345678'); // No letters
    await page.fill('input[name="confirmPassword"]', '12345678');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check error message mentions letter requirement
    await expect(page.locator('.error-text').first()).toContainText(/letter/i);
  });

  test('shows validation error for password without number', async ({
    page,
  }) => {
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'abcdefgh'); // No numbers
    await page.fill('input[name="confirmPassword"]', 'abcdefgh');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Check error message mentions number requirement
    await expect(page.locator('.error-text').first()).toContainText(/number/i);
  });

  test('shows validation error for password mismatch', async ({ page }) => {
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'ValidPass123');
    await page.fill('input[name="confirmPassword"]', 'DifferentPass123');
    await page.click('button[type="submit"]');

    // Wait for validation error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Confirm password input should have error
    const confirmInput = page.locator('input[name="confirmPassword"]');
    await expect(confirmInput).toHaveAttribute('data-error', 'true');
  });

  test('preserves form values after validation error', async ({ page }) => {
    const testName = 'Test User';
    const testEmail = 'test@example.com';

    // Submit with mismatched passwords
    await page.fill('input[name="name"]', testName);
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', 'ValidPass123');
    await page.fill('input[name="confirmPassword"]', 'Mismatch123');
    await page.click('button[type="submit"]');

    // Wait for error
    await expect(page.locator('.error-text')).toBeVisible({ timeout: 5000 });

    // Values should be preserved
    await expect(page.locator('input[name="name"]')).toHaveValue(testName);
    await expect(page.locator('input[name="email"]')).toHaveValue(testEmail);
  });

  test('can toggle password visibility for both password fields', async ({
    page,
  }) => {
    // Wait for hydration
    await page.waitForLoadState('networkidle');

    const passwordInput = page.locator('input[name="password"]');
    const confirmInput = page.locator('input[name="confirmPassword"]');

    // Fill both password fields
    await passwordInput.fill('MyPassword123');
    await confirmInput.fill('MyPassword123');

    // Toggle first password field using mouse coordinates
    const toggleButtons = page.locator('.password-toggle');
    const box1 = await toggleButtons.first().boundingBox();
    if (box1) {
      await page.mouse.click(box1.x + box1.width / 2, box1.y + box1.height / 2);
    }
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Toggle second password field
    const box2 = await toggleButtons.nth(1).boundingBox();
    if (box2) {
      await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    }
    await expect(confirmInput).toHaveAttribute('type', 'text');
  });

  test('name field is optional', async ({ page }) => {
    // Submit without name (should not cause name validation error)
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'ValidPass123');
    await page.fill('input[name="confirmPassword"]', 'ValidPass123');
    await page.click('button[type="submit"]');

    // If there's a validation error, it should not be on the name field
    const nameInput = page.locator('input[name="name"]');
    // Wait a moment for any potential errors to appear
    await page.waitForTimeout(500);

    // Name should not have error state (it's optional)
    const dataError = await nameInput.getAttribute('data-error');
    expect(dataError).not.toBe('true');
  });

  test('navigates to login page', async ({ page }) => {
    await page.click('a[href^="/login"]');
    await expect(page).toHaveURL(/\/login/);
  });
});
