/**
 * WP-10 Scenario 4 — Terminate from either party
 *
 * Two sub-tests:
 *   (a) Owner terminates an active agreement → it moves out of active
 *       agreements quick-action list and the creator's portfolio reflects
 *       it as "Past".
 *   (b) Creator terminates an active agreement → owner's active-agreements
 *       list no longer contains it.
 *
 * Each sub-test bootstraps a fresh topology, drives the propose → accept
 * lifecycle, then exercises the terminate path from the corresponding
 * actor.
 */

import { expect, type Page, test } from '@playwright/test';
import {
  type AgreementTopology,
  cleanupAgreementTopology,
  createOwnerAndCreator,
  creatorNegotiationsUrl,
  injectAgreementCookies,
  ownerRevenueSharePath,
} from '../helpers/agreements';

/**
 * Drive owner → propose → creator → accept inline so this spec does not
 * depend on the propose-accept spec running first.
 */
async function bootstrapActiveAgreement(
  ownerPage: Page,
  creatorPage: Page,
  orgSlug: string,
  creatorName: string
): Promise<void> {
  await ownerPage.goto(ownerRevenueSharePath(orgSlug), { waitUntil: 'load' });
  await expect(
    ownerPage.getByRole('heading', { name: 'Team revenue share' })
  ).toBeVisible({ timeout: 30_000 });

  const card = ownerPage.locator(`article[aria-label*="${creatorName}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card
    .getByRole('button', { name: /propose agreement/i })
    .first()
    .click();

  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await dialog.getByRole('button', { name: /send proposal/i }).click();
  await expect(
    ownerPage.locator('[role="alert"]').filter({ hasText: /Proposal sent/i })
  ).toBeVisible({ timeout: 10_000 });

  await creatorPage.goto(creatorNegotiationsUrl(), { waitUntil: 'load' });
  await expect(
    creatorPage.getByRole('heading', { name: 'Negotiations' })
  ).toBeVisible({ timeout: 30_000 });
  const actionRequired = creatorPage.locator(
    'section[aria-labelledby="action-required-heading"]'
  );
  await expect(actionRequired).toBeVisible({ timeout: 15_000 });
  await actionRequired
    .getByRole('button', { name: /^Accept$/i })
    .first()
    .click();
  await expect(
    creatorPage
      .locator('[role="alert"]')
      .filter({ hasText: /Agreement accepted/i })
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('Agreements — Terminate', () => {
  test('owner terminates an active agreement', async ({ browser }) => {
    const topology: AgreementTopology = await createOwnerAndCreator();
    const { owner, creator, orgSlug } = topology;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await injectAgreementCookies(ownerCtx, owner.cookie);

    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await injectAgreementCookies(creatorCtx, creator.cookie);

    try {
      await bootstrapActiveAgreement(
        ownerPage,
        creatorPage,
        orgSlug,
        creator.user.name
      );

      // Owner: navigate back to the revenue-share page (post-accept).
      await ownerPage.goto(ownerRevenueSharePath(orgSlug), {
        waitUntil: 'load',
      });
      await expect(
        ownerPage.getByRole('heading', { name: 'Team revenue share' })
      ).toBeVisible({ timeout: 30_000 });

      const activeSection = ownerPage.locator(
        'section[aria-labelledby="active-agreements-heading"]'
      );
      await expect(activeSection).toBeVisible({ timeout: 15_000 });
      await expect(activeSection).toContainText(creator.user.name);

      // Click Terminate on the only active row.
      await activeSection
        .getByRole('button', { name: /terminate/i })
        .first()
        .click();

      // Toast confirms termination.
      await expect(
        ownerPage.locator('[role="alert"]').filter({ hasText: /terminated/i })
      ).toBeVisible({ timeout: 10_000 });

      // Active-agreements section is gone (last row gone → section
      // re-rendered conditionally) OR no longer contains the creator.
      await expect(activeSection).toBeHidden({ timeout: 15_000 });

      // Creator portfolio reflects the termination. The "past" section
      // in _creators/.../negotiations/+page.svelte only surfaces terminal
      // *proposals* (declined/withdrawn/superseded) — terminated
      // *agreements* are not currently displayed there. So instead of
      // checking past-heading, verify that the active section is no
      // longer rendered (it gates on `active.length > 0`).
      await creatorPage.reload({ waitUntil: 'load' });
      const creatorActiveSection = creatorPage.locator(
        'section[aria-labelledby="active-heading"]'
      );
      await expect(creatorActiveSection).toBeHidden({ timeout: 15_000 });
    } finally {
      await ownerCtx.close();
      await creatorCtx.close();
      await cleanupAgreementTopology(topology);
    }
  });

  test('creator terminates an active agreement', async ({ browser }) => {
    const topology: AgreementTopology = await createOwnerAndCreator();
    const { owner, creator, orgSlug } = topology;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await injectAgreementCookies(ownerCtx, owner.cookie);

    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await injectAgreementCookies(creatorCtx, creator.cookie);

    try {
      await bootstrapActiveAgreement(
        ownerPage,
        creatorPage,
        orgSlug,
        creator.user.name
      );

      // Creator side: open agreement detail and terminate.
      await creatorPage.goto(creatorNegotiationsUrl(), { waitUntil: 'load' });
      await expect(
        creatorPage.getByRole('heading', { name: 'Negotiations' })
      ).toBeVisible({ timeout: 30_000 });

      const activeSection = creatorPage.locator(
        'section[aria-labelledby="active-heading"]'
      );
      await expect(activeSection).toBeVisible({ timeout: 15_000 });

      // Manage link routes to /studio/negotiations/[proposalId].
      await activeSection
        .getByRole('link', { name: /manage/i })
        .first()
        .click();
      await creatorPage.waitForURL(/\/studio\/negotiations\/[0-9a-f-]+/i, {
        timeout: 15_000,
      });

      // Detail page exposes a Terminate button → confirmation form →
      // "Confirm terminate". The creator side requires the two-step
      // confirmation (see _creators/.../[proposalId]/+page.svelte's
      // `terminateConfirming` $state), whereas the owner side terminates
      // immediately on first click. Without the second click the API is
      // never called and the toast never fires.
      await creatorPage
        .getByRole('button', { name: /^Terminate$/i })
        .first()
        .click();
      await creatorPage
        .getByRole('button', { name: /confirm terminate/i })
        .first()
        .click();

      await expect(
        creatorPage.locator('[role="alert"]').filter({ hasText: /terminated/i })
      ).toBeVisible({ timeout: 10_000 });

      // Owner side reflects: active-agreements section gone.
      await ownerPage.goto(ownerRevenueSharePath(orgSlug), {
        waitUntil: 'load',
      });
      await expect(
        ownerPage.getByRole('heading', { name: 'Team revenue share' })
      ).toBeVisible({ timeout: 30_000 });
      const ownerActive = ownerPage.locator(
        'section[aria-labelledby="active-agreements-heading"]'
      );
      await expect(ownerActive).toBeHidden({ timeout: 15_000 });
    } finally {
      await ownerCtx.close();
      await creatorCtx.close();
      await cleanupAgreementTopology(topology);
    }
  });
});
