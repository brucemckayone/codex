/**
 * WP-10 Scenario 1 — Propose → Accept happy path
 *
 * Owner @ `${orgSlug}.lvh.me/studio/settings/revenue-share` proposes a
 *   subscription agreement with the team creator (default 30%, term 6mo).
 * Creator @ `creators.lvh.me/studio/negotiations` sees the proposal in
 *   "Action required", clicks Accept.
 * Owner re-opens the page, sees the agreement now active (pending row
 *   gone, AgreementCard renders share + Amend/View thread actions, and
 *   the active-agreements quick-action row appears).
 *
 * Two browser contexts share the same `.lvh.me` cookie domain — owner
 * and creator live in independent Playwright contexts so their cookies
 * don't collide.
 */

import { expect, test } from '@playwright/test';
import {
  type AgreementTopology,
  cleanupAgreementTopology,
  createOwnerAndCreator,
  creatorNegotiationsUrl,
  injectAgreementCookies,
  ownerRevenueSharePath,
} from '../helpers/agreements';

test.describe('Agreements — Propose → Accept happy path', () => {
  let topology: AgreementTopology | null = null;

  test.beforeEach(async () => {
    topology = await createOwnerAndCreator();
  });

  test.afterEach(async () => {
    await cleanupAgreementTopology(topology);
    topology = null;
  });

  test('owner proposes, creator accepts, agreement becomes active', async ({
    browser,
  }) => {
    if (!topology) throw new Error('topology not seeded');
    const { owner, creator, orgSlug } = topology;

    // ─── Owner context ─────────────────────────────────────────────────
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await injectAgreementCookies(ownerCtx, owner.cookie);
    await ownerPage.goto(ownerRevenueSharePath(orgSlug), {
      waitUntil: 'load',
    });

    // Studio is SSR=false; wait for the shell to hydrate before checking
    // for page-specific elements. Without this, the page-level heading
    // can race the initial empty shell.
    await ownerPage.waitForSelector('.studio-layout', {
      state: 'visible',
      timeout: 30_000,
    });

    await expect(
      ownerPage.getByRole('heading', { name: 'Team revenue share' })
    ).toBeVisible({ timeout: 30_000 });

    // The seeded creator should appear in the Creators section.
    const creatorCard = ownerPage.locator(
      `article[aria-label*="${creator.user.name}"]`
    );
    await expect(creatorCard).toBeVisible({ timeout: 15_000 });

    // Click "Propose agreement" inside the subscription row of the card.
    await creatorCard
      .getByRole('button', { name: /propose agreement/i })
      .first()
      .click();

    // ProposeAgreementDialog opens — default share 30%, term 6 months.
    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // Term radio: pick 6 months.
    await dialog
      .getByRole('radio', { name: /6 months/i })
      .check({ force: true });

    // Optional note for thread provenance.
    await dialog.locator('textarea#propose-note').fill('e2e: round-1 propose');

    await dialog.getByRole('button', { name: /send proposal/i }).click();

    // Success toast confirmation.
    await expect(
      ownerPage.locator('[role="status"]').filter({ hasText: /Proposal sent/i })
    ).toBeVisible({ timeout: 10_000 });

    // ─── Creator context ───────────────────────────────────────────────
    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await injectAgreementCookies(creatorCtx, creator.cookie);
    await creatorPage.goto(creatorNegotiationsUrl(), { waitUntil: 'load' });

    await expect(
      creatorPage.getByRole('heading', { name: 'Negotiations' })
    ).toBeVisible({ timeout: 30_000 });

    // The pending proposal should land in "Action required".
    const actionRequired = creatorPage.locator(
      'section[aria-labelledby="action-required-heading"]'
    );
    await expect(actionRequired).toBeVisible({ timeout: 15_000 });
    await expect(actionRequired).toContainText('30%');
    await expect(actionRequired).toContainText('subscription');

    // Click Accept on the only pending proposal.
    await actionRequired
      .getByRole('button', { name: /^Accept$/i })
      .first()
      .click();

    // Success toast.
    await expect(
      creatorPage
        .locator('[role="status"]')
        .filter({ hasText: /Agreement accepted/i })
    ).toBeVisible({ timeout: 10_000 });

    // Action-required section should disappear (no pending rows left)
    // and Active agreements should appear.
    await expect(
      creatorPage.locator('section[aria-labelledby="active-heading"]')
    ).toBeVisible({ timeout: 15_000 });

    // ─── Owner side reflects active state ──────────────────────────────
    await ownerPage.reload({ waitUntil: 'load' });
    await expect(
      ownerPage.getByRole('heading', { name: 'Team revenue share' })
    ).toBeVisible({ timeout: 30_000 });

    // Active agreements section now lists this creator + 30%.
    const activeSection = ownerPage.locator(
      'section[aria-labelledby="active-agreements-heading"]'
    );
    await expect(activeSection).toBeVisible({ timeout: 15_000 });
    await expect(activeSection).toContainText(creator.user.name);
    await expect(activeSection).toContainText('30%');

    await ownerCtx.close();
    await creatorCtx.close();
  });
});
