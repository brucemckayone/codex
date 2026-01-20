import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STORYBOOK_URL = 'http://localhost:6006';

test.describe('Component Accessibility', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const response = await request.get(STORYBOOK_URL, { timeout: 5000 });
      if (!response.ok()) {
        test.skip(
          true,
          `Storybook not available at ${STORYBOOK_URL}. Run 'pnpm storybook' first.`
        );
      }
    } catch {
      test.skip(
        true,
        `Storybook not running at ${STORYBOOK_URL}. Run 'pnpm storybook' first.`
      );
    }
  });

  test('Button has no accessibility violations', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-button--primary&viewMode=story`
    );
    await page.waitForSelector('.button');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Switch has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      `${STORYBOOK_URL}/iframe.html?id=ui-switch--default&viewMode=story`
    );
    await page.waitForSelector('.switch');

    const switchEl = page.locator('.switch');
    await expect(switchEl).toHaveAttribute('role', 'switch');
    await expect(switchEl).toHaveAttribute('aria-checked', 'false');

    await switchEl.click();
    await expect(switchEl).toHaveAttribute('aria-checked', 'true');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
