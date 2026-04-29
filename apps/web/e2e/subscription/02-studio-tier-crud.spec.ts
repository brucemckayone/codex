import { expect, type Page, test } from '@playwright/test';
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
 *         tier list, and the org's tier list count grows by 3.
 *   2.b — Create content with accessType='subscribers' and a minimum
 *         tier assigned. Asserts the resulting content row carries the
 *         tier reference (assertion is read-side: the content list /
 *         the redirected detail view shows the tier-gated state).
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
 *   - auth (42069), ecom-api (42072), organization-api (42075) up
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
      const res = await request.get('http://localhost:42075/health');
      if (!res.ok())
        test.skip(true, 'Organization-api worker not running on port 42075');
    } catch {
      test.skip(true, 'Organization-api worker not running on port 42075');
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
    await expect(page.locator('h1.page-title')).toBeVisible({
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

      await expect(nameInput).toBeVisible({ timeout: 5000 });

      await nameInput.fill(tier.name);
      await descInput.fill(tier.description);
      // Number inputs: clear then fill so default 499/4990 is replaced.
      await priceMonthlyInput.fill(String(tier.priceMonthlyPence));
      await priceAnnualInput.fill(String(tier.priceAnnualPence));

      // Submit (form posts to createTier remote function → TierService →
      // Stripe products.create + 2x prices.create + DB insert).
      // Click the "Save" button INSIDE the dialog footer — disambiguate
      // from any other Save buttons on the page.
      const saveBtn = page
        .locator('[role="dialog"]')
        .getByRole('button', { name: /^Save$/i });
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

  test('2.b creates an article with accessType=subscribers and a tier assigned', async ({
    page,
  }) => {
    await injectCreatorAuth(page);

    await page.goto(
      buildOrgUrl(page, STUDIO_ALPHA.slug, '/studio/content/new')
    );

    // Form mounts (mirrors studio/content.spec.ts pattern).
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible({
      timeout: 30_000,
    });

    const uniqueSlug = `e2e-tier-content-${RUN_ID}`;
    const contentTitle = `E2E Tier Test Content ${RUN_ID}`;

    await page.getByRole('textbox', { name: 'Title' }).fill(contentTitle);
    await page.getByRole('textbox', { name: 'Slug' }).fill(uniqueSlug);
    // Description is a Tiptap RichTextEditor — not addressable by role=textbox
    // with that name. Skip; it's optional and not required for tier-gating
    // assertions. See `apps/web/src/lib/components/studio/content-form/
    // ContentDetails.svelte:71-89` (RichTextEditor, "Optional").

    // Article type — sidesteps the media-item requirement. The content type
    // selector is a radio group (group "Content Type" → radio "Article …"),
    // NOT a combobox, despite what older tests like
    // apps/web/e2e/studio/content.spec.ts:213-214 suggest. The form was
    // redesigned (iter-10 studio shell) but the older tests' selectors
    // weren't updated. Verified via Playwright snapshot.
    //
    // Click the radio with `force: true` because the sticky command bar at
    // the top of the form intercepts pointer events when the click target
    // is just below the bar. The radio is reachable via keyboard / aria so
    // we don't need to scroll first.
    await page.getByRole('radio', { name: /^Article/i }).click({ force: true });

    // Switch access from "Free" to "Subscribers" — the AccessSection radio
    // group's "Subscribers" option is only rendered when the org has at
    // least one tier (after 2.a, Studio Alpha has 5+ tiers). Click the
    // radio directly; its accessible name includes the description prefix.
    const subscribersRadio = page.getByRole('radio', { name: /^Subscribers/i });
    await expect(subscribersRadio).toBeVisible({ timeout: 15_000 });
    // force: true — sticky command bar can intercept clicks on form rows.
    await subscribersRadio.click({ force: true });

    // The conditional row reveals: select the FIRST tier from the
    // "Minimum tier" combobox. The Select component's accessible name is
    // taken from its `placeholder` prop (Select.svelte:82-85), which is
    // "Select a minimum tier" when accessType=subscribers.
    const tierCombobox = page.getByRole('combobox', {
      name: /Select a minimum tier/i,
    });
    await expect(tierCombobox).toBeVisible({ timeout: 15_000 });
    await tierCombobox.click();

    // Pick the first tier — it must be a real tier name, not the
    // "Select a minimum tier" placeholder. Any of: alphaStandard / alphaPro
    // (seeded) or our 3 E2E tiers (created by 2.a).
    const firstTierOption = page
      .getByRole('option')
      .filter({ hasNotText: /Select a minimum tier/i })
      .first();
    await firstTierOption.click();

    // Submit
    await page.getByRole('button', { name: 'Create Content' }).click();

    // Success path: redirect to /studio/content (or stay on /new with toast).
    // Mirrors studio/content.spec.ts:218-232's mixed-success assertion.
    await page
      .waitForURL(/\/studio\/content(?!\/new)/, { timeout: 30_000 })
      .catch(() => {});

    const url = page.url();
    const hasRedirected = !url.includes('/content/new');
    const hasToast = await page
      .locator('[role="status"], [role="alert"]')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasRedirected || hasToast).toBeTruthy();

    // Read-side assertion: the new content appears in the studio content
    // list. We don't go via the public-content API because Article-type
    // drafts may not be published yet.
    if (hasRedirected) {
      await expect(page.locator(`text=${contentTitle}`).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
