/**
 * The page editor at tablet widths (Codex-61zsk.11). The owner, 2026-10-19:
 * "Tablet is fine for now yes why not as long as it's done correctly" — so
 * below the width the inspector docks at, the editor is held to work, not to
 * ask for a bigger screen. At 1024 x 768 (landscape) and 820 x 1180
 * (portrait), touch on, on a seeded page:
 *
 *   - the editor never scrolls sideways, and every control of its top bar
 *     and tab row is on screen
 *   - each tab opens its own panel
 *   - a section clicked is inspected (contract §7), so with no room to dock
 *     the inspector opens as a drawer, and its toggle shuts it (a tablet
 *     has no Esc key; and a click on a section's padding puts Chrome's caret
 *     in its nearest words, where Esc is the field's own); a click into the words
 *     edits them in place and leaves it shut (it would cover the line)
 *   - the Tablet frame keeps its true width where the canvas is narrower
 *     (contract §7: nothing is scaled), so the canvas scrolls sideways and
 *     the selected section's toolbar can be reached at its far edge
 *
 * Nothing is typed, so nothing is saved: the seeded page stays as it is for
 * every other spec.
 */
import { expect, type Page, test } from '@playwright/test';
import { orgUrl } from '../helpers/journeys';
import { captureSeededCreatorCookies } from '../helpers/subscription';

const ORG = 'studio-alpha';
const SLUG = 'bone-deep';
const TABS = ['Page', 'Style', 'Offer', 'Settings'];

let cookies: Awaited<ReturnType<typeof captureSeededCreatorCookies>>;
test.beforeAll(async () => {
  cookies = await captureSeededCreatorCookies();
});

/** Controls in the top bar and the tab row that are not wholly on screen. */
function offScreen(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.topbar button, .topbar a[href], .shell [role="tab"]'
      ),
    ]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -0.5 || r.right > innerWidth + 0.5;
      })
      .map((el) =>
        (el.getAttribute('aria-label') || el.textContent || '').trim()
      )
  );
}

for (const [width, height] of [
  [1024, 768],
  [820, 1180],
])
  test(`the editor works at ${width} x ${height}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    try {
      // The editor's own id, from the portal's row (the public slug is not it).
      await page.goto(orgUrl(baseURL as string, ORG, '/studio/journeys'));
      const href = await page
        .locator('li.journey-row')
        .filter({ has: page.locator(`a[href="/journeys/${SLUG}?preview=1"]`) })
        .getByRole('link', { name: 'Edit page' })
        .getAttribute('href', { timeout: 60_000 });
      expect(href, `no Edit page link for ${SLUG}`).toMatch(
        /^\/studio\/journeys\/[^/]+\/page$/
      );
      await page.goto(orgUrl(baseURL as string, ORG, href as string));
      const sections = page.locator('.canvas__page .lp .lp-section');
      await expect(sections.first()).toBeVisible({ timeout: 90_000 });

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        ),
        'the editor scrolls sideways'
      ).toBeLessThanOrEqual(0);
      expect(await offScreen(page), 'controls past the screen').toEqual([]);

      // The pointer starts at (0, 0), over the studio's desktop rail, whose
      // flyout opens on hover and covers the tab row (CI, PR #616): rest it
      // on the canvas, as a hand would, before reaching for anything.
      await page.mouse.move(width * 0.7, height / 2);

      for (const name of TABS) {
        const tab = page.getByRole('tab', { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel')).toBeVisible();
        expect(
          await offScreen(page),
          `${name}: controls past the screen`
        ).toEqual([]);
      }
      await page.getByRole('tab', { name: 'Page', exact: true }).click();

      // No room to dock, so a section picked on the canvas opens the drawer.
      const shell = page.locator('.shell');
      await expect(shell).toHaveAttribute('data-inspector', 'drawer');
      const inspector = page.getByRole('complementary', { name: 'Inspector' });
      await expect(inspector).toBeHidden();
      await sections.nth(1).scrollIntoViewIfNeeded();
      await sections.nth(1).click({ position: { x: 12, y: 12 } });
      await expect(inspector).toBeVisible();
      await expect(
        inspector.getByText('Layout', { exact: true })
      ).toBeVisible();
      const drawer = await inspector.boundingBox();
      expect(
        drawer && drawer.x + drawer.width,
        'the drawer runs past the screen'
      ).toBeLessThanOrEqual(width + 0.5);
      await page.getByRole('button', { name: 'Hide inspector' }).click();
      await expect(inspector).toBeHidden();

      // A click into the words edits them in place: the drawer stays shut.
      const heading = sections.first().locator('[data-field="heading"]');
      await heading.scrollIntoViewIfNeeded();
      await heading.click();
      await expect(heading).toBeFocused();
      await expect(inspector).toBeHidden();

      // The Tablet frame is wider than this canvas: the canvas scrolls to it.
      await page
        .getByRole('group', { name: 'Device' })
        .getByRole('button', { name: 'Tablet', exact: true })
        .click();
      const scroller = page.locator('.canvas__scroller');
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth))
        .toBeGreaterThan(0);
      await scroller.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      const shown = await scroller.boundingBox();
      const last = page.locator('.canvas__track button').last();
      await expect(last).toBeVisible();
      const reach = await last.boundingBox();
      expect(
        shown &&
          reach &&
          reach.x >= shown.x - 0.5 &&
          reach.x + reach.width <= shown.x + shown.width + 0.5,
        'the toolbar cannot be reached'
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
