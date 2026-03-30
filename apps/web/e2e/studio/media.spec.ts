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

    // Page should render (heading or upload UI)
    await expect(page.locator('h1')).toBeVisible();
  });

  test('media page shows upload zone or media grid', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // Should show either an upload zone, empty state, or media grid
    const uploadZone = page.locator('.drop-zone, .upload-zone, [data-upload]');
    const emptyState = page.locator('.empty-state');
    const mediaGrid = page.locator('.media-grid, .media-list, table');

    const hasUpload = await uploadZone
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasGrid = await mediaGrid
      .first()
      .isVisible()
      .catch(() => false);

    // At least one UI state should be visible
    expect(hasUpload || hasEmpty || hasGrid).toBeTruthy();
  });

  test('media page shows empty state for new org', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/media'
    );

    // New org should have no media — look for empty state or upload prompt
    const emptyState = page.locator('.empty-state');
    const uploadPrompt = page.locator('.drop-zone, .upload-zone');

    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasUploadPrompt = await uploadPrompt
      .first()
      .isVisible()
      .catch(() => false);

    // One of these should show for a new org
    expect(hasEmpty || hasUploadPrompt).toBeTruthy();
  });
});
