import { expect, test } from '@playwright/test';

/**
 * Progress Save Access Gate E2E (PR 2 — defense-in-depth)
 *
 * Covers the PR 2 row in docs/subscription-cache-audit/testing-matrix.md:
 *   "savePlaybackProgress rejects user without access"
 *   "savePlaybackProgress accepts user with access"
 *
 * Product rule (docs/subscription-cache-audit/phase-2-followup.md §4.1):
 *   A user with `cancel_at_period_end=true` whose `currentPeriodEnd` has NOT
 *   passed still has paid access, so progress POSTs succeed.
 *   Once the period ends (or a revocation key is present), progress POSTs
 *   must return 403 — preventing cancelled users from silently rebuilding
 *   "continue watching" state.
 *
 * Flow:
 *   1. Log in as viewer@test.com (ACTIVE Standard sub on studio-alpha)
 *   2. Cancel subscription at end of period — user still has access
 *   3. POST progress → STILL 200 (paid-through-period)
 *   4. Fast-forward past period end OR write revocation directly
 *   5. POST progress → 403
 *
 * ── Fixture strategy: Option C (AUTHOR-ONLY) ─────────────────────────────────
 *
 * Blocker: Codex-z1wuz — the seeded subscription has a synthetic
 * `stripeSubscriptionId`, so the real cancel flow (`/subscriptions/cancel`)
 * succeeds on the DB side but step 4 needs a way to either:
 *   (a) fast-forward the subscription period end in test DB — not yet exposed
 *   (b) write the revocation key directly — needs the test-only endpoint
 *   (c) drive `customer.subscription.deleted` via Stripe CLI — blocked by z1wuz
 *
 * Preferred unblock path: reuse the `seedRevocation()` helper from
 * streaming-revocation.spec.ts once the test-only endpoint lands.
 *
 * This spec is authored with `test.skip(true, …)` — structure is complete.
 *
 * Follows Codex-a8g6h patterns (see account-subscription-cancel.spec.ts).
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!',
};

const SEEDED_ORG_SLUG = 'studio-alpha';
const SEEDED_ORG_NAME = 'Studio Alpha';
const SEEDED_CONTENT_SLUG = 'intro-to-typescript';

const BLOCKER_MESSAGE =
  'Blocked by Codex-z1wuz — seeded subscription has synthetic stripeSubscriptionId. ' +
  'Enable by adding the same /_test/revocation endpoint referenced in ' +
  'streaming-revocation.spec.ts, then wire seedRevocation() below. See ' +
  'docs/subscription-cache-audit/phase-2-followup.md.';

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

/** Cancel the seeded viewer's subscription via the real UI flow. */
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

/** Reactivate via UI — used in teardown so the next run starts clean. */
async function reactivateViaUi(page: import('@playwright/test').Page) {
  await page.goto('/account/subscriptions');
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

/**
 * Write a revocation KV entry for this user+org. Not implemented — throws so
 * removing `test.skip` surfaces the blocker clearly. See streaming-revocation
 * spec for the preferred endpoint-based implementation.
 */
async function seedRevocation(
  _request: import('@playwright/test').APIRequestContext,
  _userId: string,
  _orgId: string,
  _reason:
    | 'subscription_deleted'
    | 'payment_failed'
    | 'refund'
    | 'admin_revoke' = 'subscription_deleted'
): Promise<void> {
  throw new Error(
    'seedRevocation() not implemented — add POST /_test/revocation to ecom-api. See Codex-z1wuz.'
  );
}

async function clearRevocation(
  _request: import('@playwright/test').APIRequestContext,
  _userId: string,
  _orgId: string
): Promise<void> {
  // Idempotent no-op until the endpoint exists.
}

test.describe
  .serial('Progress save is gated on access state', () => {
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
        const res = await request.get('http://localhost:4001/health');
        if (!res.ok())
          test.skip(true, 'Content-api worker not running on port 4001');
      } catch {
        test.skip(true, 'Content-api worker not running on port 4001');
      }
    });

    test.afterEach(async ({ request, page }) => {
      // Idempotent teardown: clear any revocation key, reactivate subscription.
      try {
        const { userId, orgId } = await page.evaluate(() => {
          const data = (
            globalThis as {
              __sveltekit_data?: {
                user?: { id?: string };
                org?: { id?: string };
              };
            }
          ).__sveltekit_data;
          return { userId: data?.user?.id ?? '', orgId: data?.org?.id ?? '' };
        });
        if (userId && orgId) {
          await clearRevocation(request, userId, orgId).catch(() => {});
        }
        await reactivateViaUi(page).catch(() => {});
      } catch {
        // swallow
      }
    });

    test('cancelled user STILL has access until period end — progress POST returns 200', async ({
      page,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await cancelViaUi(page);

      // Navigate to the content page so the client has a valid content ID.
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      const contentId = await page.evaluate(() => {
        const data = (
          globalThis as { __sveltekit_data?: { content?: { id?: string } } }
        ).__sveltekit_data;
        return data?.content?.id ?? '';
      });
      expect(contentId).toBeTruthy();

      // POST playback progress. While cancel_at_period_end is true but
      // currentPeriodEnd is still in the future, this MUST succeed.
      const res = await page.request.post(
        `${orgBase(page)}/_app/remote/saveProgress`,
        {
          data: {
            contentId,
            positionSeconds: 42,
            durationSeconds: 600,
            completed: false,
          },
        }
      );
      expect([200, 201, 204]).toContain(res.status());
    });

    test('post-period-end user (revocation present) — progress POST returns 403', async ({
      page,
      request,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await cancelViaUi(page);
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      const { userId, orgId, contentId } = await page.evaluate(() => {
        const data = (
          globalThis as {
            __sveltekit_data?: {
              user?: { id?: string };
              org?: { id?: string };
              content?: { id?: string };
            };
          }
        ).__sveltekit_data;
        return {
          userId: data?.user?.id ?? '',
          orgId: data?.org?.id ?? '',
          contentId: data?.content?.id ?? '',
        };
      });
      expect(userId).toBeTruthy();
      expect(orgId).toBeTruthy();
      expect(contentId).toBeTruthy();

      // Simulate crossing period end by writing the revocation key directly.
      await seedRevocation(request, userId, orgId, 'subscription_deleted');

      // Progress POST MUST be denied now — savePlaybackProgress performs an
      // explicit hasContentAccess() check per phase-2-followup §4.1.
      const res = await page.request.post(
        `${orgBase(page)}/_app/remote/saveProgress`,
        {
          data: {
            contentId,
            positionSeconds: 84,
            durationSeconds: 600,
            completed: false,
          },
        }
      );
      expect(res.status()).toBe(403);
    });
  });
