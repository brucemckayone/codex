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

    // Editorial refactor dropped the page-level <h1>; the StudioMediaPage
    // component renders inside `.media-page` (or a `.media-skeleton`
    // wrapper while the listMedia query streams).
    await expect(
      page.locator('.media-page, .media-skeleton').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('media page shows upload zone or media grid', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // StudioMediaPage renders into `.library-body` once the listMedia query
    // resolves. Inside, an EmptyState (`.empty-state`) shows for new orgs
    // and a grid replaces it when media exists. Wait for the body shell so
    // we're past the skeleton-vs-rendered race.
    await page.waitForSelector('.library-body', {
      state: 'visible',
      timeout: 15000,
    });

    const libraryBody = page.locator('.library-body');
    await expect(libraryBody).toBeVisible();

    // Inside, either the empty state OR media items should render.
    const emptyState = page.locator('.empty-state');
    const mediaItem = page.locator('.library-body article, .library-body img');
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasItem = await mediaItem
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasEmpty || hasItem).toBeTruthy();
  });

  test('media page shows empty state for new org', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // Wait for the StudioMediaPage to land inside `.library-body` before
    // asserting on the empty branch — `mediaQuery.loading` shows a
    // skeleton that mounts neither empty-state nor a drop zone yet.
    await page.waitForSelector('.library-body', {
      state: 'visible',
      timeout: 15000,
    });

    // New org should have no media — look for empty state or the
    // viewport-wide drop overlay (drop-zone class lives on the LogoUpload
    // pattern but the media page uses MediaLibrary's empty-state slot).
    const emptyState = page.locator('.empty-state');
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasEmpty).toBeTruthy();
  });
});
