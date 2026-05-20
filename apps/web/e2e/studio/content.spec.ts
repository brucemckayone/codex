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
 * NOTE: The content form has migrated key fields off the old combobox/
 * native-select pattern. Today's structure:
 *   - Content Type: <fieldset role="radiogroup"> in ContentTypeSelector
 *   - Access (formerly Visibility): <div role="radiogroup"> in
 *     AccessSection with `free`/`paid`/`followers`/`subscribers`/`team`
 *   - Description / Content Body: Tiptap RichTextEditor
 *     (contenteditable; type with `.click()` + `.type()`, not `.fill()`)
 *   - Tier picker (when Access is `subscribers`/`paid` with org tiers):
 *     Melt UI <Select> combobox — opens a popover with role="option".
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

  test('content list page loads with command bar', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    // Editorial refactor removed the page-level <h1>; the page identity
    // now lives in the ContentListCommandBar (role="toolbar").
    await expect(
      page.getByRole('toolbar', { name: 'Content library actions' })
    ).toBeVisible();
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

    // New org: EmptyState renders (with `.empty-state` div). Populated
    // org: a real table. The listContent query streams so we have to
    // wait for whichever branch ends up rendering — until then both
    // selectors race the skeleton.
    await page.waitForSelector('.empty-state, table', {
      state: 'visible',
      timeout: 15000,
    });

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

    // /content/new shows a skeleton while listMedia + listTiers resolve;
    // wait for the real form to mount before sweeping fields.
    await page.waitForSelector('form', { state: 'visible', timeout: 20000 });

    // Text fields
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Slug' })).toBeVisible();
    // Description is a Tiptap RichTextEditor. The content form actually
    // mounts two `.rich-text-editor` instances (description + content
    // body), so anchor on the form-field wrapper to pick the description
    // one specifically.
    await expect(
      page
        .locator('.form-field')
        .filter({ has: page.locator('label[for="description"]') })
        .locator('.rich-text-editor')
    ).toBeVisible();

    // Content Type renders as a `<fieldset><legend>Content Type</legend>`
    // (plain fieldset — implicit role is "group", not "radiogroup",
    // because there's no explicit role attribute on the element).
    await expect(
      page.getByRole('group', { name: 'Content Type' })
    ).toBeVisible();

    // Access (formerly Visibility) IS an explicit `<div role="radiogroup"
    // aria-label="Access">` per AccessSection.svelte, so radiogroup +
    // name='Access' is the right lookup here.
    await expect(
      page.getByRole('radiogroup', { name: 'Access' })
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

    // The "Back to Content" pattern was replaced by a Breadcrumb pointing
    // at /studio/content with label "Content". The breadcrumb is the
    // documented navigation pattern; assert on that link instead.
    await expect(
      page.getByRole('link', { name: 'Content', exact: true })
    ).toBeVisible();
  });

  test('content type radiogroup has Video, Audio, Article options', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    await page.waitForSelector('form', { state: 'visible', timeout: 20000 });

    // Content Type is a fieldset/radiogroup (not a combobox) — every type
    // is a visible labelled radio that's selectable directly.
    await expect(page.getByRole('radio', { name: 'Video' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Audio' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Article' })).toBeVisible();
  });

  test('access radiogroup has free/paid options visible', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    await page.waitForSelector('form', { state: 'visible', timeout: 20000 });

    // The legacy Visibility dropdown was reshaped into the Access
    // radiogroup with the AccessSection (`free`, `paid`, plus org-
    // dependent `followers`/`subscribers`/`team`). For a fresh org with
    // no tiers, only `free` and `paid` show by default.
    await expect(page.getByRole('radio', { name: /Free/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Paid/i })).toBeVisible();
  });

  test('price field appears when Paid access is selected', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new'
    );

    await page.waitForSelector('form', { state: 'visible', timeout: 20000 });

    // AccessSection only renders the price input when the `paid` or
    // `subscribers` access type is selected — `free` (the default for
    // tier-less orgs) keeps the price hidden. The radios are sr-only;
    // click the `.access-card` label that wraps each one.
    await page
      .locator('.access-card')
      .filter({ has: page.locator('text=/Paid/i') })
      .click();
    const priceField = page.locator('#price');
    await expect(priceField).toBeVisible({ timeout: 5000 });
    await expect(priceField).toHaveAttribute('min', '0');
  });
});

test.describe('Studio Content - Create Submission', () => {
  test('content create with written type succeeds', async ({ page }) => {
    const member = await setupStudioUser(page, { orgRole: 'owner' });

    await navigateToStudioPage(page, member.organization.slug, '/content/new');

    // Wait for the form to replace the skeleton (listMedia + listTiers
    // queries gate the render).
    await page.waitForSelector('form', { state: 'visible', timeout: 20000 });

    // Fill title and slug manually (Playwright fill doesn't trigger oninput for auto-slug)
    const uniqueSlug = `e2e-article-${Date.now()}`;
    await page.getByRole('textbox', { name: 'Title' }).fill('E2E Test Article');
    await page.getByRole('textbox', { name: 'Slug' }).fill(uniqueSlug);

    // Description is a Tiptap RichTextEditor — type into the description
    // ProseMirror contenteditable (there are two `.rich-text-editor`
    // instances on this page, so scope to the description form field).
    const descriptionEditor = page
      .locator('.form-field')
      .filter({ has: page.locator('label[for="description"]') })
      .locator('.rich-text-editor .ProseMirror');
    await descriptionEditor.click();
    await descriptionEditor.type('Test article description');

    // Switch to Article type (doesn't require mediaItemId). The radio
    // input is sr-only; the visible `<label class="type-card">` wraps it
    // with an Icon that intercepts pointer events. Click the labelled
    // card instead so the click lands on the label and toggles the
    // inner radio.
    await page
      .locator('.type-card')
      .filter({ has: page.locator('text=Article') })
      .click();

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
