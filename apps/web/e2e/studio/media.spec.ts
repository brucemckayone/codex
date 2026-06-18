import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
} from '../helpers/studio';

/**
 * Studio Media Page E2E Tests
 *
 * Tests media listing and upload UI.
 * Creator role is sufficient for media access.
 */

test.describe('Studio Media Page', () => {
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

  test('media page loads', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // The redesigned media page uses a MediaLibraryCommandBar (no <h1>); the
    // breadcrumb leaf is the page's primary heading.
    await expect(page.locator('.command-bar .breadcrumb-leaf')).toBeVisible();
  });

  test('media page shows upload zone or media grid', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // The redesigned media library uses `.tile-grid` for populated state and
    // EmptyState (`.empty-state`) for new orgs. Upload is a viewport-wide
    // drop overlay (not a visible inline drop zone), so the test asserts the
    // terminal data-bound surface only.
    const emptyState = page.locator('.empty-state');
    const tileGrid = page.locator('.tile-grid');

    await expect(emptyState.or(tileGrid).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('media page shows empty state for new org', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // New org has no media — the redesigned page shows an EmptyState (.empty-state)
    // and upload is via a viewport-wide drop overlay (not a visible inline
    // drop zone). Wait for the empty state to appear once data resolves.
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 15000 });
  });
});
