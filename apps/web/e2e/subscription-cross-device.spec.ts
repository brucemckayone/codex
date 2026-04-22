import { expect, test } from '@playwright/test';

/**
 * Cross-Device Subscription Visibility-Change E2E Tests
 *
 * Covers the PR 1 cross-device row in docs/subscription-cache-audit/testing-matrix.md:
 *   "cancel A, state visible on B after visibility change"
 *
 * Flow:
 *   Tab A: log in as viewer@test.com, go to /account/subscriptions, cancel the
 *          seeded Studio Alpha subscription.
 *   Tab B: log in as the same user in a second browser context (simulating a
 *          second device / second tab that doesn't share the first context's
 *          in-memory state), navigate to the Studio Alpha /pricing page where
 *          the effective subscription status is rendered on the user's current
 *          tier card.
 *   Tab B: dispatch a `visibilitychange` event. The org layout listens for this
 *          and triggers `invalidate('cache:org-versions')`, which re-runs the
 *          server load and re-fetches subscription context. The user's tier
 *          card should flip from "Current plan" (active) to the "Cancelling" /
 *          "Reactivate plan" affordance.
 *
 * Fixture strategy (same as account-subscription-cancel.spec.ts):
 *   Use the seeded viewer@test.com user, who starts each `pnpm db:seed` run with
 *   an ACTIVE subscription to studio-alpha.
 *
 * Idempotency: afterEach reactivates if CANCELLING so the next run starts clean.
 *
 * Prereqs (matches playwright.config.ts webServer list):
 *   - auth (42069), ecom-api (42072), organization-api (42075), content-api (4001)
 *   - SvelteKit dev server on lvh.me:5173 (wildcard DNS → 127.0.0.1)
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!',
};

const SEEDED_ORG_SLUG = 'studio-alpha';
const SEEDED_ORG_NAME = 'Studio Alpha';

async function loginAsSeedViewer(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', SEED_USER.email);
  await page.fill('input[name="password"]', SEED_USER.password);
  await page.click('button[type="submit"]', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/library/, { timeout: 30_000 });
}

function subscriptionCard(
  page: import('@playwright/test').Page,
  orgName = SEEDED_ORG_NAME
) {
  return page.locator('.subscription-card').filter({ hasText: orgName });
}

test.describe('Cross-device subscription sync via visibilitychange', () => {
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
  });

  test.afterEach(async ({ browser }) => {
    // Best-effort teardown in a fresh context — the test's own contexts are
    // closed automatically by Playwright at test end. We open a short-lived
    // context to put the subscription back to ACTIVE if it was left CANCELLING.
    const cleanupCtx = await browser.newContext();
    const cleanupPage = await cleanupCtx.newPage();
    try {
      await loginAsSeedViewer(cleanupPage);
      await cleanupPage.goto('/account/subscriptions');
      const card = subscriptionCard(cleanupPage);
      if ((await card.count()) > 0) {
        const reactivateBtn = card.getByRole('button', { name: /reactivate/i });
        if (
          (await reactivateBtn.count()) > 0 &&
          (await reactivateBtn.first().isVisible())
        ) {
          await reactivateBtn.first().click();
          await expect(card.locator('text=/^Active$/i'))
            .toBeVisible({
              timeout: 5000,
            })
            .catch(() => {});
        }
      }
    } catch {
      // Never fail the test in teardown.
    } finally {
      await cleanupCtx.close();
    }
  });

  test('Tab B reflects CANCELLING after visibilitychange following Tab A cancel', async ({
    browser,
  }) => {
    // ── Tab A: log in and cancel ───────────────────────────────────────────
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await loginAsSeedViewer(pageA);
    await pageA.goto('/account/subscriptions');
    await pageA.waitForLoadState('networkidle', { timeout: 10_000 });

    const cardA = subscriptionCard(pageA);
    await expect(cardA).toHaveCount(1, { timeout: 10_000 });
    const badgeA = cardA.locator('.badge, [class*="badge"]').first();
    // If it's not active (e.g. the previous run left it cancelling and teardown
    // failed), reactivate first so the test starts from a known state.
    if (!(await badgeA.textContent())?.match(/Active/i)) {
      const reactivateBtn = cardA.getByRole('button', { name: /reactivate/i });
      await reactivateBtn.click();
      await expect(badgeA).toHaveText(/Active/i, { timeout: 5000 });
    }

    // ── Tab B: open BEFORE the cancel so it captures the initial ACTIVE state
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginAsSeedViewer(pageB);

    // Pricing page on the org subdomain — renders the user's effective tier
    // status via the layout's streamed subscriptionContext. Root-relative
    // path per CLAUDE.md rule (slug is in hostname, not path).
    // Build URL from baseURL so we honour PLAYWRIGHT_BASE_URL in CI.
    const baseURL = new URL(pageB.url());
    const orgBase = `${baseURL.protocol}//${SEEDED_ORG_SLUG}.${baseURL.host}`;
    await pageB.goto(`${orgBase}/pricing`);
    await pageB.waitForLoadState('networkidle', { timeout: 15_000 });

    // Wait for tiers + user's current-plan CTA to render. The "Current plan"
    // button appears on the tier that the user is currently subscribed to.
    // We bound loosely because subscriptionContext is streamed.
    await expect(
      pageB.getByRole('button', { name: /current plan/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    // "Reactivate plan" must NOT be present yet — baseline.
    await expect(
      pageB.getByRole('button', { name: /reactivate plan/i })
    ).toHaveCount(0);

    // ── Tab A: perform the cancel ──────────────────────────────────────────
    const cancelBtn = cardA.getByRole('button', {
      name: /^Cancel Subscription$/i,
    });
    await cancelBtn.click();
    const confirmBtnA = pageA.getByRole('button', {
      name: /^cancel at end of period$/i,
    });
    await expect(confirmBtnA).toBeVisible({ timeout: 3000 });
    await confirmBtnA.click();
    await expect(badgeA).toHaveText(/Cancelling/i, { timeout: 10_000 });

    // ── Tab B: simulate tab return via visibilitychange ────────────────────
    // The org layout listens for visibilitychange and, on the first fire after
    // mount (lastVersionCheck = 0), calls invalidate('cache:org-versions').
    // That invalidate re-runs the layout server load which reads the fresh
    // subscription context from KV/DB and re-renders the tier card.
    //
    // We dispatch the event on `document` (per the layout's listener) after
    // the cancel has been committed on the server. Playwright's page does
    // NOT change visibility on its own — this `evaluate` makes the layout
    // behave as if the user just refocused the tab.
    await pageB.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Assert: the Reactivate plan button appears (Tab B has caught up).
    // Within 2s per task constraint. The server load re-runs and the CTA flips.
    await expect(
      pageB.getByRole('button', { name: /reactivate plan/i }).first()
    ).toBeVisible({ timeout: 2000 });

    await ctxA.close();
    await ctxB.close();
  });
});
