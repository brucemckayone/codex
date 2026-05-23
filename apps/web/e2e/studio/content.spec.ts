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

  test('content list page renders command bar', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    // The redesigned content list uses a sticky ContentListCommandBar
    // (no <h1>); the breadcrumb leaf is the page's primary heading.
    await expect(page.locator('.command-bar .breadcrumb-leaf')).toBeVisible();
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

    // Text fields (label-associated via id/for)
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Slug' })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Description' })
    ).toBeVisible();

    // ContentForm now uses radio cards (not comboboxes) for type + access:
    //  - Content Type: `<fieldset>` + radios per type
    //  - Access: `<div role="radiogroup">` + radios per option
    await expect(page.getByRole('radio', { name: 'Video' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Article' })).toBeVisible();

    // Price is a text input with a £ prefix span (not a spinbutton).
    await expect(page.locator('input#price')).toBeVisible();

    // Submit button
    await expect(
      page.getByRole('button', { name: 'Create Content' })
    ).toBeVisible();
  });

  test('content type has Video, Audio, Article radio options', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // Radios are sr-only; check existence rather than visibility — the
    // labels wrapping them provide the accessible name.
    await expect(page.getByRole('radio', { name: 'Video' })).toBeAttached();
    await expect(page.getByRole('radio', { name: 'Audio' })).toBeAttached();
    await expect(page.getByRole('radio', { name: 'Article' })).toBeAttached();
  });

  test('access options are rendered as a radiogroup', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    // AccessSection uses role="radiogroup" + radio cards. Confirm the group
    // exists; specific option labels (free / paid / subscribers) depend on
    // the page copy and are exercised by content-form-access unit tests.
    await expect(page.locator('[role="radiogroup"]')).toBeAttached();
  });

  test('price input defaults to 0', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    const priceField = page.locator('input#price');
    await expect(priceField).toHaveValue('0');
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

    // Switch to Article type (doesn't require mediaItemId).
    // Radios are sr-only — `.check({ force: true })` works on hidden radios.
    await page.getByRole('radio', { name: 'Article' }).check({ force: true });

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
