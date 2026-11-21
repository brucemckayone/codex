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
 * Hero › Effects' presets and sliders keep the brand's overrides minimal on
 * the rail: a slider back at its default leaves nothing to save (Gotcha #2),
 * and "None" clears every shader key, so the preset comes back at its
 * defaults (Gotcha #1). Those two were the retired `?brandEditor` overlay's
 * spec (brand-editor-hero-effects.spec.ts, quarantined, deleted in WP-11);
 * the helpers themselves are unit-tested in hero-fx-helpers.test.ts.
 *
 * The org is this suite's own (registerSharedStudioUser makes a fresh,
 * uniquely-slugged org and owner), never a seeded or real one. The session's
 * draft store is cleared before the reload, so what comes back can only be
 * what the save wrote.
 */

/** Two of Flow's own sliders and their defaults (`HERO_FX_DEFAULTS`). */
const CURL = 'Curl Strength';
const CURL_DEFAULT = 0.6;
const ADVECTION = 'Advection';
const ADVECTION_DEFAULT = 6;

const presetCard = (page: Page, label: string) =>
  page.locator('.hero-fx__preset-card').filter({
    has: page.locator('.hero-fx__preset-label', {
      hasText: new RegExp(`^${label}$`),
    }),
  });

/** A slider by its label (the label also shows the value: "Curl Strength 0.60"). */
const slider = (page: Page, label: string) =>
  page.getByRole('slider', { name: new RegExp(`^${label}\\b`) });

/** Move a range input as a drag does: its value, then input and change. */
async function setSlider(page: Page, label: string, value: number) {
  await slider(page, label).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

const sliderValue = async (page: Page, label: string) =>
  Number(await slider(page, label).inputValue());

test.describe('Brand studio: hero effects, the stack and the Showreel save', () => {
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
    await presetCard(page, 'Flow').click();

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

    // The card wrote `shader-preset`: Flow's own controls are back with it.
    await expect(slider(page, CURL)).toBeVisible();
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

  test('a slider moved back to its default leaves nothing to save (Gotcha #2)', async ({
    page,
  }) => {
    await openControl(page, 'hero-effects');
    // Flow from the first test, saved: the editor opens clean on it.
    await presetCard(page, 'Flow').click();
    await expect(saveButton(page)).toBeDisabled();
    expect(await sliderValue(page, CURL)).toBeCloseTo(CURL_DEFAULT);

    await setSlider(page, CURL, 1);
    await expect(saveButton(page)).toBeEnabled();
    // Back at the default, the override is removed, not stored as the default.
    await setSlider(page, CURL, CURL_DEFAULT);
    await expect(saveButton(page)).toBeDisabled();
  });

  test('"None" clears every shader key, so the preset comes back at its defaults (Gotcha #1)', async ({
    page,
  }) => {
    await openControl(page, 'hero-effects');
    await presetCard(page, 'Flow').click();
    await setSlider(page, CURL, 1);
    await setSlider(page, ADVECTION, 10);
    await saveAndReload(page, 'hero-effects');
    expect(await sliderValue(page, CURL)).toBeCloseTo(1);
    expect(await sliderValue(page, ADVECTION)).toBeCloseTo(10);

    await presetCard(page, 'None').click();
    await expect(slider(page, CURL)).toHaveCount(0);
    await saveAndReload(page, 'hero-effects');

    // Choosing a preset writes the preset alone: had "None" left Flow's keys,
    // its sliders would come back where they were saved.
    await presetCard(page, 'Flow').click();
    expect(await sliderValue(page, CURL)).toBeCloseTo(CURL_DEFAULT);
    expect(await sliderValue(page, ADVECTION)).toBeCloseTo(ADVECTION_DEFAULT);
  });
});
