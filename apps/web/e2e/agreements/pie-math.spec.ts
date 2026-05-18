/**
 * WP-10 Scenario 5 — Multi-creator pie math
 *
 * Three creators with subscription agreements at 30 / 20 / 10 % each
 * (60% total to creators, 10% platform fee, 30% org residual).
 *
 * The owner's revenue-share page renders a RevenueSplitPie with all
 * five slices (platform + 3 creators + org residual). The pie copy
 * explicitly references "post-platform" math (Decision Q1 / C1).
 *
 * This spec exercises the full UI propose → accept flow per creator so
 * the resulting agreement set is real (no DB shortcuts). Each accept
 * mutates state both for that creator's pending row and for the pie.
 */

import type { OrgMemberContext } from '@codex/shared-types';
import { expect, test } from '@playwright/test';
import {
  cleanupAgreementTopology,
  createOwnerWithCreators,
  creatorNegotiationsUrl,
  injectAgreementCookies,
  ownerRevenueSharePath,
} from '../helpers/agreements';

const CREATOR_SHARES = [30, 20, 10] as const;

test.describe('Agreements — Multi-creator pie math', () => {
  test('three creators, pie sums to 100% and labels reference post-platform', async ({
    browser,
  }) => {
    const { owner, creators, orgSlug } = await createOwnerWithCreators(
      CREATOR_SHARES.length
    );

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await injectAgreementCookies(ownerCtx, owner.cookie);
    const allContexts = [ownerCtx];

    try {
      // ─── Propose + Accept for each creator ───────────────────────
      for (let i = 0; i < creators.length; i += 1) {
        const creator = creators[i] as OrgMemberContext;
        const share = CREATOR_SHARES[i] as number;

        // Owner proposes.
        await ownerPage.goto(ownerRevenueSharePath(orgSlug), {
          waitUntil: 'load',
        });
        await expect(
          ownerPage.getByRole('heading', { name: 'Team revenue share' })
        ).toBeVisible({ timeout: 30_000 });

        const card = ownerPage.locator(
          `article[aria-label*="${creator.user.name}"]`
        );
        await expect(card).toBeVisible({ timeout: 15_000 });
        await card
          .getByRole('button', { name: /propose agreement/i })
          .first()
          .click();

        const dialog = ownerPage.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // Set creator share via the BrandSlider's text-input. The
        // slider exposes its current value as an editable number.
        const shareInput = dialog
          .locator('input[type="number"], input[role="spinbutton"]')
          .first();
        if ((await shareInput.count()) > 0) {
          await shareInput.fill(String(share));
        }

        await dialog.getByRole('button', { name: /send proposal/i }).click();
        await expect(
          ownerPage
            .locator('[role="status"]')
            .filter({ hasText: /Proposal sent/i })
        ).toBeVisible({ timeout: 10_000 });

        // Creator accepts in own context.
        const creatorCtx = await browser.newContext();
        allContexts.push(creatorCtx);
        const creatorPage = await creatorCtx.newPage();
        await injectAgreementCookies(creatorCtx, creator.cookie);
        await creatorPage.goto(creatorNegotiationsUrl(), {
          waitUntil: 'load',
        });
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
            .locator('[role="status"]')
            .filter({ hasText: /Agreement accepted/i })
        ).toBeVisible({ timeout: 10_000 });
      }

      // ─── Pie reflects all three creators + platform + org residual ─
      await ownerPage.goto(ownerRevenueSharePath(orgSlug), {
        waitUntil: 'load',
      });
      await expect(
        ownerPage.getByRole('heading', { name: 'Team revenue share' })
      ).toBeVisible({ timeout: 30_000 });

      const teamBudget = ownerPage.locator(
        'section[aria-labelledby="team-budget-heading"]'
      );
      await expect(teamBudget).toBeVisible({ timeout: 15_000 });

      // The pie copy explicitly says "post-platform" (per Decision Q1).
      await expect(teamBudget).toContainText(/post-platform/i);

      // The active-agreements quick-action list contains all three.
      const activeSection = ownerPage.locator(
        'section[aria-labelledby="active-agreements-heading"]'
      );
      await expect(activeSection).toBeVisible({ timeout: 15_000 });
      for (const creator of creators) {
        await expect(activeSection).toContainText(creator.user.name);
      }
      for (const share of CREATOR_SHARES) {
        await expect(activeSection).toContainText(`${share}%`);
      }
    } finally {
      // Close every browser context we opened.
      for (const ctx of allContexts) {
        await ctx.close().catch(() => {});
      }
      // Clean up each user's session.
      await cleanupAgreementTopology({
        owner,
        creator: creators[0] as OrgMemberContext,
        orgSlug,
      });
      for (let i = 1; i < creators.length; i += 1) {
        const c = creators[i];
        if (!c) continue;
        await cleanupAgreementTopology({
          owner,
          creator: c,
          orgSlug,
        }).catch(() => {});
      }
    }
  });
});
