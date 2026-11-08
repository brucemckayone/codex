import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  goToPublishStep,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
  setupStudioUser,
  startDraft,
  waitForEditorSave,
} from '../helpers/studio';

/**
 * Studio Content E2E Tests
 *
 * The content list, and the two-step editor that replaced the old form
 * (Codex-a6ofh.2): a piece starts on the Write step, is a draft from the
 * first thing added (its row is made then, and the address moves to its
 * edit page), and goes live from the Publish step, where every setting
 * sits on one screen and saves as it changes.
 */

test.describe('Studio Content - List Page', () => {
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

  test('content list page renders command bar', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    // The redesigned content list uses a sticky ContentListCommandBar
    // (no <h1>); the breadcrumb leaf is the page's primary heading.
    await expect(page.locator('.command-bar .breadcrumb-leaf')).toBeVisible();
  });

  test('empty state or table renders', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    // New org: EmptyState (.empty-state). Populated org: the redesigned list
    // uses an <ol class="row-stack"> (no <table>) and optionally a
    // ContentFeatureSlab. Wait for the loading skeleton to clear and then
    // assert one of the two terminal states.
    const emptyState = page.locator('.empty-state');
    const rowStack = page.locator('ol.row-stack');

    // Either state should appear once data resolves.
    await expect(emptyState.or(rowStack).first()).toBeVisible({
      timeout: 15000,
    });
  });

  // The empty list's create link: no type asked for, so a video.
  test('create link opens the Write step', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    await page.locator('a[href="/studio/content/new"]').first().click();
    await page.waitForURL(/\/studio\/content\/new/);
    // Not saved until something is added.
    await expect(
      page.getByRole('textbox', { name: 'Title', exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('New video · not saved yet')).toBeVisible();
  });

  test('the New menu offers the three kinds, each opening its Write step', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );

    await page.getByRole('button', { name: 'New', exact: true }).click();
    for (const [name, type] of [
      [/^Video/, 'video'],
      [/^Audio/, 'audio'],
      [/^Article/, 'written'],
    ] as const) {
      await expect(page.getByRole('menuitem', { name })).toHaveAttribute(
        'href',
        `/studio/content/new?type=${type}`
      );
    }
  });
});

test.describe('Studio Content - Write step', () => {
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

  test('a new article opens the canvas: title, description and its words', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new?type=written'
    );

    await expect(
      page.getByRole('textbox', { name: 'Title', exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('textbox', { name: 'Description', exact: true })
    ).toBeVisible();
    // The body is the TipTap editor, named for what it holds.
    await expect(
      page.getByRole('textbox', { name: 'Article', exact: true })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('New article · not saved yet')).toBeVisible();

    // Nothing added yet: Next says what it needs, and waits.
    await expect(
      page.getByRole('button', { name: 'Next: publish', exact: true })
    ).toBeDisabled();
  });

  test('a new video opens with a place for the video', async ({ page }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content/new?type=video'
    );

    await expect(page.getByText('Add the video')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('button', { name: 'Choose from library' })
    ).toBeVisible();
  });
});

test.describe('Studio Content - Publish step', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;
  const title = `E2E Draft ${Date.now()}`;
  /** Made by the first test; the others open it. */
  let draftId = '';

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test.beforeEach(async ({ page }) => {
    await injectSharedStudioAuth(page, sharedAuth);
  });

  test('a title makes the draft; Next opens Publish, with access as one choice', async ({
    page,
  }) => {
    // The address moves once the row is made, which saved the title.
    draftId = await startDraft(
      page,
      sharedAuth.member.organization.slug,
      'written',
      title
    );
    await goToPublishStep(page);

    await expect(
      page.getByRole('heading', { level: 1, name: title })
    ).toBeVisible();
    const access = page.getByRole('radiogroup', { name: 'Access' });
    for (const name of [/^Free/, /^Buy once/, /^Followers/, /^Team only/]) {
      await expect(access.getByRole('radio', { name })).toBeAttached();
    }
    // A new org has no tiers, so there is nothing to gate it to.
    await expect(
      access.getByRole('radio', { name: /^Subscribers/ })
    ).toHaveCount(0);
  });

  test('monetised access is gated until payouts are set up', async ({
    page,
  }) => {
    // Codex-eb00a.10: selling (or gating behind a subscription, which a new
    // org with no tiers is not offered) needs a payout-ready Stripe Connect
    // account, as the publish gate does. A fresh studio user has none.
    // Payouts read as ready until the status query answers, so this waits on
    // the disabled state (expect retries).
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      `/content/${draftId}/edit?step=publish`
    );
    await expect(page.getByRole('radiogroup', { name: 'Access' })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByRole('radio', { name: /^Buy once/ })).toBeDisabled();
    await expect(page.locator('.payouts-hint')).toBeVisible();
    // Nothing for sale, so no price: absent, not merely hidden.
    await expect(page.locator('input#price')).toHaveCount(0);
  });

  test('a populated org’s New menu offers its draft before the kinds', async ({
    page,
  }) => {
    await navigateToStudioPage(
      page,
      sharedAuth.member.organization.slug,
      '/content'
    );
    await page.getByRole('button', { name: 'New', exact: true }).click();

    // The drafts are read as the menu opens: the newest first, so nothing
    // is started twice, then "All drafts", then the kinds.
    const items = page.getByRole('menuitem');
    await expect(items.first()).toContainText(title, { timeout: 15_000 });
    await expect(
      page.getByRole('menuitem', { name: /^All drafts \(1\)/ })
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /^Article/ })
    ).toHaveAttribute('href', '/studio/content/new?type=written');

    // The draft opens where it was left (its step, from its own fields).
    await items.first().click();
    await expect(page).toHaveURL(
      new RegExp(`/studio/content/${draftId}/edit(\\?step=publish)?$`),
      { timeout: 30_000 }
    );
  });
});

test.describe('Studio Content - Publish', () => {
  test('an article with a title and words goes live from the Publish step', async ({
    page,
  }) => {
    const member = await setupStudioUser(page, { orgRole: 'owner' });
    const title = `E2E Article ${Date.now()}`;

    await startDraft(page, member.organization.slug, 'written', title);
    // An article needs its words to go live (Codex-a6ofh.2.1).
    const body = page.getByRole('textbox', { name: 'Article', exact: true });
    await body.click();
    await page.keyboard.type('Test article body');
    await waitForEditorSave(page);
    await goToPublishStep(page);

    // Free: nothing else is needed, and no payouts are.
    await page.getByRole('radio', { name: /^Free/ }).check({ force: true });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();

    // Live, it is listed with the creator's other pieces.
    await expect(page.getByText(`“${title}” is live.`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/studio\/content$/, { timeout: 30_000 });
    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
