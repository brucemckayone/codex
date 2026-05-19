import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
  setupStudioUser,
} from '../helpers/studio';

/**
 * Studio Settings E2E Tests
 *
 * Tests general settings form and branding settings page.
 * Owner role required for settings access.
 *
 * NOTE: Settings tabs use role="tab" (link-based navigation, not Melt UI).
 * NOTE: Color picker has a native color input + text hex input.
 */

test.describe('Studio Settings - General', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('general settings page loads with form fields', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    // contactQuery loading shows skeletons; wait for the real form before
    // sweeping fields.
    await page.waitForSelector('form.settings-form', {
      state: 'visible',
      timeout: 15000,
    });

    await expect(
      page.getByRole('textbox', { name: 'Platform Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Support Email' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Contact URL' })
    ).toBeVisible();

    // Timezone is a native combobox with options
    const timezone = page.getByRole('combobox', { name: 'Timezone' });
    await expect(timezone).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeVisible();
  });

  test('social media fields are visible', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await expect(
      page.getByRole('textbox', { name: 'Twitter / X' })
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'YouTube' })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Instagram' })
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'TikTok' })).toBeVisible();
  });

  test('timezone dropdown has multiple options', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await page.waitForSelector('form.settings-form', {
      state: 'visible',
      timeout: 15000,
    });

    // Timezone migrated from a native <select> to a custom Melt UI <Select>
    // combobox — options live in a popover that only mounts when the
    // trigger is clicked. Open it first, then count the listbox items.
    const timezone = page.getByRole('combobox', { name: 'Timezone' });
    await timezone.click();

    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    const count = await options.count();

    // Should have UTC plus several timezones
    expect(count).toBeGreaterThan(5);
  });

  test('contact URL field has https placeholder', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    const contactUrl = page.getByRole('textbox', { name: 'Contact URL' });
    await expect(contactUrl).toHaveAttribute('placeholder', 'https://');
  });
});

test.describe('Studio Settings - General Mutations', () => {
  test('can update platform name and save', async ({ page }) => {
    const member = await setupStudioUser(page, { orgRole: 'owner' });

    await navigateToStudioPage(page, member.organization.slug, '/settings');

    const newName = `Updated Studio ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Platform Name' }).fill(newName);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Wait for success feedback (role="status") or form to re-enable
    const success = page.locator('[role="status"]');
    await expect(success).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Studio Settings - Tabs', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('General and Branding tabs are visible', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Branding' })).toBeVisible();
  });

  test('General tab is selected on settings root', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    const generalTab = page.getByRole('tab', { name: 'General' });
    await expect(generalTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Branding tab navigates to branding page', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await page.getByRole('tab', { name: 'Branding' }).click();
    await page.waitForURL(/\/studio\/settings\/branding/);

    const brandingTab = page.getByRole('tab', { name: 'Branding' });
    await expect(brandingTab).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Studio Settings - Branding', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('branding page loads with logo upload + edit-live action', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings/branding'
    );

    // The settings/branding page was reshaped to a logo-upload card plus a
    // read-only "Current Brand" summary that delegates colour/typography
    // edits to the floating brand editor (hence the "Edit Brand Live"
    // CTA). The legacy hex picker + save button live in the brand editor
    // now — covered by brand-editor-hero-effects.spec.ts.
    await expect(
      page.getByRole('button', { name: 'Upload Logo' })
    ).toBeVisible();

    await expect(
      page.getByRole('button', { name: /Edit Brand Live/i })
    ).toBeVisible();
  });

  test('Branding tab is selected on branding page', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings/branding'
    );

    const brandingTab = page.getByRole('tab', { name: 'Branding' });
    await expect(brandingTab).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Studio Settings - Branding Mutations', () => {
  // Hex-color mutation moved out of /settings/branding when the
  // floating brand editor took over colour/typography. Coverage now
  // lives in brand-editor-hero-effects.spec.ts (full editor flow) and
  // the brand-editor unit tests. The page-level "Edit Brand Live" CTA
  // hand-off is exercised in `branding page loads with logo upload +
  // edit-live action` above.
  test('Edit Brand Live CTA is clickable on the branding page', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'owner' });

    await navigateToStudioPage(
      page,
      member.organization.slug,
      '/settings/branding'
    );

    const editLive = page.getByRole('button', { name: /Edit Brand Live/i });
    await expect(editLive).toBeVisible({ timeout: 15000 });
    await expect(editLive).toBeEnabled();
  });
});
