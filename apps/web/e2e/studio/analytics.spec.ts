import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
  setupStudioUser,
} from '../helpers/studio';

/**
 * Studio Analytics E2E Tests (iter-018 FE-9)
 *
 * Verifies the rebuilt studio analytics page (shipped in FE-8, commit
 * 0557bc21). Three mandated scenarios per the bead:
 *   1. Auth     — unauthenticated users can't reach /studio/analytics;
 *                 they redirect to /login (via the studio layout server).
 *   2. Zero-state — a fresh org with no revenue/subs/followers/top-content
 *                 renders AnalyticsZeroState instead of the dashboard.
 *   3. Role-gate — a creator-role user (not admin/owner) is redirected
 *                 client-side to /studio (the analytics page's $effect).
 *
 * The analytics page runs under the studio's ssr=false subtree, so
 * client-side redirects fire only after Svelte 5 hydrates and $effect
 * evaluates — we wait for URL changes rather than asserting DOM state
 * synchronously.
 */

const BASE_PORT = 5173;

test.describe('Studio Analytics - Auth Redirect', () => {
  test('unauthenticated user is redirected away from /studio/analytics', async ({
    page,
  }) => {
    // Fresh context: ensure no session cookie leaks in.
    await page.context().clearCookies();

    await page.goto(`http://some-org.lvh.me:${BASE_PORT}/studio/analytics`, {
      waitUntil: 'load',
    });

    // Studio layout server redirects to /login?redirect=/studio when
    // locals.user is missing. The final URL must not still be on analytics.
    await page.waitForURL(/\/login/, { timeout: 15000 });
    expect(page.url()).toContain('/login');
    expect(page.url()).not.toContain('/studio/analytics');
  });
});

test.describe('Studio Analytics - Zero State', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    // Fresh org with an owner — no content, no customers, no revenue.
    // Every analytics query resolves to empty, so AnalyticsZeroState renders.
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('renders AnalyticsZeroState on a brand-new org', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/analytics'
    );

    // Zero-state heading — from m.analytics_zero_state_heading().
    await expect(
      page.getByRole('heading', {
        name: 'Your analytics will appear here.',
      })
    ).toBeVisible({ timeout: 20000 });

    // The SVG illustration has role="img" + aria-label.
    await expect(
      page.getByRole('img', {
        name: /faint flat chart lines/i,
      })
    ).toBeVisible();

    // Dashboard sections MUST NOT render when zero state is active.
    await expect(
      page.getByRole('region', { name: /kpi|key performance/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: /top content/i })
    ).toHaveCount(0);

    // Chart tabs must NOT render — HeroAnalyticsChart is gated by isZeroState.
    await expect(page.getByRole('tab', { name: 'Revenue' })).toHaveCount(0);
  });

  test('command bar is still present on the zero-state view', async ({
    page,
  }) => {
    // The command bar renders above the zero state regardless — date-range
    // presets must remain reachable even when there's no data yet.
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/analytics'
    );

    await expect(
      page.getByRole('heading', {
        name: 'Your analytics will appear here.',
      })
    ).toBeVisible({ timeout: 20000 });

    // Preset row — role="group" wrapping four preset buttons.
    const preset30d = page.getByRole('button', { name: 'Last 30 days' });
    await expect(preset30d).toBeVisible();
    await expect(preset30d).toHaveAttribute('aria-pressed', 'true');

    await expect(
      page.getByRole('button', { name: 'Last 7 days' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Last 90 days' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last year' })).toBeVisible();
  });
});

test.describe('Studio Analytics - Role Gate', () => {
  test('creator role is redirected from /studio/analytics to /studio', async ({
    page,
  }) => {
    // Creator can enter /studio (layout server allows creator/admin/owner)
    // but the analytics page's client $effect only allows admin/owner —
    // so creator hits a client-side goto('/studio').
    const member = await setupStudioUser(page, { orgRole: 'creator' });

    await page.goto(
      `http://${member.organization.slug}.lvh.me:${BASE_PORT}/studio/analytics`,
      { waitUntil: 'load' }
    );

    // Studio is SPA (ssr=false) — wait for hydration + effect to redirect.
    // The redirect target is /studio (NOT /login — they ARE authenticated).
    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        return p === '/studio' || p === '/studio/';
      },
      { timeout: 20000 }
    );

    expect(page.url()).toMatch(/\/studio(\/)?$/);
    expect(page.url()).not.toContain('/analytics');
    expect(page.url()).not.toContain('/login');
  });
});

test.describe('Studio Analytics - Command Bar Presets', () => {
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

  test('clicking Last 7 days updates URL with startDate + endDate', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/analytics'
    );

    // Wait for the page to render the command bar.
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toBeVisible(
      { timeout: 20000 }
    );

    await page.getByRole('button', { name: 'Last 7 days' }).click();

    // URL must carry both startDate and endDate.
    await page.waitForURL(/startDate=\d{4}-\d{2}-\d{2}/, { timeout: 10000 });
    expect(page.url()).toMatch(/startDate=\d{4}-\d{2}-\d{2}/);
    expect(page.url()).toMatch(/endDate=\d{4}-\d{2}-\d{2}/);

    // The 7d preset should now be the active one.
    await expect(
      page.getByRole('button', { name: 'Last 7 days' })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
