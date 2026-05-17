/**
 * WP-10 Scenario 2 — Counter-propose round-trip
 *
 * Owner proposes 30%.
 * Creator counters with 40% via the proposal-detail page
 *   (creators.lvh.me/studio/negotiations/[proposalId]).
 * Owner opens the thread on the studio page, sees "Counter Proposals
 *   Received" / "Review counter" surface, accepts the counter.
 * Agreement becomes active at 40%. Thread shows three rows in order:
 *   round-1 owner @ 30%, round-2 creator @ 40%, accepted.
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

test.describe('Agreements — Counter-propose round-trip', () => {
  let topology: AgreementTopology | null = null;

  test.beforeEach(async () => {
    topology = await createOwnerAndCreator();
  });

  test.afterEach(async () => {
    await cleanupAgreementTopology(topology);
    topology = null;
  });

  test('owner @ 30% → creator counters @ 40% → owner accepts counter', async ({
    browser,
  }) => {
    if (!topology) throw new Error('topology not seeded');
    const { owner, creator, orgSlug } = topology;

    // ─── Owner proposes 30% ───────────────────────────────────────────
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
    await proposeDialog
      .getByRole('radio', { name: /6 months/i })
      .check({ force: true });
    await proposeDialog.getByRole('button', { name: /send proposal/i }).click();
    await expect(
      ownerPage.locator('[role="status"]').filter({ hasText: /Proposal sent/i })
    ).toBeVisible({ timeout: 10_000 });

    // ─── Creator counters @ 40% ───────────────────────────────────────
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

    // The Counter link routes to the proposal-detail page where the
    // creator submits a round-2 share. Click it.
    await actionRequired
      .getByRole('link', { name: /^Counter$/i })
      .first()
      .click();

    await creatorPage.waitForURL(/\/studio\/negotiations\/[0-9a-f-]+/i, {
      timeout: 15_000,
    });

    // The detail page exposes a counter-propose form. Find the share input
    // (typically a slider/number) and the submit button.
    const counterShare = creatorPage
      .getByRole('spinbutton', { name: /share|creator share/i })
      .or(creatorPage.locator('input[type="number"]'))
      .first();
    if ((await counterShare.count()) > 0) {
      // Try slider-text-input first, fall back to a raw number input.
      await counterShare.fill('40');
    }

    const submitCounter = creatorPage
      .getByRole('button', { name: /send counter|submit counter|counter/i })
      .first();
    await submitCounter.click();

    // Toast confirming counter sent.
    await expect(
      creatorPage
        .locator('[role="status"]')
        .filter({ hasText: /counter|sent/i })
    ).toBeVisible({ timeout: 10_000 });

    // ─── Owner reviews + accepts counter ─────────────────────────────
    await ownerPage.reload({ waitUntil: 'load' });
    await expect(
      ownerPage.getByRole('heading', { name: 'Team revenue share' })
    ).toBeVisible({ timeout: 30_000 });

    const creatorCardAfter = ownerPage.locator(
      `article[aria-label*="${creator.user.name}"]`
    );
    // Card surfaces "Review counter" once the creator has countered.
    await expect(
      creatorCardAfter.getByRole('button', { name: /review counter/i })
    ).toBeVisible({ timeout: 15_000 });
    await creatorCardAfter
      .getByRole('button', { name: /review counter/i })
      .click();

    const threadDialog = ownerPage.getByRole('dialog');
    await expect(threadDialog).toBeVisible({ timeout: 5000 });
    await expect(threadDialog).toContainText('30%'); // round-1
    await expect(threadDialog).toContainText('40%'); // round-2

    await threadDialog.getByRole('button', { name: /^Accept$/i }).click();

    await expect(
      ownerPage
        .locator('[role="status"]')
        .filter({ hasText: /Agreement accepted/i })
    ).toBeVisible({ timeout: 10_000 });

    // ─── Active agreements section now shows 40% ─────────────────────
    const activeSection = ownerPage.locator(
      'section[aria-labelledby="active-agreements-heading"]'
    );
    await expect(activeSection).toBeVisible({ timeout: 15_000 });
    await expect(activeSection).toContainText('40%');

    await ownerCtx.close();
    await creatorCtx.close();
  });
});
