import { expect, type Page, test } from '@playwright/test';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
} from '../helpers/studio';

/**
 * Brand studio: Hero › Effects › Combine and Hero › Composition › Showreel
 * (Codex-1yd58 WP-9) save, and a reload reads them back from the server.
 *
 * The org is this suite's own (registerSharedStudioUser makes a fresh,
 * uniquely-slugged org and owner), never a seeded or real one. The session's
 * draft store is cleared before the reload, so what comes back can only be
 * what the save wrote.
 */

test.describe('Brand studio: the stack and the Showreel save', () => {
  test.describe.configure({ mode: 'serial' });

  let auth: SharedStudioAuth;

  test.beforeAll(async () => {
    auth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(auth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, auth);
  });

  /** The brand workspace, in Advanced mode, with `control` open. */
  async function openControl(page: Page, control: string): Promise<void> {
    await navigateToStudioPage(page, auth.member.organization.slug, '/brand');
    // An unbranded org opens in Guided; the rail's controls are Advanced.
    await page
      .getByRole('group', { name: 'Editor mode' })
      .getByRole('button', { name: 'Advanced' })
      .click();
    await page.locator(`[data-rail-control="${control}"]`).click();
  }

  const saveButton = (page: Page) =>
    page.getByRole('button', { name: 'Save Changes' });

  /** Save, then reload with no draft to restore. */
  async function saveAndReload(page: Page, control: string): Promise<void> {
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();
    // markSaved: nothing left to save once the write lands.
    await expect(saveButton(page)).toBeDisabled({ timeout: 15_000 });
    await page.evaluate(() => sessionStorage.clear());
    await openControl(page, control);
    // Nothing was restored from a draft: the editor opened clean.
    await expect(saveButton(page)).toBeDisabled();
  }

  test('a frame and a layer save and come back after a reload', async ({
    page,
  }) => {
    await openControl(page, 'hero-effects');
    await page
      .locator('.hero-fx__preset-card')
      .filter({
        has: page.locator('.hero-fx__preset-label', { hasText: /^Flow$/ }),
      })
      .click();

    const combine = page.locator('.combine');
    await expect(combine).toBeVisible();

    const nameGlows = combine
      .getByRole('radiogroup', { name: 'Frame' })
      .getByRole('radio', { name: 'Name glows' });
    await nameGlows.click();
    await expect(nameGlows).toHaveAttribute('aria-checked', 'true');

    await combine.locator('.combine__add').click();
    await page.getByRole('menuitem', { name: /Film grain/ }).click();
    await expect(combine.locator('.combine__layer-name')).toHaveText([
      'Film grain',
    ]);

    await saveAndReload(page, 'hero-effects');

    const after = page.locator('.combine');
    await expect(
      after
        .getByRole('radiogroup', { name: 'Frame' })
        .getByRole('radio', { name: 'Name glows' })
    ).toHaveAttribute('aria-checked', 'true');
    await expect(after.locator('.combine__layer-name')).toHaveText([
      'Film grain',
    ]);
  });

  test('a Showreel option saves and comes back after a reload', async ({
    page,
  }) => {
    await openControl(page, 'hero-designer');
    await page.getByRole('button', { name: 'Try the new hero' }).click();

    const field = (key: string) =>
      page.locator(`.hero-designer__field[data-key="${key}"]`);
    await field('comp').getByRole('radio', { name: 'Showreel' }).click();
    await expect(page.locator('section[data-group="showreel"]')).toBeVisible();

    const wide = field('reel-layout').getByRole('radio', {
      name: 'Wide title',
    });
    await wide.click();
    await expect(wide).toHaveAttribute('aria-checked', 'true');

    await saveAndReload(page, 'hero-designer');

    await expect(
      field('comp').getByRole('radio', { name: 'Showreel' })
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      field('reel-layout').getByRole('radio', { name: 'Wide title' })
    ).toHaveAttribute('aria-checked', 'true');
  });
});
