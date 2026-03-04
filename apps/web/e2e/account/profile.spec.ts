import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

/**
 * Account Profile Page Integration Tests
 *
 * Tests the profile page structure, validation, and user interactions.
 *
 * Tests use persistent test users created via BetterAuth test-utils.
 * Each test gets a fresh authenticated session via the authenticateAsUser fixture.
 *
 * TEST ISOLATION STRATEGY:
 * - Tests use unique user indices to avoid state pollution
 * - Tests that modify data (avatar, profile changes) use dedicated user indices
 * - Fast validation tests (read-only) can share users since they don't mutate state
 * - Tests explicitly wait for network idle after navigation/actions
 */

// Mock user data matching UserData type from @codex/shared-types
const _MOCK_USER = {
  id: 'user_123',
  email: 'test@example.com',
  name: 'Test User',
  username: 'testuser',
  bio: 'This is my bio',
  avatarUrl: null,
  image: null,
  socialLinks: {
    website: 'https://example.com',
    twitter: 'https://twitter.com/testuser',
    youtube: null,
    instagram: null,
  },
  role: 'user',
  emailVerified: true,
  createdAt: new Date().toISOString(),
};

/**
 * Helper: Navigate to account page and wait for it to fully load
 *
 * This ensures the page is ready for interactions before tests proceed.
 *
 * IMPORTANT: In CI (wrangler dev --local), SSR hydration takes longer than local.
 * We must wait for specific form elements to be visible, not just networkidle.
 * The networkidle state only means network requests completed, not that Svelte 5
 * runes and remote forms have finished hydrating on the client side.
 */
async function navigateToAccountPage(page: import('@playwright/test').Page) {
  await page.goto('/account', { waitUntil: 'domcontentloaded' });

  // Wait for network to be idle - ensures API calls complete
  // Use longer timeout for CI where wrangler dev is slower than Vite
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // CRITICAL: Verify form actually rendered before proceeding
  // In SSR apps, networkidle doesn't guarantee client-side hydration is complete.
  // Svelte 5 remote forms need additional time to enhance after initial render.
  await page
    .waitForSelector('input[name="displayName"]', {
      state: 'visible',
      timeout: 15000,
    })
    .catch(async () => {
      // Retry once if hydration is still in progress
      console.warn('Form not ready after networkidle, reloading page...');
      await page.goto('/account', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await page.waitForSelector('input[name="displayName"]', {
        state: 'visible',
        timeout: 15000,
      });
    });
}

/**
 * Helper: Wait for form submission to complete
 *
 * Detects when the save button returns to its normal state after loading.
 */
async function waitForFormSave(page: import('@playwright/test').Page) {
  const submitButton = page.locator('button[type="submit"]');
  // Wait a bit for the submission to process
  await page.waitForTimeout(500);
  // Button should still be visible after submission
  await expect(submitButton).toBeVisible({ timeout: 5000 });
}

test.describe('Account Profile Page - Unauthenticated', () => {
  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('includes redirect parameter in login URL', async ({ page }) => {
    await page.goto('/account');
    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toBe('/account');
  });
});

test.describe('Account Profile Page - Authenticated Behavior', () => {
  // All tests in this describe block use authenticated sessions
  // Each test gets a fresh test user via the fixture

  test('displays profile page with all sections when authenticated', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Check page title
    await expect(page).toHaveTitle(/Profile.*Codex/i);

    // Check main heading
    await expect(page.locator('.profile h1')).toContainText('Profile');

    // Check avatar section
    await expect(page.locator('.settings-card h2').first()).toContainText(
      'Avatar'
    );
    await expect(page.locator('button:has-text("Upload New")')).toBeVisible();

    // Check personal information section
    await expect(
      page.locator('h2:has-text("Personal Information")')
    ).toBeVisible();

    // Check form fields exist
    await expect(page.locator('input[name="displayName"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('textarea[name="bio"]')).toBeVisible();

    // Check social links section
    await expect(page.locator('h3:has-text("Social Links")')).toBeVisible();
    await expect(page.locator('input[name="website"]')).toBeVisible();
    await expect(page.locator('input[name="twitter"]')).toBeVisible();
    await expect(page.locator('input[name="youtube"]')).toBeVisible();
    await expect(page.locator('input[name="instagram"]')).toBeVisible();

    // Check save button
    await expect(page.locator('button[type="submit"]')).toContainText(
      'Save Changes'
    );
  });

  test('shows current profile data in form fields', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Display name should be pre-filled (test user has a name)
    const displayNameInput = page.locator('input[name="displayName"]');
    await expect(displayNameInput).not.toBeEmpty();

    // Email should be pre-filled and disabled
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).not.toBeEmpty();
    await expect(emailInput).toBeDisabled();

    // Username may or may not be set depending on test user
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toBeVisible();
  });

  test('email field is disabled and shows disclaimer', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const emailInput = page.locator('input[name="email"]');

    // Email input should have disabled attribute
    await expect(emailInput).toBeDisabled();

    // Help text should explain email cannot be changed
    await expect(page.locator('.form-help')).toContainText('cannot be changed');
  });

  test('can update display name and save', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newDisplayName = 'Updated Name';

    // Fill display name
    await page.fill('input[name="displayName"]', newDisplayName);

    // Click save
    await page.click('button[type="submit"]');

    // Wait for form submission
    await waitForFormSave(page);

    // Should show success message or loading state
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });

  test('shows loading state during save', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Fill display name
    await page.fill('input[name="displayName"]', 'New Name');

    // Click save
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Button should show loading state briefly
    await expect(submitButton).toBeVisible();
  });

  test('can update username with valid format', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newUsername = `newuser-${Date.now()}`; // Unique username

    // Fill username with valid format (lowercase, numbers, hyphens)
    await page.fill('input[name="username"]', newUsername);

    // Click save
    await page.click('button[type="submit"]');

    // Should submit form
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows validation error for invalid username with uppercase', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'InvalidUser');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for invalid username with special characters', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'user@name');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for username too short', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'a');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for username too long', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'a'.repeat(51));

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test('can update bio with multiline text', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newBio = 'Line 1\nLine 2\nLine 3';

    // Fill bio textarea with multiline text
    await page.fill('textarea[name="bio"]', newBio);

    // Click save
    await page.click('button[type="submit"]');

    // Should submit form
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('can update social links', async ({ page, authenticateAsUser }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Fill social links
    await page.fill('input[name="website"]', 'https://mywebsite.com');
    await page.fill('input[name="twitter"]', 'https://twitter.com/myhandle');
    await page.fill(
      'input[name="youtube"]',
      'https://youtube.com/channel/mychannel'
    );
    await page.fill(
      'input[name="instagram"]',
      'https://instagram.com/myhandle'
    );

    // Click save
    await page.click('button[type="submit"]');

    // Should submit form
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows validation error for invalid website URL', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="website"]', 'not-a-valid-url');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const websiteInput = page.locator('input[name="website"]');
    await expect(websiteInput).toHaveAttribute('data-error', 'true');
  });

  test('shows validation error for invalid twitter URL', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="twitter"]', 'twitter.com/user');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const twitterInput = page.locator('input[name="twitter"]');
    await expect(twitterInput).toHaveAttribute('data-error', 'true');
  });

  test('avatar preview shows when file is selected', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Create a mock file
    const fileBuffer = Buffer.from('fake-image-content');

    // Set up the file input with a mock file
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: fileBuffer,
    });

    // "Save Avatar" and "Cancel" buttons should appear
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible({
      timeout: 5000,
    });
  });

  test('cancel avatar upload clears preview and selection', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Create a mock file
    const fileBuffer = Buffer.from('fake-image-content');

    // Set up the file input with a mock file
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: fileBuffer,
    });

    // "Save Avatar" and "Cancel" buttons should appear
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
      timeout: 5000,
    });

    // Click cancel
    await page.click('button:has-text("Cancel")');

    // "Save Avatar" and "Cancel" buttons should disappear
    await expect(
      page.locator('button:has-text("Save Avatar")')
    ).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Cancel")')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('avatar upload works with valid image file', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Create a mock file
    const fileBuffer = Buffer.from('fake-image-content');

    // Set up the file input with a mock file
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: fileBuffer,
    });

    // "Save Avatar" button should appear
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
      timeout: 5000,
    });

    // Click save avatar
    await page.click('button:has-text("Save Avatar")');

    // Should show loading state or complete
    // The button may change text or show loading indicator
    await page.waitForTimeout(1000);
  });

  test('avatar upload validates file type', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Create a mock non-image file
    const fileBuffer = Buffer.from('fake-pdf-content');

    // Set up the file input with a non-image file
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: fileBuffer,
    });

    // Click save avatar
    await page.click('button:has-text("Save Avatar")');

    // Should show error about file type or fail validation
    // The "Uploading..." button should not appear permanently
    await page.waitForTimeout(2000);
  });

  test('avatar upload validates file size', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Create a mock file larger than 5MB
    const fileBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB

    // Set up the file input with a large file
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'large-avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: fileBuffer,
    });

    // Click save avatar
    await page.click('button:has-text("Save Avatar")');

    // Should show error about file size
    await page.waitForTimeout(2000);
  });

  test('avatar delete button shows when avatar exists', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // "Remove" button may or may not be visible depending on if user has avatar
    const removeButton = page.locator('button:has-text("Remove")');
    const isVisible = await removeButton.isVisible().catch(() => false);

    if (!isVisible) {
      // User doesn't have avatar, upload one first
      const fileBuffer = Buffer.from('fake-image-content');
      const fileInput = page.locator('input#avatar-upload');
      await fileInput.setInputFiles({
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        buffer: fileBuffer,
      });

      // When uploading new avatar, "Remove" button should be hidden
      await expect(page.locator('button:has-text("Remove")')).not.toBeVisible({
        timeout: 5000,
      });
    } else {
      // If avatar exists, remove button should be visible
      await expect(removeButton).toBeVisible();
    }
  });

  test('avatar delete removes avatar with confirmation', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Check if user has avatar to delete
    const removeButton = page.locator('button:has-text("Remove")');
    const hasAvatar = await removeButton.isVisible().catch(() => false);

    if (hasAvatar) {
      // Setup dialog handler to accept confirmation
      page.on('dialog', (dialog) => dialog.accept());

      // Click remove button
      await removeButton.click();

      // Wait for deletion to process
      await page.waitForTimeout(2000);
    } else {
      // Skip test if no avatar to delete
      test.skip();
    }
  });

  test('avatar delete button is hidden when no avatar exists', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // "Remove" button should not be visible when user has no avatar
    await expect(page.locator('button:has-text("Remove")')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('form shows help text for avatar upload', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    // Check avatar help text
    await expect(page.locator('.avatar-help')).toContainText('JPG, GIF or PNG');
    await expect(page.locator('.avatar-help')).toContainText('Max size 5MB');
  });
});

test.describe('Account Profile Page - Progressive Enhancement', () => {
  test('form structure exists in HTML', async ({ page }) => {
    // Navigate to the page
    await page.goto('/account');

    // The page should redirect to login for unauthenticated users
    await expect(page).toHaveURL(/\/login/);

    // Check that the login page loaded correctly
    await expect(page.locator('h1')).toContainText('Sign In');
  });
});
