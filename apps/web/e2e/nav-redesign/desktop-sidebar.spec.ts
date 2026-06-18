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

  test('rail expands on hover and collapses on mouse-leave', async ({
    page,
  }) => {
    // Drive the REAL component state via trusted CDP pointer movements.
    // SidebarRail.svelte owns `data-expanded` through a Svelte 5 $state
    // rune (flipped by onmouseenter → 200ms timer → expanded=true), so we
    // must NOT setAttribute on the bound node — under the production build
    // Svelte reconciles the attribute back to its $state value and the
    // .sidebar-rail[data-expanded='true'] width rule never sticks (it
    // measures the collapsed 64px). Real `page.mouse.move` events fire the
    // genuine onmouseenter/onmouseleave handlers, exercising the
    // expand→width token contract (Codex-onjxy) end-to-end.
    await page.goto('/');

    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(rail).toBeVisible();

    const railWidth = async () =>
      await rail.evaluate((el) =>
        Math.round((el as HTMLElement).getBoundingClientRect().width)
      );

    // Explicit off-rail → onto-rail moves (NOT `locator.hover()`) drive the
    // real onmouseenter. Two reasons hover() / a single move are unreliable:
    //   1. Playwright's default cursor is (0,0), which already sits inside
    //      the collapsed rail's box (the rail is fixed at x:0, width 64,
    //      full height). Moving deeper into an element the cursor is already
    //      inside fires no `mouseenter`, so the 200ms expand timer never
    //      starts and the width stays 64. Parking off-rail first guarantees
    //      the enter is genuine.
    //   2. Under load the page may not have finished hydrating when the
    //      first enter fires, so the Svelte handler isn't attached yet. We
    //      therefore RETRY the whole off→on enter, waiting past the 200ms
    //      expand timer + width transition between attempts. Crucially we do
    //      NOT poll-retry faster than the timer — re-entering before it fires
    //      cancels it (onmouseleave clears the pending timeout), which would
    //      wedge the rail collapsed forever.
    await page.mouse.move(1300, 450); // park clear of the rail
    expect(await railWidth()).toBe(64);

    let expandedWidth = 64;
    for (let attempt = 0; attempt < 8 && expandedWidth < 230; attempt++) {
      await page.mouse.move(1300, 450); // ensure a clean mouseleave…
      await page.mouse.move(32, 450); // …then a genuine mouseenter (x=32 ∈ 0..64)
      // Wait longer than the 200ms expand delay + transition before checking.
      await page.waitForTimeout(350);
      expandedWidth = await railWidth();
    }
    // expanded=true → width animates to --app-sidebar-width-expanded
    // (15rem = 240px). The collapsed token is 64px, so >=230 proves expansion.
    expect(expandedWidth).toBeGreaterThanOrEqual(230);

    // Move the pointer well clear of the rail → onmouseleave → expanded=false
    // → width returns to the collapsed token (--app-sidebar-width = 64px).
    await page.mouse.move(1300, 450);
    await expect.poll(railWidth, { timeout: 3000 }).toBe(64);
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
