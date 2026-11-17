import { expect, type Page, test } from '@playwright/test';
import {
  chooseAccess,
  goToPublishStep,
  navigateToStudioPage,
  startDraft,
  waitForEditorSave,
} from '../helpers/studio';
import {
  archiveTestStripeProducts,
  buildOrgUrl,
  captureSeededCreatorCookies,
  STUDIO_ALPHA,
} from '../helpers/subscription';

/**
 * Studio Tier CRUD + Assign Tier to Content
 *
 * Covers bead steps 2-3 of Codex-x0pa.
 *
 *   2.a — Create 3 tiers (Bronze / Silver / Gold) via the studio
 *         monetisation dialog. Asserts each appears in the rendered
 *         tier list, and the org's tier list count grows by 3. The dialog
 *         asks "Include everything from…" (Codex-2hxff.91): the dearest
 *         existing tier is chosen by default; Bronze picks "Nothing", the
 *         others keep the default copy.
 *   2.b — Start an article in the editor (Codex-a6ofh.2), and on its
 *         Publish step choose Subscribers and tick a tier in the shared tier
 *         picker. With nothing ticked the picker says the item is closed to
 *         subscribers. The step saves as it changes: read-side, the piece
 *         read afresh holds both.
 *
 * Fixture:
 *   - Seeded creator@test.com (Studio Alpha owner). Connect is
 *     genuinely active in real Stripe (commerce.ts:77-120 →
 *     activateConnectAccount → charges_enabled=true). This is the only
 *     way to drive `TierService.createTier()` to completion without
 *     duplicating 50 lines of seed activation logic — see U-02 in
 *     docs/triage/iter-010-x0pa-unclears.md.
 *
 * Cleanup:
 *   - afterAll archives the Stripe Products created during this run by
 *     name prefix. TierService does NOT support custom metadata on
 *     products it creates (see packages/subscription/src/services/
 *     tier-service.ts:212-220, which hard-codes
 *     metadata.codex_organization_id + codex_type='subscription_tier'),
 *     so name-prefix matching is the only reliable identifier.
 *
 *   - The 3 tier rows in DB are NOT cleaned up — Studio Alpha
 *     accumulates them across runs. Acceptable: tier names are
 *     timestamped so each run is unique, and the seed's
 *     `cleanupStripeSeedObjects` archives the Stripe side. A future
 *     iteration could add a DB teardown.
 *
 * Prereqs:
 *   - auth (42069), ecom-api (42072), organization-api (42071) up
 *   - Seeded DB with `pnpm db:seed` (STRIPE_SECRET_KEY set so Studio
 *     Alpha has Connect active + alphaStandard/alphaPro tier rows)
 */

const RUN_ID = String(Date.now());
const TIER_NAME_PREFIX = `E2E Test Tier ${RUN_ID} `;

interface TestTier {
  name: string;
  description: string;
  /** £ value entered into the price input (number type, expressed in pence per the form label) */
  priceMonthlyPence: number;
  priceAnnualPence: number;
}

const TEST_TIERS: TestTier[] = [
  {
    name: `${TIER_NAME_PREFIX}Bronze`,
    description: 'E2E Bronze tier',
    priceMonthlyPence: 499,
    priceAnnualPence: 4990,
  },
  {
    name: `${TIER_NAME_PREFIX}Silver`,
    description: 'E2E Silver tier',
    priceMonthlyPence: 999,
    priceAnnualPence: 9990,
  },
  {
    name: `${TIER_NAME_PREFIX}Gold`,
    description: 'E2E Gold tier',
    priceMonthlyPence: 1999,
    priceAnnualPence: 19990,
  },
];

test.describe('Studio Tier CRUD', () => {
  // Serial: tests share a sequence (create 3 tiers → assign one to content).
  // Parallel mode would also blow the auth rate limit (see spec 01).
  test.describe.configure({ mode: 'serial' });

  // Capture the seeded creator's cookies ONCE in beforeAll — sign-in is
  // rate-limited (5/15min/IP). Each test injects them via addCookies.
  let creatorCookies: Awaited<ReturnType<typeof captureSeededCreatorCookies>>;

  async function injectCreatorAuth(page: Page) {
    await page.context().clearCookies();
    await page.context().addCookies(creatorCookies);
  }

  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('http://localhost:42069/health');
      if (!res.ok()) test.skip(true, 'Auth worker not running on port 42069');
    } catch {
      test.skip(true, 'Auth worker not running on port 42069');
    }
    try {
      const res = await request.get('http://localhost:42072/health');
      if (!res.ok())
        test.skip(true, 'Ecom-api worker not running on port 42072');
    } catch {
      test.skip(true, 'Ecom-api worker not running on port 42072');
    }
    try {
      const res = await request.get('http://localhost:42071/health');
      if (!res.ok())
        test.skip(true, 'Organization-api worker not running on port 42071');
    } catch {
      test.skip(true, 'Organization-api worker not running on port 42071');
    }

    // One-shot login — captures cookies for both tests.
    creatorCookies = await captureSeededCreatorCookies();
  });

  test.afterAll(async () => {
    // Best-effort archive of the 3 Stripe test-mode Products this run created.
    // Logs the count to stdout for visibility but never fails the suite.
    const result = await archiveTestStripeProducts({
      namePrefix: TIER_NAME_PREFIX,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[02-studio-tier-crud] archived ${result.archived} test Stripe products (prefix: ${TIER_NAME_PREFIX})`
    );
  });

  test('2.a creates 3 subscription tiers via the studio monetisation dialog', async ({
    page,
  }) => {
    await injectCreatorAuth(page);

    // Capture the existing tier count BEFORE we add new ones — Studio Alpha
    // already has alphaStandard + alphaPro from the seed.
    await page.goto(
      buildOrgUrl(page, STUDIO_ALPHA.slug, '/studio/monetisation')
    );
    // Generous timeout: studio layout cold-start can be 15s+ when SvelteKit
    // dev server is freshly started.
    await expect(page.locator('h1.page-header__title')).toBeVisible({
      timeout: 30_000,
    });

    // Wait for the "Connected" status — confirms Connect is active and the
    // tier-create dialog will be reachable. (TierService gates create on
    // requireActiveConnect — without this, the API would reject the call.)
    await expect(page.locator('text=/^Connected$/i').first()).toBeVisible({
      timeout: 30_000,
    });

    // Wait for tier list to settle. The list either shows existing rows
    // (alphaStandard, alphaPro after seed) OR the empty-state — either
    // way, the loading skeleton should be gone before we proceed.
    await page.waitForTimeout(1000); // allow client query to resolve

    // Count existing tiers (rows with .tier-item class) to baseline.
    const initialTierCount = await page.locator('.tier-item').count();

    // A short screen, so the dialog's body is taller than its panel (85vh)
    // and Save is only reachable by scrolling the body (Codex-2yvc8).
    await page.setViewportSize({ width: 1280, height: 600 });

    for (const tier of TEST_TIERS) {
      // Open create dialog
      await page
        .getByRole('button', { name: /^Create Tier$/i })
        .first()
        .click();

      // Dialog form fields
      const nameInput = page.locator('input#tier-name');
      const descInput = page.locator('textarea#tier-description');
      const priceMonthlyInput = page.locator('input#tier-price-monthly');
      const priceAnnualInput = page.locator('input#tier-price-annual');
      // The "Save" button INSIDE the dialog footer — disambiguate from any
      // other Save buttons on the page.
      const saveBtn = page
        .locator('[role="dialog"]')
        .getByRole('button', { name: /^Save$/i });

      await expect(nameInput).toBeVisible({ timeout: 5000 });

      if (tier === TEST_TIERS[0]) {
        // Reach Save the way a person does: the wheel over the body. click()
        // and fill() scroll in code, which gets through the panel's
        // overflow: hidden, so they never saw a clipped footer (Codex-2yvc8).
        // This runs before any of them can scroll the dialog for us.
        await expect(
          page.locator('[data-testid="tier-copy-from"]')
        ).toBeVisible();
        const body = await page
          .locator('[role="dialog"] .dialog-body')
          .boundingBox();
        expect(body).not.toBeNull();
        await page.mouse.move(body!.x + body!.width / 2, body!.y + 40);
        await page.mouse.wheel(0, 2000);
        await expect(saveBtn).toBeInViewport();
      }

      await nameInput.fill(tier.name);
      await descInput.fill(tier.description);
      // Number inputs: clear then fill so default 499/4990 is replaced.
      await priceMonthlyInput.fill(String(tier.priceMonthlyPence));
      await priceAnnualInput.fill(String(tier.priceAnnualPence));

      // "Include everything from…": Studio Alpha already has tiers, so the
      // field is there, with the dearest existing tier chosen by default
      // (owner decision U3) and "Nothing" last.
      const copyFrom = page.locator('[data-testid="tier-copy-from"]');
      await expect(copyFrom).toBeVisible();
      const checked = copyFrom.locator('input[name="tier-copy-from"]:checked');
      await expect(checked).toHaveCount(1);
      await expect(checked).not.toHaveValue('');
      if (tier === TEST_TIERS[0]) {
        // Bronze starts empty; the others copy the dearest tier. Click the
        // visible card, as a user would: the radio inside it is `.sr-only`,
        // and a forced check on that 1px box failed with "Element is outside
        // of the viewport" (Codex-elg0b).
        // `has` is queried from inside each label, so it is built off `page`.
        const nothing = 'input[name="tier-copy-from"][value=""]';
        await copyFrom
          .locator('label.choice-card')
          .filter({ has: page.locator(nothing) })
          .click();
        await expect(copyFrom.locator(nothing)).toBeChecked();
      }

      // Submit (form posts to createTier remote function → TierService →
      // Stripe products.create + 2x prices.create + DB insert).
      await saveBtn.click();

      // The dialog closes on success; assert the new tier name appears in
      // the rendered tier list. Stripe creates take ~2-5s for products +
      // prices; budget 30s to be safe.
      await expect(
        page.locator('.tier-item').filter({ hasText: tier.name }).first()
      ).toBeVisible({ timeout: 30_000 });
    }

    // Final assertion: tier list grew by exactly 3.
    const finalTierCount = await page.locator('.tier-item').count();
    expect(finalTierCount).toBe(initialTierCount + TEST_TIERS.length);
  });

  test('2.b gates a new article to subscribers, with a tier ticked, on the Publish step', async ({
    page,
  }) => {
    await injectCreatorAuth(page);

    const contentTitle = `E2E Tier Test Content ${RUN_ID}`;
    // An article sidesteps the media. The first thing added makes its row.
    const contentId = await startDraft(
      page,
      STUDIO_ALPHA.slug,
      'written',
      contentTitle
    );
    await goToPublishStep(page);

    // The Subscribers option is the subscribers-only switch; the shared tier
    // picker (Codex-2hxff.91) says which tiers. Studio Alpha's Connect is
    // active and it has tiers (seeded, plus 2.a's), so it can be chosen.
    await chooseAccess(page, /^Subscribers/);
    await waitForEditorSave(page);

    // With nothing ticked the item is CLOSED to subscribers, and says so.
    const picker = page.getByRole('group', { name: 'Tiers that include this' });
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="tier-closed"]')).toBeVisible();

    // Tick the first (cheapest) tier: one of alphaStandard / alphaPro
    // (seeded) or 2.a's three.
    const firstTier = picker.locator('button.tier').first();
    const tierName = (await firstTier.innerText()).trim();
    await firstTier.click();
    await expect(firstTier).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="tier-closed"]')).toHaveCount(0);
    // The Publish step saves as it changes: wait for that save to land.
    await waitForEditorSave(page);

    // Read-side: the piece, read afresh, holds both. (Not `buildOrgUrl`:
    // it prefixes the slug to the page's host, already the org's here.)
    await navigateToStudioPage(
      page,
      STUDIO_ALPHA.slug,
      `/content/${contentId}/edit?step=publish`
    );
    await expect(page.getByRole('radio', { name: /^Subscribers/ })).toBeChecked(
      {
        timeout: 30_000,
      }
    );
    await expect(
      page
        .getByRole('group', { name: 'Tiers that include this' })
        .locator('button.tier', { hasText: tierName })
        .first()
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  });
});
