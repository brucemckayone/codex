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
 * Tests the general settings form. Owner role required for settings access.
 *
 * NOTE: there is NO settings tab strip any more. It listed exactly one
 * destination ("General") once branding moved to the unified /studio/brand
 * workspace (Codex-cijzb), which made it a tablist you could neither leave nor
 * act on — and whose active state painted raw org brand ink as 14px text
 * (3.82:1 on studio-alpha dark, an AA failure). The two tests that asserted
 * `getByRole('tab')).toHaveCount(1)` and its `aria-selected` were removed with
 * it; the replacement below asserts the *absence* of a tablist, so a one-item
 * strip cannot creep back in. `/studio/settings/branding` remains a 301 stub
 * whose only job is to forward old bookmarks. The brand workspace itself is
 * covered by studio/navigation.spec.ts and brand-editor-hero-effects.spec.ts —
 * do not re-test its contents here.
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

    // Timezone is now a Melt UI Select (custom combobox). The trigger is a
    // <button role="combobox">, the menu is portalled to <body> and its
    // options have role="option". Click the trigger to open the menu, then
    // count rendered options.
    const timezone = page.getByRole('combobox', { name: 'Timezone' });
    await expect(timezone).toBeVisible();
    await timezone.click();

    const options = page.getByRole('option');
    // Wait until the menu is rendered with at least one option.
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
    // Bypass Playwright's actionability checks via direct DOM click. The
    // studio rail is position:absolute and expands on hover; any cursor
    // movement (including Playwright's hover OR scroll-into-view) triggers
    // the rail to expand and intercept pointer events on the form column.
    // The Save button's onclick is form submission — no cursor state is
    // needed for the click to dispatch correctly.
    const saveBtn = page.getByRole('button', { name: 'Save Changes' });
    await saveBtn.evaluate((el: HTMLElement) => el.click());

    // Wait for success feedback (role="status") or form to re-enable
    const success = page.locator('[role="status"]');
    await expect(success).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Studio Settings - no tab strip', () => {
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

  test('settings has no tablist and exactly one h1', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    // Wait for the masthead the layout owns before asserting absence, so this
    // cannot pass against an unrendered page.
    await expect(page.locator('h1')).toContainText(/Settings/i);

    // Replaces the old `toHaveCount(1)` tab assertion. A one-item tablist is a
    // navigation with nowhere to go; assert the strip is gone rather than that
    // it has one entry, so re-adding a single tab fails here.
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);

    // The layout owns the page's single <h1>; card headings are <h2>.
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('Studio Settings - legacy branding redirect', () => {
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

  test('/studio/settings/branding forwards to the brand workspace', async ({
    page,
  }) => {
    // `settings/branding/+page.ts` is a redirect(301, '/studio/brand') stub
    // kept solely so old bookmarks and inbound links keep working. It runs
    // under the studio subtree's `ssr = false`, so the redirect fires on the
    // CLIENT during navigation — which is why this asserts the settled URL
    // rather than the response status.
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings/branding'
    );

    // toHaveURL polls, so it tolerates the client-side hop. Per e2e/CLAUDE.md,
    // never waitForURL on an ssr=false route — there is no second load event.
    await expect(page).toHaveURL(/\/studio\/brand$/);
  });
});
