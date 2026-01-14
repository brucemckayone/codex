import { expect, test } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('Button variants', async ({ page }) => {
    // Visit storybook iframe for button
    await page.goto(
      'http://localhost:6006/iframe.html?id=ui-button--all-sizes&viewMode=story'
    );
    // Wait for button to be visible
    await page.waitForSelector('.button');
    // Take screenshot
    await expect(page).toHaveScreenshot('button-sizes.png');
  });

  test('Switch states', async ({ page }) => {
    await page.goto(
      'http://localhost:6006/iframe.html?id=ui-switch--default&viewMode=story'
    );
    await page.waitForSelector('.switch');
    await expect(page).toHaveScreenshot('switch-default.png');

    await page.click('.switch');
    await expect(page).toHaveScreenshot('switch-checked.png');
  });
});
