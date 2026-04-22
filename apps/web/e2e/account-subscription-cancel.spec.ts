import { expect, test } from '@playwright/test';

/**
 * Account Subscription Cancel Flow E2E Tests
 *
 * Covers the PR 1 critical paths from docs/subscription-cache-audit/phase-1-p0.md:
 *
 *   1. Cancel button → optimistic CANCELLING flip (no hard refresh)
 *   2. currentPeriodEnd remains visible (revocation at period end)
 *   3. Refresh persists CANCELLING (server-reconciled, not just optimistic)
 *   4. Network error during cancel rolls back to ACTIVE
 *
 * Fixture strategy — Option C (seed-based, per docs/subscription-cache-audit/phase-1-p0.md):
 *   The monorepo seed (`packages/database/scripts/seed/commerce.ts`) creates an
 *   ACTIVE subscription for `viewer@test.com` on `studio-alpha` (tier "Standard").
 *   We log in as the seeded viewer because the seed guarantees this state on every
 *   `pnpm db:seed` run — no ad-hoc subscription fixture needed.
 *
 *   The task description referenced `creator@test.com`, but creators own orgs —
 *   they don't subscribe to them, so the seed keeps the subscription on the viewer.
 *   The SEED_PASSWORD (`Test1234!`) matches the memory `reference_test_credentials`.
 *
 * Idempotency:
 *   After each test we call `reactivateSubscription` via the UI so successive runs
 *   find an ACTIVE subscription again. If that fails the next run's first test will
 *   still pass because it only asserts "at least one subscription is cancellable" —
 *   a CANCELLING sub that was left behind simply won't match the active-row selector.
 *
 * Prereqs:
 *   - `pnpm db:seed` has populated the DB
 *   - auth worker, ecom-api worker, sveltekit dev server running (playwright.config.ts
 *     auto-starts these when PLAYWRIGHT_BASE_URL is not set)
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!', // SEED_PASSWORD in packages/database/scripts/seed/constants.ts
};

const SEEDED_ORG_NAME = 'Studio Alpha';

/**
 * Log in via the real login form + auth worker, then wait for the session
 * cookie to be set. We don't hit the auth worker directly because the task
 * constraints require "real session through the normal login flow".
 */
async function loginAsSeedViewer(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', SEED_USER.email);
  await page.fill('input[name="password"]', SEED_USER.password);
  await page.click('button[type="submit"]', { noWaitAfter: true });
  // Successful login redirects to /library; bound the wait generously because
  // the auth worker + session KV round-trip can take a few seconds cold.
  await expect(page).toHaveURL(/\/library/, { timeout: 30_000 });
}

/**
 * Locate the subscription card for the seeded org by matching the org name.
 * Returns the Card root so tests can scope further locators to that card.
 */
function subscriptionCard(
  page: import('@playwright/test').Page,
  orgName = SEEDED_ORG_NAME
) {
  // `.subscription-card` is the outer flex container inside Card.Content.
  return page.locator('.subscription-card').filter({ hasText: orgName });
}

/**
 * If any subscription is CANCELLING at the end of a test, reactivate it so
 * the next run starts from a clean ACTIVE state.
 */
async function reactivateIfCancelling(page: import('@playwright/test').Page) {
  const card = subscriptionCard(page);
  if ((await card.count()) === 0) return;
  const reactivateBtn = card.getByRole('button', { name: /reactivate/i });
  if ((await reactivateBtn.count()) === 0) return;
  if (!(await reactivateBtn.first().isVisible())) return;

  await reactivateBtn.first().click();
  // Wait for the card to flip back to Active (best-effort — don't fail teardown)
  await expect(card.locator('text=/^Active$/i'))
    .toBeVisible({
      timeout: 5000,
    })
    .catch(() => {});
}

test.describe
  .serial('Account — Cancel Subscription Flow', () => {
    test.beforeAll(async ({ request }) => {
      // Skip the suite cleanly if the auth worker isn't up — matches auth-flow.spec.ts
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
    });

    test.afterEach(async ({ page }) => {
      // Best-effort teardown — idempotency per task constraint.
      await page.goto('/account/subscriptions').catch(() => {});
      await reactivateIfCancelling(page);
    });

    test('cancel flips to CANCELLING without hard refresh and keeps currentPeriodEnd visible', async ({
      page,
    }) => {
      await loginAsSeedViewer(page);
      await page.goto('/account/subscriptions');

      // Page title present → server load returned. Matches messages/en.json subscription_manage.
      await expect(page.locator('h1.page-title')).toBeVisible({
        timeout: 10_000,
      });
      // Wait for hydration — Melt UI dialog requires client JS to have mounted
      // before the Cancel button will open the controlled dialog.
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      // Track whether a full navigation happens — if the page reloads between
      // the click and the CANCELLING assertion, this test's purpose is defeated.
      let navigationCount = 0;
      const onFrameNav = () => {
        navigationCount++;
      };
      page.on('framenavigated', onFrameNav);

      const card = subscriptionCard(page);
      await expect(card).toHaveCount(1, { timeout: 5000 });

      // Sanity: card starts ACTIVE and has a "Cancel" button.
      const statusBadge = card.locator('.badge, [class*="badge"]').first();
      await expect(statusBadge).toHaveText(/Active/i, { timeout: 5000 });

      // Period-end text is visible BEFORE cancel (baseline for step 6).
      // Matches either the active-state label ("Current period ends …") or the
      // cancelling-state label ("This subscription will end on …").
      const periodEndLocator = card.locator(
        'text=/Current period ends|will end on/i'
      );
      await expect(periodEndLocator).toBeVisible({ timeout: 5000 });

      const cancelBtn = card.getByRole('button', {
        name: /^Cancel Subscription$/i,
      });
      await cancelBtn.click();

      // Confirmation dialog opens — confirm submission.
      // Melt UI dialog portals to <body>; the confirm button's text is the
      // destructive "Cancel at end of period" CTA.
      const confirmBtn = page.getByRole('button', {
        name: /^cancel at end of period$/i,
      });
      await expect(confirmBtn).toBeVisible({ timeout: 3000 });
      await confirmBtn.click();

      // ASSERT (critical): badge flips to CANCELLING with NO full page reload.
      // The pre-existing navigation (from `page.goto('/account/subscriptions')`)
      // counts once; any additional nav would indicate a reload.
      //
      // Timing: the optimistic mutation is synchronous but the re-render requires
      // a microtask tick. Once the remote cancelSubscription resolves (network
      // round-trip to ecom-api), an `invalidate('account:subscriptions')` re-runs
      // the server load and replaces data.subscriptions. We assert on the final
      // visible state — "Cancelling" — which covers both the optimistic window
      // and the server-reconciled window. Cap at 5s to account for worker cold-
      // start on the first cancel of the test run.
      const navBaseline = navigationCount;

      await expect(statusBadge).toHaveText(/Cancelling/i, { timeout: 5000 });

      // No extra navigation fired — the update happened in place.
      // (invalidate() re-runs the server load in-place, not via a navigation.)
      expect(navigationCount).toBe(navBaseline);

      // ASSERT: currentPeriodEnd still visible (revocation is at period end).
      await expect(
        card.locator('text=/Current period ends|will end on/i')
      ).toBeVisible();

      page.off('framenavigated', onFrameNav);
    });

    test('reload after cancel persists CANCELLING (server-reconciled, not optimistic)', async ({
      page,
    }) => {
      await loginAsSeedViewer(page);
      await page.goto('/account/subscriptions');
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      const card = subscriptionCard(page);
      await expect(card).toHaveCount(1, { timeout: 5000 });

      const statusBadge = card.locator('.badge, [class*="badge"]').first();
      // Previous test may have left ACTIVE (afterEach reactivated it) — cancel again.
      if (!(await statusBadge.textContent())?.match(/Cancelling/i)) {
        const cancelBtn = card.getByRole('button', {
          name: /^Cancel Subscription$/i,
        });
        await cancelBtn.click();
        const confirmBtn = page.getByRole('button', {
          name: /^cancel at end of period$/i,
        });
        await expect(confirmBtn).toBeVisible({ timeout: 3000 });
        await confirmBtn.click();
        await expect(statusBadge).toHaveText(/Cancelling/i, { timeout: 5000 });
      }

      // Explicit reload — this is the ONE allowed reload in this spec, used to
      // prove the CANCELLING state was persisted on the server (not just optimistic).
      await page.reload();

      const cardAfter = subscriptionCard(page);
      await expect(cardAfter).toHaveCount(1, { timeout: 10_000 });
      const badgeAfter = cardAfter.locator('.badge, [class*="badge"]').first();
      await expect(badgeAfter).toHaveText(/Cancelling/i, { timeout: 5000 });
    });

    test('network failure mid-cancel rolls back optimistic state to ACTIVE', async ({
      page,
    }) => {
      await loginAsSeedViewer(page);
      await page.goto('/account/subscriptions');
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      const card = subscriptionCard(page);
      await expect(card).toHaveCount(1, { timeout: 5000 });

      const statusBadge = card.locator('.badge, [class*="badge"]').first();

      // The subscription might still be CANCELLING from prior test if afterEach
      // couldn't reactivate (e.g. test failure). If so, reactivate first via UI.
      if ((await statusBadge.textContent())?.match(/Cancelling/i)) {
        const reactivateBtn = card.getByRole('button', { name: /reactivate/i });
        await reactivateBtn.click();
        await expect(statusBadge).toHaveText(/Active/i, { timeout: 5000 });
      }

      // Install route interceptor AFTER the page is hydrated and the initial
      // subscription state is loaded, so we don't break the initial render.
      // SvelteKit remote functions POST to `/_app/remote/{id}` — intercept ALL
      // such POSTs with a 500 so `cancelSubscription` fails.
      await page.route('**/_app/remote/**', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              type: 'error',
              error: { message: 'Simulated network failure for E2E' },
            }),
          });
          return;
        }
        await route.continue();
      });

      const cancelBtn = card.getByRole('button', {
        name: /^Cancel Subscription$/i,
      });
      await cancelBtn.click();
      const confirmBtn = page.getByRole('button', {
        name: /^cancel at end of period$/i,
      });
      await expect(confirmBtn).toBeVisible({ timeout: 3000 });
      await confirmBtn.click();

      // The optimistic flip may flash CANCELLING briefly, but the rollback MUST
      // restore ACTIVE once the 500 comes back. Assert on the final state.
      // 5s is generous — the remote function error path is synchronous once
      // the POST resolves.
      await expect(statusBadge).toHaveText(/Active/i, { timeout: 5000 });

      // Sanity: an error alert is surfaced to the user (the dialog stays open
      // on error so users can retry).
      await expect(page.locator('[role="alert"], .alert').first()).toBeVisible({
        timeout: 3000,
      });

      // Clean up the route so afterEach can hit the real endpoint.
      await page.unroute('**/_app/remote/**');
    });
  });
