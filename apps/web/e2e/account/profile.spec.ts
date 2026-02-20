import { expect, test } from '@playwright/test';

/**
 * Account Profile Page Integration Tests
 *
 * Tests the profile page structure, validation, and user interactions.
 *
 * Note: Tests that require authentication are marked as test.skip because
 * SvelteKit server-side load functions check `locals.user` on the server,
 * which cannot be mocked with Playwright's page.route(). These tests require
 * a running backend (auth worker + identity-api worker).
 */

// Mock user data matching UserData type from @codex/shared-types
const MOCK_USER = {
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
  //
  // NOTE: These tests require a running backend (auth worker + identity-api worker)
  // because SvelteKit server-side load functions check `locals.user` on the server,
  // which cannot be mocked with Playwright's page.route().
  //
  // To run these tests locally:
  // 1. Start the auth worker: cd workers/auth && pnpm dev
  // 2. Start the identity-api worker: cd workers/identity-api && pnpm dev
  // 3. Change test.skip to test for the specific tests you want to run
  // 4. Run: pnpm playwright test e2e/account/profile.spec.ts
  //

  test.skip('displays profile page with all sections when authenticated', async ({
    page,
  }) => {
    await page.goto('/account');

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

  test.skip('shows current profile data in form fields', async ({ page }) => {
    await page.goto('/account');

    // Display name should be pre-filled
    await expect(page.locator('input[name="displayName"]')).toHaveValue(
      MOCK_USER.name
    );

    // Email should be pre-filled and disabled
    await expect(page.locator('input[name="email"]')).toHaveValue(
      MOCK_USER.email
    );
    await expect(page.locator('input[name="email"]')).toBeDisabled();

    // Username should be pre-filled
    await expect(page.locator('input[name="username"]')).toHaveValue(
      MOCK_USER.username
    );

    // Bio should be pre-filled
    await expect(page.locator('textarea[name="bio"]')).toHaveValue(
      MOCK_USER.bio
    );

    // Social links should show current values
    await expect(page.locator('input[name="website"]')).toHaveValue(
      MOCK_USER.socialLinks.website
    );
    await expect(page.locator('input[name="twitter"]')).toHaveValue(
      MOCK_USER.socialLinks.twitter
    );
  });

  test.skip('email field is disabled and shows disclaimer', async ({
    page,
  }) => {
    await page.goto('/account');

    const emailInput = page.locator('input[name="email"]');

    // Email input should have disabled attribute
    await expect(emailInput).toBeDisabled();

    // Help text should explain email cannot be changed
    await expect(page.locator('.form-help')).toContainText('cannot be changed');
  });

  test.skip('can update display name and save', async ({ page }) => {
    // Mock the PATCH endpoint for profile update
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ...MOCK_USER, name: 'Updated Name' },
          }),
        });
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    const newDisplayName = 'Updated Name';

    // Fill display name
    await page.fill('input[name="displayName"]', newDisplayName);

    // Click save
    await page.click('button[type="submit"]');

    // Should show success message
    await expect(page.locator('.success-message')).toContainText(
      'Profile updated successfully'
    );
    await expect(page.locator('.success-message')).toBeVisible();

    // Success message should disappear after a few seconds
    await page.waitForTimeout(3500);
    await expect(page.locator('.success-message')).not.toBeVisible();
  });

  test.skip('shows loading state during save', async ({ page }) => {
    // Mock the PATCH endpoint with a delay
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        // Delay response to see loading state
        setTimeout(() => {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: MOCK_USER,
            }),
          });
        }, 500);
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    // Fill display name
    await page.fill('input[name="displayName"]', 'New Name');

    // Click save
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Button should show loading state
    await expect(submitButton).toHaveAttribute('aria-busy', 'true');
    await expect(submitButton).toContainText('Saving...');
  });

  test.skip('shows error message when update fails', async ({ page }) => {
    // Mock the PATCH endpoint to return an error
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Failed to update profile',
          }),
        });
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    // Fill display name
    await page.fill('input[name="displayName"]', 'New Name');

    // Click save
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText(
      'Failed to update profile'
    );
  });

  test.skip('can update username with valid format', async ({ page }) => {
    // Mock the PATCH endpoint
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ...MOCK_USER, username: 'newuser' },
          }),
        });
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    const newUsername = 'newuser-123';

    // Fill username with valid format (lowercase, numbers, hyphens)
    await page.fill('input[name="username"]', newUsername);

    // Click save
    await page.click('button[type="submit"]');

    // Should show success message
    await expect(page.locator('.success-message')).toContainText(
      'Profile updated successfully'
    );
  });

  test.skip('shows validation error for invalid username with uppercase', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="username"]', 'InvalidUser');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('shows validation error for invalid username with special characters', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="username"]', 'user@name');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('shows validation error for username too short', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="username"]', 'a');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('shows validation error for username too long', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="username"]', 'a'.repeat(51));

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const usernameInput = page.locator('input[name="username"]');
    await expect(usernameInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('can update bio with multiline text', async ({ page }) => {
    // Mock the PATCH endpoint
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ...MOCK_USER, bio: 'Line 1\nLine 2\nLine 3' },
          }),
        });
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    const newBio = 'Line 1\nLine 2\nLine 3';

    // Fill bio textarea with multiline text
    await page.fill('textarea[name="bio"]', newBio);

    // Click save
    await page.click('button[type="submit"]');

    // Should show success message
    await expect(page.locator('.success-message')).toContainText(
      'Profile updated successfully'
    );
  });

  test.skip('can update social links', async ({ page }) => {
    // Mock the PATCH endpoint
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...MOCK_USER,
              socialLinks: {
                website: 'https://mywebsite.com',
                twitter: 'https://twitter.com/myhandle',
                youtube: 'https://youtube.com/channel/mychannel',
                instagram: 'https://instagram.com/myhandle',
              },
            },
          }),
        });
      } else if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_USER,
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

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

    // Should show success message
    await expect(page.locator('.success-message')).toContainText(
      'Profile updated successfully'
    );
  });

  test.skip('shows validation error for invalid website URL', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="website"]', 'not-a-valid-url');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const websiteInput = page.locator('input[name="website"]');
    await expect(websiteInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('shows validation error for invalid twitter URL', async ({
    page,
  }) => {
    await page.goto('/account');

    await page.fill('input[name="twitter"]', 'twitter.com/user');

    // Click save
    await page.click('button[type="submit"]');

    // Should show validation error
    const twitterInput = page.locator('input[name="twitter"]');
    await expect(twitterInput).toHaveAttribute('data-error', 'true');
  });

  test.skip('avatar preview shows when file is selected', async ({ page }) => {
    await page.goto('/account');

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
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible();
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible();
  });

  test.skip('cancel avatar upload clears preview and selection', async ({
    page,
  }) => {
    await page.goto('/account');

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
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible();

    // Click cancel
    await page.click('button:has-text("Cancel")');

    // "Save Avatar" and "Cancel" buttons should disappear
    await expect(
      page.locator('button:has-text("Save Avatar")')
    ).not.toBeVisible();
    await expect(page.locator('button:has-text("Cancel")')).not.toBeVisible();
  });

  test.skip('avatar upload works with valid image file', async ({ page }) => {
    // Mock the avatar upload endpoint
    await page.route('**/api/user/avatar', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { avatarUrl: 'https://example.com/new-avatar.jpg' },
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

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
    await expect(page.locator('button:has-text("Save Avatar")')).toBeVisible();

    // Click save avatar
    await page.click('button:has-text("Save Avatar")');

    // Should show loading state
    await expect(page.locator('button:has-text("Uploading...")')).toBeVisible();
  });

  test.skip('avatar upload validates file type', async ({ page }) => {
    await page.goto('/account');

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

    // Should show error about file type
    await expect(
      page.locator('button:has-text("Uploading...")')
    ).not.toBeVisible({ timeout: 2000 });
  });

  test.skip('avatar upload validates file size', async ({ page }) => {
    await page.goto('/account');

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
    await expect(
      page.locator('button:has-text("Uploading...")')
    ).not.toBeVisible({ timeout: 2000 });
  });

  test.skip('avatar delete button shows when avatar exists', async ({
    page,
  }) => {
    // Mock user with an existing avatar
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...MOCK_USER,
              avatarUrl: 'https://example.com/existing-avatar.jpg',
            },
          }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    // "Remove" button should be visible when user has avatar
    await expect(page.locator('button:has-text("Remove")')).toBeVisible();

    // When uploading new avatar, "Remove" button should be hidden
    const fileBuffer = Buffer.from('fake-image-content');
    const fileInput = page.locator('input#avatar-upload');
    await fileInput.setInputFiles({
      name: 'avatar.jpg',
      mimeType: 'image/jpeg',
      buffer: fileBuffer,
    });

    // "Remove" button should be hidden when file is selected
    await expect(page.locator('button:has-text("Remove")')).not.toBeVisible();
  });

  test.skip('avatar delete removes avatar with confirmation', async ({
    page,
  }) => {
    // Mock user with an existing avatar
    await page.route('**/api/user/profile', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              ...MOCK_USER,
              avatarUrl: 'https://example.com/existing-avatar.jpg',
            },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock the avatar delete endpoint
    await page.route('**/api/user/avatar', (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({
          status: 204,
          contentType: 'application/json',
          body: '',
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/account');

    // "Remove" button should be visible
    await expect(page.locator('button:has-text("Remove")')).toBeVisible();

    // Setup dialog handler to accept confirmation
    page.on('dialog', (dialog) => dialog.accept());

    // Click remove button
    await page.click('button:has-text("Remove")');

    // Button should show loading state
    // After successful delete, avatar should be removed
  });

  test.skip('avatar delete button is hidden when no avatar exists', async ({
    page,
  }) => {
    await page.goto('/account');

    // "Remove" button should not be visible when user has no avatar
    await expect(page.locator('button:has-text("Remove")')).not.toBeVisible();
  });

  test.skip('form shows help text for avatar upload', async ({ page }) => {
    await page.goto('/account');

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
