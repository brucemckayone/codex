/**
 * The leaving notice, end to end (Codex-a6ofh.6.7): delete a piece someone
 * bought → it leaves in 30 days, and its buyer sees so → Keep it → it stays.
 *
 * - The creator's studio (WP-6): the delete dialog gives notice, the row says
 *   when it leaves and that its owner was emailed, and "Needs you" counts it.
 * - The buyer (WP-7): the piece's page says the day it leaves and offers the
 *   print view (an article), and their library card says "Leaving {date}".
 * - Keep it: the row's line goes, and the buyer's page is back to the plain
 *   "no longer on sale" note.
 *
 * Its own creator, org, piece and buyer, written directly (as
 * helpers/subscription.ts does), so no seeded piece another spec reads is
 * ever deleted.
 */
import { randomUUID } from 'node:crypto';
import { authFixture } from '@codex/test-utils/e2e';
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import { E2E_BASE_URL, orgUrl } from '../helpers/origin';
import {
  injectOrgCookies,
  navigateToStudioPage,
  setupStudioUser,
} from '../helpers/studio';

test.describe('leaving notice: delete, leaving, keep (Codex-a6ofh.6.7)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a bought piece leaves with notice, its buyer sees the day, and Keep it keeps it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { dbHttp, schema } = await import('@codex/database');

    // ── The creator, their org, and a live £4.99 article ────────────────
    const creator = await setupStudioUser(page, { orgRole: 'owner' });
    const org = creator.organization;
    const title = `Leaving e2e ${Date.now()}`;
    const slug = `leaving-e2e-${randomUUID().slice(0, 8)}`;
    const [piece] = await dbHttp
      .insert(schema.content)
      .values({
        creatorId: creator.user.id,
        organizationId: org.id,
        title,
        slug,
        contentType: 'written',
        contentBody: 'An article its buyer keeps as a PDF.',
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        status: 'published',
        publishedAt: new Date(),
      })
      .returning({ id: schema.content.id });
    if (!piece) throw new Error('the piece was not written');

    // ── Its buyer: a completed purchase and its grant ────────────────────
    const buyer = await authFixture.registerUser({
      email: `e2e-leaving-buyer-${Date.now()}@test.codex`,
      password: 'Test123!@#',
      name: 'E2E Leaving Buyer',
    });
    const [sale] = await dbHttp
      .insert(schema.purchases)
      .values({
        customerId: buyer.user.id,
        contentId: piece.id,
        organizationId: org.id,
        amountPaidCents: 499,
        currency: 'gbp',
        stripePaymentIntentId: `pi_e2e_leaving_${randomUUID()}`,
        status: 'completed',
        purchasedAt: new Date(),
        platformFeeCents: 50,
        organizationFeeCents: 0,
        creatorPayoutCents: 449,
      })
      .returning({ id: schema.purchases.id });
    if (!sale) throw new Error('the purchase was not written');
    await dbHttp.insert(schema.entitlements).values({
      userId: buyer.user.id,
      organizationId: org.id,
      contentId: piece.id,
      source: 'content_purchase',
      sourceRef: sale.id,
    });

    const row = page.locator(`[data-content-id="${piece.id}"]`).first();

    // ── The creator deletes it: notice, not an end ───────────────────────
    await navigateToStudioPage(page, org.slug, '/content');
    await expect(row).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole('button', { name: `Actions for “${title}”` })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Delete in 30 days/ }).click();

    const leavingLine = row.locator('.row-line[data-kind="leaving"]');
    await expect(leavingLine).toContainText('1 owner emailed', {
      timeout: 30_000,
    });
    await expect(
      page.locator('.needs-chip[data-kind="leaving"]')
    ).toContainText('1 piece leaving');

    // ── The buyer sees the day it leaves, and what they may keep ─────────
    const buyerContext = await browser.newContext();
    const buyerPage = await buyerContext.newPage();
    await injectOrgCookies(buyerPage, buyer.cookie);
    await buyerPage.goto(orgUrl(E2E_BASE_URL, org.slug, `/content/${slug}`), {
      waitUntil: 'load',
    });
    const note = buyerPage.locator('.content-detail__access-note');
    await expect(note).toContainText('This leaves Revelations on');
    await expect(note).toContainText('You bought it');
    await expect(
      note.getByRole('link', { name: 'Save as PDF' })
    ).toHaveAttribute('href', new RegExp(`/content/${slug}/print$`));

    await buyerPage.goto(`${E2E_BASE_URL}/library`, { waitUntil: 'load' });
    await expect(
      buyerPage.locator('.cc', { hasText: title }).locator('.cc__access-badge')
    ).toContainText('Leaving', { timeout: 30_000 });

    // ── The creator keeps it: the notice is withdrawn ────────────────────
    await row.getByRole('button', { name: `Keep “${title}”` }).click();
    await expect(leavingLine).toHaveCount(0, { timeout: 30_000 });

    await buyerPage.goto(orgUrl(E2E_BASE_URL, org.slug, `/content/${slug}`), {
      waitUntil: 'load',
    });
    await expect(note).toContainText('This is no longer on sale.');
    await expect(note).not.toContainText('leaves Revelations');

    await buyerContext.close();
  });
});
