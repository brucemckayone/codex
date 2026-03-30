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
 * Studio Team & Customers E2E Tests
 *
 * Tests team member listing, invite dialog, and customers page.
 * Owner role required for team management.
 */

test.describe('Studio Team Page', () => {
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

  test('team page loads with heading', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await expect(page.locator('h1')).toContainText(/Team/i);
  });

  test('invite member button is visible', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await expect(
      page.getByRole('button', { name: /Invite Member/i })
    ).toBeVisible();
  });

  test('team page shows member table or empty state', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    const table = page.locator('table');
    const emptyState = page.locator('.empty-state');

    const hasTable = await table.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('invite button opens dialog', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await page.getByRole('button', { name: /Invite Member/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('invite dialog has email and role fields', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await page.getByRole('button', { name: /Invite Member/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#invite-email')).toBeVisible();
    await expect(page.locator('#invite-role')).toBeVisible();
  });

  test('invite dialog closes on cancel', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await page.getByRole('button', { name: /Invite Member/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Studio Customers Page', () => {
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

  test('customers page loads with heading', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/customers'
    );

    await expect(page.locator('h1')).toContainText(/Customers/i);
  });

  test('customers page shows empty state for new org', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/customers'
    );

    // New org: empty state. Populated org: table.
    const emptyState = page.locator('.empty-state');
    const table = page.locator('table');

    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasTable = await table.isVisible().catch(() => false);
    expect(hasEmpty || hasTable).toBeTruthy();
  });
});
