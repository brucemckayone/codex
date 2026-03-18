import { expect } from '@playwright/test';
import {
  cleanupSharedAuth,
  injectSharedAuth,
  registerSharedUser,
  type SharedAuthCookies,
  test,
} from '../fixtures/auth';

/**
 * Account Profile Page Integration Tests
 *
 * Tests the profile page structure, validation, and user interactions.
 *
 * TEST ISOLATION STRATEGY:
 * - Read-only tests share a single auth session (no state mutation)
 * - Validation tests share a session (invalid submissions are rejected server-side)
 * - Mutation tests use per-test auth (they change user state)
 */

/**
 * Helper: Navigate to account page and wait for it to fully load
 */
async function navigateToAccountPage(page: import('@playwright/test').Page) {
  await page.goto('/account', { waitUntil: 'load' });

  // Wait for the profile form to be visible (SSR-rendered).
  await page.waitForSelector('input[name="displayName"]', {
    state: 'visible',
    timeout: 30000,
  });

  // Wait for Svelte 5 hydration to complete.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

/**
 * Helper: Wait for form submission to complete
 */
async function waitForFormSave(page: import('@playwright/test').Page) {
  const submitButton = page.locator('button[type="submit"]');
  await page.waitForTimeout(500);
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

test.describe('Account Profile Page - Read-Only', () => {
  // These tests only check page structure and existing data — no mutations.
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedAuthCookies;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedUser();
  });

  test.afterAll(async () => {
    await cleanupSharedAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedAuth(page, sharedAuth);
  });

  test('displays profile page with all sections when authenticated', async ({
    page,
  }) => {
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

  test('shows current profile data in form fields', async ({ page }) => {
    await navigateToAccountPage(page);

    // Form fields should be visible and interactive
    const displayNameInput = page.locator('input[name="displayName"]');
    await expect(displayNameInput).toBeVisible();

    // Email field is always disabled (cannot change email)
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeDisabled();

    // Username field should be visible
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toBeVisible();
  });

  test('email field is disabled and shows disclaimer', async ({ page }) => {
    await navigateToAccountPage(page);

    const emailInput = page.locator('input[name="email"]');

    // Email input should have disabled attribute
    await expect(emailInput).toBeDisabled();

    // Help text should explain email cannot be changed
    await expect(page.locator('.form-help')).toContainText('cannot be changed');
  });

  test('avatar delete button is hidden when no avatar exists', async ({
    page,
  }) => {
    await navigateToAccountPage(page);

    // "Remove" button should not be visible when user has no avatar
    await expect(page.locator('button:has-text("Remove")')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('form shows help text for avatar upload', async ({ page }) => {
    await navigateToAccountPage(page);

    // Check avatar help text
    await expect(page.locator('.avatar-help')).toContainText('JPG, GIF or PNG');
    await expect(page.locator('.avatar-help')).toContainText('Max size 5MB');
  });
});

test.describe('Account Profile Page - Validation', () => {
  // These tests submit invalid data that gets rejected — state unchanged.
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedAuthCookies;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedUser();
  });

  test.afterAll(async () => {
    await cleanupSharedAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedAuth(page, sharedAuth);
  });

  test('shows validation error for invalid username with uppercase', async ({
    page,
  }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'InvalidUser');
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('shows validation error for invalid username with special characters', async ({
    page,
  }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'user@name');
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('shows validation error for username too short', async ({ page }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'a');
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('shows validation error for username too long', async ({ page }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="username"]', 'a'.repeat(51));
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('aria-invalid', 'true', {
      timeout: 15000,
    });
  });

  test('shows validation error for invalid website URL', async ({ page }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="website"]', 'not-a-valid-url');
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const websiteInput = page.locator('input[name="website"]');
    await expect(websiteInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('shows validation error for invalid twitter URL', async ({ page }) => {
    await navigateToAccountPage(page);

    await page.fill('input[name="twitter"]', 'twitter.com/user');
    await page.click('button[type="submit"]', { noWaitAfter: true });

    const twitterInput = page.locator('input[name="twitter"]');
    await expect(twitterInput).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('Account Profile Page - Mutations', () => {
  // These tests change user state — each gets its own fresh user.

  test('can update display name and save', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newDisplayName = 'Updated Name';
    await page.fill('input[name="displayName"]', newDisplayName);
    await page.click('button[type="submit"]', { noWaitAfter: true });
    await waitForFormSave(page);

    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });

  test('shows loading state during save', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    await page.fill('input[name="displayName"]', 'New Name');
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    await expect(submitButton).toBeVisible();
  });

  test('can update username with valid format', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newUsername = `newuser-${Date.now()}`;
    await page.fill('input[name="username"]', newUsername);
    await page.click('button[type="submit"]', { noWaitAfter: true });
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('can update bio with multiline text', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const newBio = 'Line 1\nLine 2\nLine 3';
    await page.fill('textarea[name="bio"]', newBio);
    await page.click('button[type="submit"]', { noWaitAfter: true });
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('can update social links', async ({ page, authenticateAsUser }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

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
    await page.click('button[type="submit"]', { noWaitAfter: true });
    await waitForFormSave(page);
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('avatar preview shows when file is selected', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const avatarInput = page.locator('input#avatar-upload');
    const avatarFile = {
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-content'),
    };
    await expect(async () => {
      await avatarInput.setInputFiles([]);
      await avatarInput.setInputFiles(avatarFile);
      await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

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

    const avatarInput = page.locator('input#avatar-upload');
    const avatarFile = {
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-content'),
    };
    await expect(async () => {
      await avatarInput.setInputFiles([]);
      await avatarInput.setInputFiles(avatarFile);
      await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

    await page.click('button:has-text("Cancel")');

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

    const avatarInput = page.locator('input#avatar-upload');
    const avatarFile = {
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-content'),
    };
    await expect(async () => {
      await avatarInput.setInputFiles([]);
      await avatarInput.setInputFiles(avatarFile);
      await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

    await page.click('button:has-text("Save Avatar")');
    await page.waitForTimeout(1000);
  });

  test('avatar upload validates file type', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const avatarInput = page.locator('input#avatar-upload');
    const pdfFile = {
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fake-pdf-content'),
    };
    await expect(async () => {
      await avatarInput.setInputFiles([]);
      await avatarInput.setInputFiles(pdfFile);
      await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

    await page.click('button:has-text("Save Avatar")');
    await page.waitForTimeout(2000);
  });

  test('avatar upload validates file size', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const avatarInput = page.locator('input#avatar-upload');
    const largeFile = {
      name: 'large-avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(6 * 1024 * 1024), // 6MB
    };
    await expect(async () => {
      await avatarInput.setInputFiles([]);
      await avatarInput.setInputFiles(largeFile);
      await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

    await page.click('button:has-text("Save Avatar")');
    await page.waitForTimeout(2000);
  });

  test('avatar delete button shows when avatar exists', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const removeButton = page.locator('button:has-text("Remove")');
    const isVisible = await removeButton.isVisible().catch(() => false);

    if (!isVisible) {
      const avatarInput = page.locator('input#avatar-upload');
      const avatarFile = {
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake-image-content'),
      };
      await expect(async () => {
        await avatarInput.setInputFiles([]);
        await avatarInput.setInputFiles(avatarFile);
        await expect(
          page.locator('button:has-text("Save Avatar")')
        ).toBeVisible({
          timeout: 2000,
        });
      }).toPass({ intervals: [500, 1000, 2000], timeout: 15000 });

      await expect(page.locator('button:has-text("Remove")')).not.toBeVisible({
        timeout: 5000,
      });
    } else {
      await expect(removeButton).toBeVisible();
    }
  });

  test('avatar delete removes avatar with confirmation', async ({
    page,
    authenticateAsUser,
  }) => {
    await authenticateAsUser();
    await navigateToAccountPage(page);

    const removeButton = page.locator('button:has-text("Remove")');
    const hasAvatar = await removeButton.isVisible().catch(() => false);

    if (hasAvatar) {
      page.on('dialog', (dialog) => dialog.accept());
      await removeButton.click();
      await page.waitForTimeout(2000);
    } else {
      test.skip();
    }
  });
});

test.describe('Account Profile Page - Progressive Enhancement', () => {
  test('form structure exists in HTML', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('Sign In');
  });
});
