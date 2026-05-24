/**
 * WP-10 Scenario 3 — Decline + re-propose
 *
 * Owner proposes 30%.
 * Creator declines (no required reason; if a textbox is present we fill
 *   one for audit-trail visibility).
 * Both sides see declined status:
 *   - Owner: card returns to the "Propose agreement" CTA (terminal
 *     thread allows a brand-new round-1).
 *   - Creator: row moves from "Action required" → "Past" with status
 *     pill `Declined`.
 * Owner re-proposes a second round-1 successfully (proves terminal
 *   thread doesn't block fresh negotiation).
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

test.describe('Agreements — Decline + re-propose', () => {
  let topology: AgreementTopology | null = null;

  test.beforeEach(async () => {
    topology = await createOwnerAndCreator();
  });

  test.afterEach(async () => {
    await cleanupAgreementTopology(topology);
    topology = null;
  });

  test('creator declines, owner can propose again', async ({ browser }) => {
    if (!topology) throw new Error('topology not seeded');
    const { owner, creator, orgSlug } = topology;

    // ─── Owner round-1 propose ──────────────────────────────────────
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await injectAgreementCookies(ownerCtx, owner.cookie);
    await ownerPage.goto(ownerRevenueSharePath(orgSlug), { waitUntil: 'load' });
    await expect(
      ownerPage.getByRole('heading', { name: 'Team revenue share' })
    ).toBeVisible({ timeout: 30_000 });

    const creatorCard = ownerPage.locator(
      `article[aria-label*="${creator.user.name}"]`
    );
    await expect(creatorCard).toBeVisible({ timeout: 15_000 });
    await creatorCard
      .getByRole('button', { name: /propose agreement/i })
      .first()
      .click();

    const proposeDialog = ownerPage.getByRole('dialog');
    await expect(proposeDialog).toBeVisible({ timeout: 5000 });
    await proposeDialog.getByRole('button', { name: /send proposal/i }).click();
    await expect(
      ownerPage.locator('[role="alert"]').filter({ hasText: /Proposal sent/i })
    ).toBeVisible({ timeout: 10_000 });

    // ─── Creator declines ───────────────────────────────────────────
    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await injectAgreementCookies(creatorCtx, creator.cookie);
    await creatorPage.goto(creatorNegotiationsUrl(), { waitUntil: 'load' });
    await expect(
      creatorPage.getByRole('heading', { name: 'Negotiations' })
    ).toBeVisible({ timeout: 30_000 });

    const actionRequired = creatorPage.locator(
      'section[aria-labelledby="action-required-heading"]'
    );
    await expect(actionRequired).toBeVisible({ timeout: 15_000 });
    await actionRequired
      .getByRole('button', { name: /^Decline$/i })
      .first()
      .click();

    // Toast confirms decline.
    await expect(
      creatorPage.locator('[role="alert"]').filter({ hasText: /declined/i })
    ).toBeVisible({ timeout: 10_000 });

    // Past section now lists the declined proposal once expanded.
    const pastSection = creatorPage.locator(
      'section[aria-labelledby="past-heading"]'
    );
    await expect(pastSection).toBeVisible({ timeout: 15_000 });
    // The collapsible needs to be expanded.
    const showPastButton = pastSection.getByRole('button', { name: /show/i });
    if ((await showPastButton.count()) > 0) {
      await showPastButton.click();
    }
    await expect(pastSection).toContainText(/Declined/i);

    // ─── Owner card returns to Propose CTA (terminal thread) ────────
    await ownerPage.reload({ waitUntil: 'load' });
    await expect(
      ownerPage.getByRole('heading', { name: 'Team revenue share' })
    ).toBeVisible({ timeout: 30_000 });
    const creatorCardAfter = ownerPage.locator(
      `article[aria-label*="${creator.user.name}"]`
    );
    await expect(creatorCardAfter).toBeVisible({ timeout: 15_000 });
    await expect(
      creatorCardAfter
        .getByRole('button', { name: /propose agreement/i })
        .first()
    ).toBeVisible({ timeout: 10_000 });

    // ─── Owner re-proposes; toast confirms ──────────────────────────
    await creatorCardAfter
      .getByRole('button', { name: /propose agreement/i })
      .first()
      .click();
    const reproposeDialog = ownerPage.getByRole('dialog');
    await expect(reproposeDialog).toBeVisible({ timeout: 5000 });
    await reproposeDialog
      .getByRole('button', { name: /send proposal/i })
      .click();
    await expect(
      ownerPage.locator('[role="alert"]').filter({ hasText: /Proposal sent/i })
    ).toBeVisible({ timeout: 10_000 });

    await ownerCtx.close();
    await creatorCtx.close();
  });
});
