import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth';
import { expectClickNavigates } from '../helpers/spa-nav';
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

// Each /studio link appears multiple times in the DOM (topbar brand, desktop
// rail brand + nav item, mobile drawer brand + nav item). Scoping to the
// desktop rail's nav-item class (`.studio-rail__item`) picks the canonical
// sidebar link and avoids strict-mode multi-match violations.
const railLink = (href: string) =>
  `.studio-layout__rail--desktop .studio-rail__item[href="${href}"]`;

// Studio uses `ssr = false` so SvelteKit navigates via History.pushState —
// `waitForURL` would hang. Plus the rail expands on hover and shifts mid-
// click. See helpers/spa-nav.ts and apps/web/e2e/CLAUDE.md for full notes.
async function clickRailLink(page: Page, href: string, pattern: RegExp) {
  return expectClickNavigates(page, page.locator(railLink(href)), pattern);
}

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

  test('clicking Content nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await clickRailLink(page, '/studio/content', /\/studio\/content/);
    await expect(page.locator(railLink('/studio/content'))).toHaveClass(
      /active/
    );
  });

  test('clicking Analytics nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailLink(page, '/studio/analytics', /\/studio\/analytics/);
  });

  test('clicking Team nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailLink(page, '/studio/team', /\/studio\/team/);
  });

  test('clicking Settings nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailLink(page, '/studio/settings', /\/studio\/settings/);
  });

  test('clicking Billing nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailLink(page, '/studio/billing', /\/studio\/billing/);
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

    // Drawer scrim (overlay) dismisses the drawer.
    // Click at x=360 to land outside the drawer's `min(320px, 85vw)` width
    // — on a 375px viewport the drawer is ~319px so a centre-of-scrim click
    // (x=187.5) lands INSIDE the drawer, not on the scrim. The scrim's
    // z-index is `calc(var(--z-fixed) - 1)`, below the drawer, so
    // elementFromPoint at the centre returns a drawer child and the click
    // never reaches the scrim.
    await page
      .locator('.studio-drawer__scrim')
      .click({ position: { x: 360, y: 400 } });
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

  test('settings page shows the General tab (Branding moved to /studio/brand)', async ({
    page,
  }) => {
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
    // Branding is no longer a settings tab — it moved to the top-level
    // /studio/brand workspace (Codex-cijzb).
    await expect(
      page.locator('a[href="/studio/settings/branding"]')
    ).toHaveCount(0);
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

  test('clicking Brand nav link navigates to the brand workspace', async ({
    page,
  }) => {
    // Branding moved out of Settings into the top-level /studio/brand
    // workspace (Codex-cijzb); it is now a rail nav item, admin/owner only.
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    await clickRailLink(page, '/studio/brand', /\/studio\/brand/);
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
