import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudio,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
  setupStudioUser,
} from '../helpers/studio';

/**
 * Studio Navigation E2E Tests
 *
 * Tests sidebar navigation, mobile drawer behavior, and settings tabs.
 * Owner role is used for full nav access (sees all sections).
 */

test.describe('Studio Navigation - Sidebar', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('studio layout loads with sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await expect(page.locator('.studio-layout')).toBeVisible();
    // Desktop rail is the visible aside. (Mobile aside exists in DOM but
    // is hidden via `inert` and CSS until the drawer is opened.) The
    // class is unique to the desktop rail — no aria-label needed to
    // disambiguate (and the actual aria-label lives on the inner <nav>
    // inside StudioSidebar, not on the <aside>).
    await expect(
      page.locator('aside.studio-layout__rail--desktop')
    ).toBeVisible();
    await expect(page.locator('.studio-layout__main')).toBeVisible();
  });

  // Each /studio link appears multiple times in the DOM (topbar brand, desktop
  // rail brand + nav item, mobile drawer brand + nav item). Scoping to the
  // desktop rail's nav-item class (`.studio-rail__item`) picks the canonical
  // sidebar link and avoids strict-mode multi-match violations.
  const railLink = (href: string) =>
    `.studio-layout__rail--desktop .studio-rail__item[href="${href}"]`;

  test('sidebar shows all nav links for owner', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Base links (all roles)
    await expect(page.locator(railLink('/studio'))).toBeVisible();
    await expect(page.locator(railLink('/studio/content'))).toBeVisible();
    await expect(page.locator(railLink('/studio/media'))).toBeVisible();
    await expect(page.locator(railLink('/studio/analytics'))).toBeVisible();

    // Admin links
    await expect(page.locator(railLink('/studio/team'))).toBeVisible();
    await expect(page.locator(railLink('/studio/customers'))).toBeVisible();
    await expect(page.locator(railLink('/studio/settings'))).toBeVisible();

    // Owner links
    await expect(page.locator(railLink('/studio/billing'))).toBeVisible();
  });

  test('dashboard link is active on studio root', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    const dashboardLink = page.locator(railLink('/studio'));
    await expect(dashboardLink).toHaveClass(/active/);
  });

  // Studio uses `ssr = false` (client-rendered SPA); SvelteKit navigates via
  // the History API without firing a real `load` event. `waitForURL`'s
  // default `waitUntil: 'load'` therefore hangs forever — use `toHaveURL`
  // polling instead.
  //
  // `force: true` bypasses Playwright's stability re-check, which fails when
  // the desktop rail expands on hover during the actionability check: the
  // link shifts mid-action and the click misses.
  // Hover the rail to expand it (desktop rail collapses by default). Then
  // trigger a native click via `evaluate(el => el.click())` — Playwright's
  // synthetic click event doesn't bubble in a way that SvelteKit's
  // client router picks up (the router listens on `document` for native
  // anchor clicks via a delegated listener). Then poll the URL with
  // `toHaveURL` — `waitForURL` with `waitUntil:'commit'` ALSO doesn't
  // fire reliably here because the navigation is a History.pushState
  // call, not a real document load. URL polling is the only path that
  // works for studio's `ssr=false` SPA navigation.
  async function clickRailAndExpect(
    page: import('@playwright/test').Page,
    href: string,
    pattern: RegExp
  ) {
    const link = page.locator(railLink(href));
    await link.hover();
    await link.evaluate((el: HTMLElement) => el.click());
    await expect(page).toHaveURL(pattern, { timeout: 10_000 });
  }

  test('clicking Content nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await clickRailAndExpect(page, '/studio/content', /\/studio\/content/);
    await expect(page.locator(railLink('/studio/content'))).toHaveClass(
      /active/
    );
  });

  test('clicking Analytics nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailAndExpect(page, '/studio/analytics', /\/studio\/analytics/);
  });

  test('clicking Team nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailAndExpect(page, '/studio/team', /\/studio\/team/);
  });

  test('clicking Settings nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailAndExpect(page, '/studio/settings', /\/studio\/settings/);
  });

  test('clicking Billing nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailAndExpect(page, '/studio/billing', /\/studio\/billing/);
  });
});

test.describe('Studio Navigation - Mobile Drawer', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('mobile menu toggle opens sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Mobile rail should not have the --open modifier initially
    const sidebar = page.locator('.studio-layout__rail--mobile');
    await expect(sidebar).not.toHaveClass(/studio-layout__rail--open/);

    // Click hamburger menu (topbar trigger)
    await page.click('.studio-topbar__menu');

    // Mobile rail should now be open
    await expect(sidebar).toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on overlay click', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const sidebar = page.locator('.studio-layout__rail--mobile');
    await expect(sidebar).toHaveClass(/studio-layout__rail--open/);

    // Drawer scrim (overlay) dismisses the drawer
    await page.click('.studio-drawer__scrim');
    await expect(sidebar).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on ESC key', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const sidebar = page.locator('.studio-layout__rail--mobile');
    await expect(sidebar).toHaveClass(/studio-layout__rail--open/);

    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on navigation', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const sidebar = page.locator('.studio-layout__rail--mobile');
    await expect(sidebar).toHaveClass(/studio-layout__rail--open/);

    // Click a nav link in the mobile drawer (scope to mobile rail)
    await sidebar.locator('a[href="/studio/content"]').click();
    await page.waitForURL(/\/studio\/content/);

    await expect(sidebar).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile close button closes sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const sidebar = page.locator('.studio-layout__rail--mobile');
    await expect(sidebar).toHaveClass(/studio-layout__rail--open/);

    await page.click('.studio-drawer__close');
    await expect(sidebar).not.toHaveClass(/studio-layout__rail--open/);
  });
});

test.describe('Studio Navigation - Settings Tabs', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('settings page shows General and Branding tabs', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await expect(
      page.locator('a[href="/studio/settings"]', {
        hasText: /General/i,
      })
    ).toBeVisible();
    await expect(
      page.locator('a[href="/studio/settings/branding"]')
    ).toBeVisible();
  });

  test('General tab is active on settings root', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    const generalTab = page
      .locator('.tab-trigger')
      .filter({ hasText: /General/i });
    await expect(generalTab).toHaveClass(/active/);
  });

  test('clicking Branding tab navigates to branding page', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/settings'
    );

    await page.click('a[href="/studio/settings/branding"]');
    await page.waitForURL(/\/studio\/settings\/branding/);

    const brandingTab = page.locator('.tab-trigger').filter({
      hasText: /Branding/i,
    });
    await expect(brandingTab).toHaveClass(/active/);
  });
});

test.describe('Studio Navigation - Unauthenticated', () => {
  test('unauthenticated user is redirected from studio', async ({ page }) => {
    // Need a REAL org slug so the parent layout resolves (otherwise the
    // org-not-found path serves an error page at the same URL and the
    // auth-gate redirect never fires). Create one, then strip the session
    // cookies so the request is unauthenticated.
    const member = await registerSharedStudioUser({ orgRole: 'owner' });
    await page.context().clearCookies();

    await page.goto(
      `http://${member.member.organization.slug}.lvh.me:5173/studio`,
      { waitUntil: 'load' }
    );

    // Studio +layout.server.ts redirects unauthenticated users to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    await cleanupSharedStudioAuth(member);
  });
});

test.describe('Studio Navigation - Role-Based Sidebar', () => {
  // Same desktop-rail-scoped selector as the Sidebar describe above — the
  // bare `a[href="..."]` would match topbar brand + drawer copies and trip
  // Playwright's strict-mode multi-match guard.
  const railLink = (href: string) =>
    `.studio-layout__rail--desktop .studio-rail__item[href="${href}"]`;

  test('creator role does not see admin or owner sections', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'creator' });
    await navigateToStudio(page, member.organization.slug);

    // Base links should be visible
    await expect(page.locator(railLink('/studio'))).toBeVisible();
    await expect(page.locator(railLink('/studio/content'))).toBeVisible();

    // Admin links should NOT be visible
    await expect(page.locator(railLink('/studio/team'))).toHaveCount(0);
    await expect(page.locator(railLink('/studio/customers'))).toHaveCount(0);
    await expect(page.locator(railLink('/studio/settings'))).toHaveCount(0);

    // Owner links should NOT be visible
    await expect(page.locator(railLink('/studio/billing'))).toHaveCount(0);
  });

  test('admin role sees admin section but not owner section', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'admin' });
    await navigateToStudio(page, member.organization.slug);

    // Admin links should be visible
    await expect(page.locator(railLink('/studio/team'))).toBeVisible();
    await expect(page.locator(railLink('/studio/settings'))).toBeVisible();

    // Owner links should NOT be visible
    await expect(page.locator(railLink('/studio/billing'))).toHaveCount(0);
  });
});
