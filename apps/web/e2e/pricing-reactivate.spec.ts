import { expect, test } from '@playwright/test';

/**
 * Pricing Page — CANCELLING warning + Reactivate flow E2E (PR 2)
 *
 * Covers the PR 2 defense-in-depth UX for the org pricing page:
 *   - A CANCELLING subscription surfaces the "Plan ends {date}" warning badge
 *   - The user's current tier card swaps its CTA from "Current plan" to
 *     "Reactivate plan"
 *   - Clicking "Reactivate plan" optimistically flips back to "Current plan"
 *     WITHOUT a hard page reload (mirrors the PR 1 cancel → CANCELLING rule)
 *   - Reload persists the optimistic state (server-reconciled, not just UI)
 *
 * Flow:
 *   1. Log in as viewer@test.com (ACTIVE Standard sub on studio-alpha)
 *   2. Cancel subscription via /account/subscriptions
 *   3. Navigate to `${org}/pricing`
 *   4. Assert: Standard tier card shows data-status="cancelling" badge with
 *      the "Plan ends …" copy
 *   5. Click "Reactivate plan" — assert the status badge flips to active and
 *      the CTA flips back to "Current plan" WITHOUT a page reload
 *   6. Reload — confirm ACTIVE state persisted on the server
 *
 * ── Fixture strategy: Option C (AUTHOR-ONLY) ─────────────────────────────────
 *
 * Blocker: Codex-z1wuz — `/subscriptions/cancel` and `/subscriptions/reactivate`
 * call out to Stripe with the synthetic `stripeSubscriptionId`, which 404s.
 * Until z1wuz ships, these calls fail and the UI transitions won't happen.
 *
 * When unblocked, no test-only endpoint is needed for THIS spec — the real
 * cancel/reactivate remote functions work end-to-end against the test-mode
 * Stripe account once the seed fixture is corrected.
 *
 * This spec is authored with `test.skip(true, …)`. Delete the `test.skip`
 * lines once z1wuz lands.
 *
 * Follows Codex-a8g6h patterns (see account-subscription-cancel.spec.ts):
 *   - baseURL from playwright.config.ts
 *   - real login flow
 *   - health-probe bail-outs in beforeAll
 *   - idempotent teardown — reactivate if cancelling
 *   - NO page.reload() in the assertion path for the "without hard refresh" claim
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!',
};

const SEEDED_ORG_SLUG = 'studio-alpha';
const SEEDED_ORG_NAME = 'Studio Alpha';

const BLOCKER_MESSAGE =
  'Blocked by Codex-z1wuz — seeded subscription has synthetic stripeSubscriptionId, so ' +
  '/subscriptions/cancel + /subscriptions/reactivate fail when they call Stripe. Fix the ' +
  'seed to use a real Stripe test-mode subscription and these tests should run as-is.';

async function loginAsSeedViewer(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', SEED_USER.email);
  await page.fill('input[name="password"]', SEED_USER.password);
  await page.click('button[type="submit"]', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/library/, { timeout: 30_000 });
}

function orgBase(
  page: import('@playwright/test').Page,
  slug = SEEDED_ORG_SLUG
) {
  const base = new URL(page.url());
  return `${base.protocol}//${slug}.${base.host}`;
}

function subscriptionCard(
  page: import('@playwright/test').Page,
  orgName = SEEDED_ORG_NAME
) {
  return page.locator('.subscription-card').filter({ hasText: orgName });
}

/** Cancel via the /account/subscriptions UI. */
async function cancelViaUi(page: import('@playwright/test').Page) {
  await page.goto('/account/subscriptions');
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  const card = subscriptionCard(page);
  await expect(card).toHaveCount(1, { timeout: 5000 });
  const cancelBtn = card.getByRole('button', {
    name: /^Cancel Subscription$/i,
  });
  await cancelBtn.click();
  const confirmBtn = page.getByRole('button', {
    name: /^cancel at end of period$/i,
  });
  await expect(confirmBtn).toBeVisible({ timeout: 3000 });
  await confirmBtn.click();
  const badge = card.locator('.badge, [class*="badge"]').first();
  await expect(badge).toHaveText(/Cancelling/i, { timeout: 5000 });
}

/** Reactivate via /account/subscriptions (teardown helper). */
async function reactivateViaAccountUi(page: import('@playwright/test').Page) {
  await page.goto('/account/subscriptions').catch(() => {});
  const card = subscriptionCard(page);
  if ((await card.count()) === 0) return;
  const btn = card.getByRole('button', { name: /reactivate/i });
  if ((await btn.count()) === 0) return;
  if (!(await btn.first().isVisible())) return;
  await btn.first().click();
  await expect(card.locator('text=/^Active$/i'))
    .toBeVisible({ timeout: 5000 })
    .catch(() => {});
}

test.describe
  .serial('Org pricing page — CANCELLING warning + reactivate', () => {
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
    });

    test.afterEach(async ({ page }) => {
      // Idempotent teardown — never fail teardown on error.
      await reactivateViaAccountUi(page).catch(() => {});
    });

    test('CANCELLING subscription renders "Plan ends …" warning badge on tier card', async ({
      page,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await cancelViaUi(page);

      // Go to the org pricing page — URL built from baseURL so CI honours
      // PLAYWRIGHT_BASE_URL.
      await page.goto(`${orgBase(page)}/pricing`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      // Assert: the CURRENT tier card surfaces the cancelling status badge.
      // The card uses `data-testid="tier-status-badge"` with `data-status`.
      const cancellingBadge = page.locator(
        '[data-testid="tier-status-badge"][data-status="cancelling"]'
      );
      await expect(cancellingBadge).toBeVisible({ timeout: 10_000 });

      // Copy check — the badge reads "Plan ends {date}" (pricing_plan_ends_on
      // message; matches whenever currentPeriodEnd is present).
      await expect(cancellingBadge).toHaveText(/plan ends|ends/i);

      // And the CTA switched to "Reactivate plan".
      await expect(
        page.locator('[data-testid="tier-cta-reactivate"]')
      ).toBeVisible();
      // While cancelling, "Current plan" disabled CTA is hidden (the tier card
      // renders EITHER the reactivate branch OR the current-plan branch).
      await expect(
        page.locator('[data-testid="tier-cta-current"]')
      ).toHaveCount(0);
    });

    test('clicking "Reactivate plan" flips to "Current plan" without a hard refresh', async ({
      page,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await cancelViaUi(page);
      await page.goto(`${orgBase(page)}/pricing`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      const reactivateBtn = page.locator('[data-testid="tier-cta-reactivate"]');
      await expect(reactivateBtn).toBeVisible({ timeout: 10_000 });

      // Track full-page navigations. A reload would fire `framenavigated` with
      // the same URL — we assert zero navigations between click and the CTA
      // flip so the "without hard refresh" claim is load-bearing.
      let navCount = 0;
      const onNav = () => {
        navCount++;
      };
      page.on('framenavigated', onNav);
      const navBaseline = navCount;

      await reactivateBtn.click();

      // CTA flips back to "Current plan" — disabled secondary button.
      await expect(
        page.locator('[data-testid="tier-cta-current"]')
      ).toBeVisible({ timeout: 5000 });
      // "Reactivate" CTA disappears.
      await expect(
        page.locator('[data-testid="tier-cta-reactivate"]')
      ).toHaveCount(0);
      // Status badge swaps to active.
      await expect(
        page.locator('[data-testid="tier-status-badge"][data-status="active"]')
      ).toBeVisible();

      // Critical: no full navigation happened. The reactivate remote function
      // calls invalidate('account:subscriptions') (and the org layout's cache)
      // which re-runs the server load in place.
      expect(navCount).toBe(navBaseline);

      page.off('framenavigated', onNav);
    });

    test('reload after reactivate persists ACTIVE state (server-reconciled)', async ({
      page,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await cancelViaUi(page);
      await page.goto(`${orgBase(page)}/pricing`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      const reactivateBtn = page.locator('[data-testid="tier-cta-reactivate"]');
      await expect(reactivateBtn).toBeVisible({ timeout: 10_000 });
      await reactivateBtn.click();
      await expect(
        page.locator('[data-testid="tier-cta-current"]')
      ).toBeVisible({ timeout: 5000 });

      // This reload is the ONE allowed reload in this spec — it proves the
      // ACTIVE state was persisted on the server, not just optimistic UI.
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      await expect(
        page.locator('[data-testid="tier-status-badge"][data-status="active"]')
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('[data-testid="tier-cta-reactivate"]')
      ).toHaveCount(0);
    });
  });
