import { expect, type Page } from '@playwright/test';
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

/**
 * The team page's HEADER invite CTA, scoped.
 *
 * `getByRole('button', { name: /Invite Member/i })` is ambiguous BY
 * CONSTRUCTION: MemberTable's empty state carries a second CTA with the same
 * accessible name (`<Button size="sm">{m.team_invite()}</Button>` inside
 * `.members-section`), so on any render where the members query has resolved
 * to an empty list the page holds TWO matching buttons and Playwright's strict
 * mode throws "resolved to 2 elements" before the click is attempted — it
 * does not wait for the count to fall to one. That is what turned
 * `invite dialog closes on cancel` red on main (run 33913062789); the sibling
 * cases passed only because the table happened to have rendered by then.
 *
 * Scoping to PageHeader's actions slot, which only ever holds the one, is the
 * same remedy pie-math.spec.ts documents for `.page-header__description`.
 */
function headerInviteButton(page: Page) {
  return page
    .locator('.page-header__actions')
    .getByRole('button', { name: /Invite Member/i });
}

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

    await expect(headerInviteButton(page)).toBeVisible();
  });

  test('team page shows member table or empty state', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    // The team page renders a table-skeleton while the members query is in
    // flight; once it resolves it swaps to <MemberTable>, which renders
    // either a <table> (members exist, including the auto-added owner) or
    // a `.empty-state` div. Wait for one of the terminal states.
    const table = page.locator('table');
    const emptyState = page.locator('.empty-state');

    await expect(table.or(emptyState).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('invite button opens dialog', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await headerInviteButton(page).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('invite dialog has email and role fields', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await headerInviteButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Email is a plain <input id="invite-email">; the role field is now a
    // Melt UI Select rendering a <button role="combobox">. Melt UI's
    // builder adds role="combobox" to the trigger (not button), so use
    // getByRole('combobox') to locate it.
    await expect(page.locator('#invite-email')).toBeVisible();
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });

  test('invite dialog closes on cancel', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    await headerInviteButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression guard for the strict-mode violation that turned E2E Web red on
   * main (run 33913062789). It proves BOTH halves: that the hazard is real,
   * and that {@link headerInviteButton} is immune to it.
   *
   * Failing `getOrgMembers` is the shortest way to put both CTAs on screen.
   * That is not a contrived state — a REJECTED remote query reports
   * `loading === false` while `current` stays `undefined` (SvelteKit 2.55's
   * Query sets `#ready` only on the resolve path; `.catch()` clears
   * `#loading` and leaves it false — the same trap studio/settings documents),
   * so the page's `{#if membersQuery?.loading}` skeleton is skipped and
   * <MemberTable> falls through to its empty-state branch. Measured locally
   * against this stack: 2 buttons match the bare accessible name, 1 matches
   * the scoped locator.
   *
   * The route matcher keys on the PATH, not the query string: SvelteKit sends
   * remote-query arguments as a base64 `?payload=`, so the org id does not
   * appear verbatim in the URL and a search-string matcher silently never
   * fires (it did not, on the first attempt at this test — the query then
   * succeeded and the empty state never appeared).
   */
  test('header invite CTA stays uniquely addressable beside the empty-state CTA', async ({
    page,
  }) => {
    await page.route(
      (url) => /\/_app\/remote\/[^/]+\/getOrgMembers$/.test(url.pathname),
      (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{}',
        })
    );

    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/team'
    );

    // The ambiguity is real, not hypothetical — this is the count Playwright
    // refused to click through on main.
    await expect(
      page.getByRole('button', { name: /Invite Member/i })
    ).toHaveCount(2);

    // ...and the scoped locator still resolves to exactly one, and still works.
    await expect(headerInviteButton(page)).toHaveCount(1);
    await headerInviteButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
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

    // New org: empty state. Populated org: table. The customers page renders
    // `<table-skeleton>` while `customersQuery` is in-flight; under shared-DB
    // contention the raw `isVisible()` snapshot can race the skeleton →
    // terminal state transition. Wait for the auto-retrying matcher to settle
    // on either terminal element (mirrors the sibling test at line 71).
    const emptyState = page.locator('.empty-state');
    const table = page.locator('table');
    await expect(emptyState.or(table).first()).toBeVisible({ timeout: 15000 });
  });
});
