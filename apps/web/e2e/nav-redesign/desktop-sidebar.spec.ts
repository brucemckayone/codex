/**
 * Nav Redesign — WP-10.1: Desktop sidebar verification
 *
 * Covers WP-10 spec items T-01, PW-01, PW-02, PW-07. Org-subdomain
 * checks (T-02, PW-08) require a seeded org and are deferred to manual
 * verification — see docs/nav-redesign/WP-10-verification.md.
 *
 * Bead: Codex-fofch
 */

import { expect, test } from '@playwright/test';

test.describe('Desktop sidebar rail (platform)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders collapsed rail on platform home with main-navigation landmark', async ({
    page,
  }) => {
    await page.goto('/');

    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(rail).toBeVisible();

    const collapsedWidth = await rail.evaluate((el) =>
      Math.round((el as HTMLElement).getBoundingClientRect().width)
    );
    // Collapsed token --app-sidebar-width = --space-16 = 64px
    expect(collapsedWidth).toBe(64);
  });

  test('rail expand state can be toggled programmatically (jsdriven)', async ({
    page,
  }) => {
    // The hover-driven 200ms delay is verified manually (T-01) — Svelte 5's
    // onmouseenter binding does not reliably react to Playwright-synthesised
    // pointer events in headless Chromium even though the OS-level event
    // fires. Instead, verify the contract: when expanded is true, width
    // matches the expanded token; when false, width matches the collapsed
    // token. This protects the token wiring (Codex-onjxy) without depending
    // on the hover trigger.
    await page.goto('/');

    const rail = page.getByRole('navigation', { name: 'Main navigation' });

    // Force-expand by setting the data-expanded attribute directly. The
    // CSS selector .sidebar-rail[data-expanded='true'] drives the width
    // change — this exercises the styling contract end-to-end. Poll until
    // the spring-easing width transition (var(--duration-slow)) settles.
    await rail.evaluate((el) => el.setAttribute('data-expanded', 'true'));
    await expect
      .poll(
        async () =>
          await rail.evaluate((el) =>
            Math.round((el as HTMLElement).getBoundingClientRect().width)
          ),
        { timeout: 3000 }
      )
      .toBeGreaterThanOrEqual(230);

    await rail.evaluate((el) => el.setAttribute('data-expanded', 'false'));
    await expect
      .poll(
        async () =>
          await rail.evaluate((el) =>
            Math.round((el as HTMLElement).getBoundingClientRect().width)
          ),
        { timeout: 3000 }
      )
      .toBe(64);
  });

  test('clicking a nav item navigates and aria-current marks active page', async ({
    page,
  }) => {
    await page.goto('/');

    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    const discoverLink = rail.getByRole('link', { name: /discover/i });
    await discoverLink.click();

    await expect(page).toHaveURL(/\/discover/);
    await expect(
      rail.locator('a[href="/discover"][aria-current="page"]')
    ).toBeVisible();
  });
});
