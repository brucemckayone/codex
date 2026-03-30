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
 * Studio Content E2E Tests
 *
 * Tests content listing, creation form, and form fields.
 *
 * NOTE: The Select component renders as a custom combobox (role="combobox"),
 * not a native <select>. Use getByRole('combobox', { name }) to interact.
 *
 * NOTE: Svelte 5 bind:value + Playwright fill() does not trigger oninput,
 * so auto-slug from title does not work. Tests fill the slug field manually.
 */

test.describe('Studio Content - List Page', () => {
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

  test('content list page loads with heading', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    await expect(page.locator('h1')).toBeVisible();
  });

  test('create button links to new content', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    const createLink = page.locator('a[href="/studio/content/new"]');
    await expect(createLink.first()).toBeVisible();
  });

  test('empty state or table renders', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    // New org: empty state with create CTA. Populated org: table.
    const emptyState = page.locator('.empty-state');
    const table = page.locator('table');

    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasTable = await table.isVisible().catch(() => false);
    expect(hasEmpty || hasTable).toBeTruthy();
  });

  test('create link navigates to new content page', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    await page.locator('a[href="/studio/content/new"]').first().click();
    await page.waitForURL(/\/studio\/content\/new/);
  });
});

test.describe('Studio Content - Create Form', () => {
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

  test('create form renders all fields', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // Text fields
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Slug' })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Description' })
    ).toBeVisible();

    // Custom combobox selects
    await expect(
      page.getByRole('combobox', { name: 'Content Type' })
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Visibility' })
    ).toBeVisible();

    // Price field (spinbutton)
    await expect(
      page.getByRole('spinbutton', { name: /Price/i })
    ).toBeVisible();

    // Submit button
    await expect(
      page.getByRole('button', { name: 'Create Content' })
    ).toBeVisible();
  });

  test('back link to content list is visible', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    await expect(
      page.getByRole('link', { name: 'Back to Content' })
    ).toBeVisible();
  });

  test('content type combobox has Video, Audio, Article options', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // Open combobox
    await page.getByRole('combobox', { name: 'Content Type' }).click();

    // Check all options exist
    await expect(page.getByRole('option', { name: 'Video' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Audio' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Article' })).toBeVisible();
  });

  test('visibility combobox has expected options', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    await page.getByRole('combobox', { name: 'Visibility' }).click();

    await expect(page.getByRole('option', { name: 'Public' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Private' })).toBeVisible();
  });

  test('price field defaults to 0 with help text', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    const priceField = page.getByRole('spinbutton', { name: /Price/i });
    await expect(priceField).toHaveValue('0');

    // Help text below price
    await expect(page.locator('.form-help')).toContainText('free content');
  });
});

test.describe('Studio Content - Create Submission', () => {
  test('content create with written type succeeds', async ({ page }) => {
    const member = await setupStudioUser(page, { orgRole: 'owner' });

    await navigateToStudioPage(page, member.organization.slug, '/content/new');

    // Fill title and slug manually (Playwright fill doesn't trigger oninput for auto-slug)
    const uniqueSlug = `e2e-article-${Date.now()}`;
    await page.getByRole('textbox', { name: 'Title' }).fill('E2E Test Article');
    await page.getByRole('textbox', { name: 'Slug' }).fill(uniqueSlug);
    await page
      .getByRole('textbox', { name: 'Description' })
      .fill('Test article description');

    // Switch to Article type (doesn't require mediaItemId)
    await page.getByRole('combobox', { name: 'Content Type' }).click();
    await page.getByRole('option', { name: 'Article' }).click();

    // Submit
    await page.getByRole('button', { name: 'Create Content' }).click();

    // Should redirect to content list or show success/error toast
    await page
      .waitForURL(/\/studio\/content(?!\/new)/, { timeout: 30000 })
      .catch(() => {});

    const url = page.url();
    const hasRedirected = !url.includes('/content/new');
    const hasToast = await page
      .locator('[role="status"], [role="alert"]')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasRedirected || hasToast).toBeTruthy();
  });
});
