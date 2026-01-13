import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Component Accessibility', () => {
  test('Button has no accessibility violations', async ({ page }) => {
    await page.goto(
      'http://localhost:6006/iframe.html?id=ui-button--primary&viewMode=story'
    );
    await page.waitForSelector('.button');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Switch has proper ARIA attributes', async ({ page }) => {
    await page.goto(
      'http://localhost:6006/iframe.html?id=ui-switch--default&viewMode=story'
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
