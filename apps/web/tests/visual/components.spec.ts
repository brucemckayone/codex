import { expect, test } from '@playwright/test';

test.describe('Design System Visual Regression', () => {
  test('showcase page looks correct', async ({ page }) => {
    await page.goto('/showcase');

    // Wait for any animations to settle
    await page.waitForTimeout(1000);

    // Take a full page screenshot
    await expect(page).toHaveScreenshot('showcase-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });

  test('dark mode showcase looks correct', async ({ page }) => {
    await page.goto('/showcase');

    // Toggle dark mode if your app has a toggle,
    // or just set the cookie/localStorage if that's how it's handled.
    // Assuming local storage 'theme' = 'dark'
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    });

    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot('showcase-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});
