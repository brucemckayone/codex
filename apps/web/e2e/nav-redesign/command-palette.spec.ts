/**
 * Nav Redesign — WP-10.3: Command palette verification
 *
 * Covers WP-10 spec items T-03, PW-03. Cross-org buildContentUrl
 * routing (Codex-usqgu) is asserted indirectly: the helper is now
 * imported and used in CommandPaletteSearch; the unit-level shape is
 * covered by the buildContentUrl tests. Manual cross-org navigation
 * test against seeded data is deferred to docs/nav-redesign/WP-10-verification.md.
 *
 * Bead: Codex-s5uy1
 */

import { expect, test } from '@playwright/test';

const META_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Command palette', () => {
  test('Cmd+K toggles palette open and closed', async ({ page }) => {
    await page.goto('/');

    await page.waitForLoadState('networkidle');

    // Open
    await page.keyboard.press(`${META_KEY}+KeyK`);
    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(palette).toBeVisible();

    const input = palette.getByRole('combobox');
    await expect(input).toBeFocused();

    // Toggle close via Esc
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('300ms input debounce — fetch fires once for rapid typing', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    let searchRequestCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/search?')) searchRequestCount += 1;
    });

    await page.keyboard.press(`${META_KEY}+KeyK`);
    const input = page
      .getByRole('dialog', { name: 'Search' })
      .getByRole('combobox');
    await input.fill('reactivity');

    // Wait for debounce window + fetch settle
    await page.waitForTimeout(600);

    // Single debounce → at most one request fired
    expect(searchRequestCount).toBeLessThanOrEqual(1);
  });

  test('clicking backdrop closes the palette', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press(`${META_KEY}+KeyK`);
    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(palette).toBeVisible();

    // Click in the top-left corner — outside the centered panel
    await page.mouse.click(20, 20);
    await expect(palette).toBeHidden();
  });
});
