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
    await expect(
      page.locator('aside[aria-label="Studio navigation"]')
    ).toBeVisible();
    await expect(page.locator('.studio-main')).toBeVisible();
  });

  test('sidebar shows all nav links for owner', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Base links (all roles)
    await expect(page.locator('a[href="/studio"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/content"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/media"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/analytics"]')).toBeVisible();

    // Admin links
    await expect(page.locator('a[href="/studio/team"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/customers"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/settings"]')).toBeVisible();

    // Owner links
    await expect(page.locator('a[href="/studio/billing"]')).toBeVisible();
  });

  test('dashboard link is active on studio root', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    const dashboardLink = page.locator('a[href="/studio"]');
    await expect(dashboardLink).toHaveClass(/active/);
  });

  test('clicking Content nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('a[href="/studio/content"]');
    await page.waitForURL(/\/studio\/content/);

    const contentLink = page.locator('a[href="/studio/content"]');
    await expect(contentLink).toHaveClass(/active/);
  });

  test('clicking Analytics nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('a[href="/studio/analytics"]');
    await page.waitForURL(/\/studio\/analytics/);
  });

  test('clicking Team nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('a[href="/studio/team"]');
    await page.waitForURL(/\/studio\/team/);
  });

  test('clicking Settings nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('a[href="/studio/settings"]');
    await page.waitForURL(/\/studio\/settings/);
  });

  test('clicking Billing nav link navigates correctly', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    await page.click('a[href="/studio/billing"]');
    await page.waitForURL(/\/studio\/billing/);
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

    // Sidebar should not have .open class initially
    const sidebar = page.locator('.studio-sidebar');
    await expect(sidebar).not.toHaveClass(/open/);

    // Click hamburger menu
    await page.click('.menu-toggle');

    // Sidebar should now be open
    await expect(sidebar).toHaveClass(/open/);
  });

  test('mobile sidebar closes on overlay click', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Open sidebar
    await page.click('.menu-toggle');
    const sidebar = page.locator('.studio-sidebar');
    await expect(sidebar).toHaveClass(/open/);

    // Click overlay
    await page.click('.sidebar-overlay');
    await expect(sidebar).not.toHaveClass(/open/);
  });

  test('mobile sidebar closes on ESC key', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Open sidebar
    await page.click('.menu-toggle');
    const sidebar = page.locator('.studio-sidebar');
    await expect(sidebar).toHaveClass(/open/);

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/open/);
  });

  test('mobile sidebar closes on navigation', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Open sidebar
    await page.click('.menu-toggle');
    const sidebar = page.locator('.studio-sidebar');
    await expect(sidebar).toHaveClass(/open/);

    // Click a nav link
    await page.click('a[href="/studio/content"]');
    await page.waitForURL(/\/studio\/content/);

    // Sidebar should close after navigation
    await expect(sidebar).not.toHaveClass(/open/);
  });

  test('mobile close button closes sidebar', async ({ page }) => {
    await navigateToStudio(page, sharedAuth.member.organization.slug);

    // Open sidebar
    await page.click('.menu-toggle');
    const sidebar = page.locator('.studio-sidebar');
    await expect(sidebar).toHaveClass(/open/);

    // Click close button
    await page.click('.sidebar-close');
    await expect(sidebar).not.toHaveClass(/open/);
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
    // Try to access studio without auth — should redirect to login or org home
    await page.goto('http://some-org.lvh.me:5173/studio', {
      waitUntil: 'load',
    });

    // Should not be on the studio page
    const url = page.url();
    expect(url).not.toContain('/studio');
  });
});

test.describe('Studio Navigation - Role-Based Sidebar', () => {
  test('creator role does not see admin or owner sections', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'creator' });
    await navigateToStudio(page, member.organization.slug);

    // Base links should be visible
    await expect(page.locator('a[href="/studio"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/content"]')).toBeVisible();

    // Admin links should NOT be visible
    await expect(page.locator('a[href="/studio/team"]')).not.toBeVisible();
    await expect(page.locator('a[href="/studio/customers"]')).not.toBeVisible();
    await expect(page.locator('a[href="/studio/settings"]')).not.toBeVisible();

    // Owner links should NOT be visible
    await expect(page.locator('a[href="/studio/billing"]')).not.toBeVisible();
  });

  test('admin role sees admin section but not owner section', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'admin' });
    await navigateToStudio(page, member.organization.slug);

    // Admin links should be visible
    await expect(page.locator('a[href="/studio/team"]')).toBeVisible();
    await expect(page.locator('a[href="/studio/settings"]')).toBeVisible();

    // Owner links should NOT be visible
    await expect(page.locator('a[href="/studio/billing"]')).not.toBeVisible();
  });
});
