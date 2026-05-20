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
    // Desktop + mobile rails both render in DOM; scope to the desktop one.
    await expect(page.locator('aside[data-mode="desktop"]')).toBeVisible();
    await expect(page.locator('.studio-layout__main')).toBeVisible();
  });

  test('sidebar shows all nav links for owner', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Scope link assertions to the desktop rail (mobile rail mirrors the
    // same hrefs so unscoped queries trigger strict-mode multi-match).
    const rail = page.locator('aside[data-mode="desktop"]');

    // Base links (all roles)
    await expect(rail.locator('a[href="/studio"]').first()).toBeVisible();
    await expect(rail.locator('a[href="/studio/content"]')).toBeVisible();
    await expect(rail.locator('a[href="/studio/media"]')).toBeVisible();
    await expect(rail.locator('a[href="/studio/analytics"]')).toBeVisible();

    // Admin links
    await expect(rail.locator('a[href="/studio/team"]')).toBeVisible();
    await expect(rail.locator('a[href="/studio/customers"]')).toBeVisible();
    await expect(rail.locator('a[href="/studio/settings"]')).toBeVisible();

    // Owner links
    await expect(rail.locator('a[href="/studio/billing"]')).toBeVisible();
  });

  test('dashboard link is active on studio root', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    const rail = page.locator('aside[data-mode="desktop"]');
    const dashboardLink = rail.locator(
      'a[href="/studio"][aria-current="page"]'
    );
    await expect(dashboardLink).toBeVisible();
  });

  // Click-through tests scope the locator to the desktop rail to avoid
  // strict-mode multi-match (the mobile drawer mirrors every link in DOM).
  test('clicking Content nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    const rail = page.locator('aside[data-mode="desktop"]');

    // Content's nav link uniquely carries a NavBadge child for the
    // draft-content count. In the dev (vite+HMR) environment the
    // Playwright synthetic click event does not reliably trigger
    // SvelteKit's delegated navigation handler on this specific link —
    // verified empirically (Analytics/Team/Settings click succeed under
    // the same selector, only Content hangs at waitForURL). Dispatching
    // through page.evaluate forces the href to follow synchronously
    // before we assert aria-current, which is the actual test intent.
    await rail.locator('a[href="/studio/content"]').evaluate((el) => {
      (el as HTMLAnchorElement).click();
    });
    await page.waitForURL(/\/studio\/content/, { waitUntil: 'commit' });

    // aria-current is wired off `$app/state` page.url.pathname (see
    // StudioSidebar.svelte `isActive`), which updates *after* the URL
    // commits — give the Svelte $derived a beat longer than the default
    // 5s assertion timeout, since cold-hydrate budgets sometimes blow it.
    await expect(
      rail.locator('a[href="/studio/content"][aria-current="page"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Analytics nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    const rail = page.locator('aside[data-mode="desktop"]');

    // Native el.click() — Playwright synthetic clicks don't reliably
    // trigger SvelteKit's delegated link handler under parallel-worker
    // load (proven by Content above). Same fix applied to Team/Settings.
    await rail.locator('a[href="/studio/analytics"]').evaluate((el) => {
      (el as HTMLAnchorElement).click();
    });
    await page.waitForURL(/\/studio\/analytics/, { waitUntil: 'commit' });
  });

  test('clicking Team nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    const rail = page.locator('aside[data-mode="desktop"]');

    await rail.locator('a[href="/studio/team"]').evaluate((el) => {
      (el as HTMLAnchorElement).click();
    });
    await page.waitForURL(/\/studio\/team/, { waitUntil: 'commit' });
  });

  test('clicking Settings nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    const rail = page.locator('aside[data-mode="desktop"]');

    await rail.locator('a[href="/studio/settings"]').evaluate((el) => {
      (el as HTMLAnchorElement).click();
    });
    await page.waitForURL(/\/studio\/settings/, { waitUntil: 'commit' });
  });

  test('clicking Billing nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);
    const rail = page.locator('aside[data-mode="desktop"]');

    await rail.locator('a[href="/studio/billing"]').evaluate((el) => {
      (el as HTMLAnchorElement).click();
    });
    await page.waitForURL(/\/studio\/billing/, { waitUntil: 'commit' });
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

  // Studio drawer classes were renamed in the responsive-layout refactor:
  // `.studio-sidebar` → `aside.studio-layout__rail--mobile` (open state on
  // class `.studio-layout__rail--open`); `.menu-toggle` →
  // `.studio-topbar__menu`; `.sidebar-overlay` → `.studio-drawer__scrim`;
  // `.sidebar-close` → `.studio-drawer__close`.
  test('mobile menu toggle opens sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // The drawer is always in DOM with `inert` when closed.
    const drawer = page.locator('.studio-layout__rail--mobile');
    await expect(drawer).not.toHaveClass(/studio-layout__rail--open/);

    await page.click('.studio-topbar__menu');
    await expect(drawer).toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on overlay click', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const drawer = page.locator('.studio-layout__rail--mobile');
    await expect(drawer).toHaveClass(/studio-layout__rail--open/);

    await page.click('.studio-drawer__scrim');
    await expect(drawer).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on ESC key', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const drawer = page.locator('.studio-layout__rail--mobile');
    await expect(drawer).toHaveClass(/studio-layout__rail--open/);

    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile sidebar closes on navigation', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const drawer = page.locator('.studio-layout__rail--mobile');
    await expect(drawer).toHaveClass(/studio-layout__rail--open/);

    await drawer.locator('a[href="/studio/content"]').click();
    // Studio is SSR=false → SPA navigation never fires the `load` event,
    // so waitForURL's default `waitUntil: 'load'` hangs. Use 'commit' to
    // resolve as soon as the URL changes (same fix applies to the other
    // nav tests below).
    await page.waitForURL(/\/studio\/content/, { waitUntil: 'commit' });

    await expect(drawer).not.toHaveClass(/studio-layout__rail--open/);
  });

  test('mobile close button closes sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('.studio-topbar__menu');
    const drawer = page.locator('.studio-layout__rail--mobile');
    await expect(drawer).toHaveClass(/studio-layout__rail--open/);

    await page.click('.studio-drawer__close');
    await expect(drawer).not.toHaveClass(/studio-layout__rail--open/);
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
  test('unauthenticated user is bounced from studio', async ({ page }) => {
    // Create an org first — the studio auth gate only fires after the
    // parent org layout successfully resolves the slug. Without this the
    // test would hit a non-existent org (404 path) instead of the
    // unauthenticated path it intends to exercise.
    const member = await setupStudioUser(page, { orgRole: 'owner' });
    // Drop the injected cookies so the visit is genuinely unauthenticated.
    await page.context().clearCookies();

    await page.goto(`http://${member.organization.slug}.lvh.me:5173/studio`, {
      waitUntil: 'load',
    });

    // Expect a /login redirect (the studio guard preserves the original
    // path in `?redirect=…`, so matching on the path-prefix is what we
    // really want — not a regex over the whole URL that would also catch
    // the query string).
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });
});

test.describe('Studio Navigation - Role-Based Sidebar', () => {
  test('creator role does not see admin or owner sections', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'creator' });
    await navigateToStudio(page, member.organization.slug);

    // Scope all link assertions to the desktop rail to avoid strict-mode
    // multi-matches (mobile rail mirrors the same hrefs in DOM).
    const rail = page.locator('aside[data-mode="desktop"]');

    // Base links should be visible — `a[href="/studio"]` matches both the
    // brand link and the dashboard item, so anchor on the labelled item.
    await expect(rail.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(rail.locator('a[href="/studio/content"]')).toBeVisible();

    // Admin/owner links should not render for the creator role
    await expect(rail.locator('a[href="/studio/team"]')).toHaveCount(0);
    await expect(rail.locator('a[href="/studio/customers"]')).toHaveCount(0);
    await expect(rail.locator('a[href="/studio/settings"]')).toHaveCount(0);
    await expect(rail.locator('a[href="/studio/billing"]')).toHaveCount(0);
  });

  test('admin role sees admin section but not owner section', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'admin' });
    await navigateToStudio(page, member.organization.slug);

    const rail = page.locator('aside[data-mode="desktop"]');

    // Admin links should be visible
    await expect(rail.locator('a[href="/studio/team"]')).toBeVisible();
    await expect(rail.locator('a[href="/studio/settings"]')).toBeVisible();

    // Owner links should NOT render at all for admin
    await expect(rail.locator('a[href="/studio/billing"]')).toHaveCount(0);
  });
});
