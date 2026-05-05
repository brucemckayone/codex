/**
 * Nav Redesign — WP-10.2: Mobile verification
 *
 * Covers WP-10 spec items T-04, T-05, PW-04, PW-05, PW-06.
 *
 * Bead: Codex-pf1ob
 */

import { expect, test } from '@playwright/test';

test.describe('Mobile bottom nav (platform)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('hides desktop sidebar and shows bottom nav landmark <768px', async ({
    page,
  }) => {
    await page.goto('/');

    const desktopRail = page.getByRole('navigation', {
      name: 'Main navigation',
    });
    await expect(desktopRail).toBeHidden();

    const mobileNav = page.getByRole('navigation', {
      name: /mobile navigation/i,
    });
    await expect(mobileNav).toBeVisible();
  });

  test('search button on bottom nav opens command palette', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const mobileNav = page.getByRole('navigation', {
      name: 'Mobile navigation',
    });
    const searchBtn = mobileNav.getByRole('button', { name: 'Search' });
    await searchBtn.click();

    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(palette).toBeVisible();
  });

  test('More button opens bottom sheet, backdrop click closes it', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const mobileNav = page.getByRole('navigation', {
      name: 'Mobile navigation',
    });
    const moreBtn = mobileNav.getByRole('button', { name: 'More' });
    await moreBtn.click();

    const sheet = page.getByRole('dialog', { name: 'More options' });
    await expect(sheet).toBeVisible();

    // Click backdrop area at top of viewport (above the sheet)
    await page.mouse.click(180, 60);
    await expect(sheet).toBeHidden();
  });
});

test.describe('Sidebar rail breakpoint threshold', () => {
  test('rail hidden at 767px, visible at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(rail).toBeHidden();

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(rail).toBeVisible();
  });
});
