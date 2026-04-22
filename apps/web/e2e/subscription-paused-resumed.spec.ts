import { expect, test } from '@playwright/test';

/**
 * Subscription Paused → Resumed Roundtrip E2E (PR 2 — defense-in-depth)
 *
 * Covers the PR 2 row in docs/subscription-cache-audit/testing-matrix.md:
 *   "Paused → resumed roundtrip"
 *   "subscription.paused writes revocation + invalidates"
 *   "subscription.resumed clears revocation + invalidates"
 *
 * Flow:
 *   1. Log in as seeded viewer@test.com (ACTIVE Standard sub on studio-alpha)
 *   2. Simulate `customer.subscription.paused` (Stripe CLI trigger OR
 *      direct test-only endpoint that calls `handleSubscriptionPaused`)
 *   3. Attempt to mint a streaming URL → expect 403 (revocation present)
 *   4. Simulate `customer.subscription.resumed`
 *   5. Attempt to mint a streaming URL → expect 200 (revocation cleared)
 *
 * ── Fixture strategy: Option C (AUTHOR-ONLY) ─────────────────────────────────
 *
 * Blocker: Codex-z1wuz — same synthetic `stripeSubscriptionId` issue as the
 * other PR 2 specs. `stripe trigger customer.subscription.paused` will
 * dispatch an event but the ecom-api webhook handler will fail to match it
 * to the seeded subscription row.
 *
 * Preferred unblock path (mirrors streaming-revocation.spec.ts):
 *   A. Test-only endpoint: POST `/_test/subscription-event` with
 *      `{ type: 'paused' | 'resumed', userId, orgId }` that directly invokes
 *      `handleSubscriptionPaused` / `handleSubscriptionResumed` with a
 *      fabricated event payload built from the seeded subscription.
 *   B. Stripe CLI trigger + forward to webhook. Needs z1wuz fixed first.
 *
 * This spec is authored with `test.skip(true, …)` — structure is complete so
 * enabling is a mechanical change: remove the skip, implement
 * `triggerSubscriptionEvent()`.
 *
 * Follows Codex-a8g6h patterns (see account-subscription-cancel.spec.ts):
 *   - baseURL from playwright.config.ts
 *   - real login flow through the auth worker
 *   - health-probe bail-outs in beforeAll
 *   - idempotent teardown — resume if paused
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!',
};

const SEEDED_ORG_SLUG = 'studio-alpha';
const SEEDED_CONTENT_SLUG = 'intro-to-typescript';

const BLOCKER_MESSAGE =
  'Blocked by Codex-z1wuz — seeded subscription has synthetic stripeSubscriptionId. ' +
  'Enable by adding a test-only POST /_test/subscription-event to ecom-api ' +
  '(gated by env.ALLOW_TEST_HOOKS) that dispatches handleSubscriptionPaused / ' +
  'handleSubscriptionResumed directly. See docs/subscription-cache-audit/phase-2-followup.md.';

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

/**
 * Dispatch a synthetic subscription-lifecycle event. When the test-only
 * endpoint lands this should POST to it. Currently throws so the skip reason
 * is loud if a dev removes `test.skip` too eagerly.
 *
 * Real implementation (workers/ecom-api/src/routes/test-hooks.ts):
 *   POST /_test/subscription-event
 *   body: { type: 'paused' | 'resumed', userId, orgId }
 *   gate: env.ALLOW_TEST_HOOKS === 'true' (set in wrangler.toml env=test)
 *   effect: calls handleSubscriptionPaused/Resumed with a fabricated event
 */
async function triggerSubscriptionEvent(
  _request: import('@playwright/test').APIRequestContext,
  _type: 'paused' | 'resumed',
  _userId: string,
  _orgId: string
): Promise<void> {
  throw new Error(
    'triggerSubscriptionEvent() not implemented — add POST /_test/subscription-event ' +
      'to workers/ecom-api and implement this helper. See Codex-z1wuz.'
  );
}

test.describe
  .serial('Subscription paused → resumed roundtrip', () => {
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
      // Idempotent teardown — if the test paused the subscription, resume it so
      // the next run starts clean. Never fail teardown on error.
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
          await triggerSubscriptionEvent(
            request,
            'resumed',
            userId,
            orgId
          ).catch(() => {});
        }
      } catch {
        // swallow
      }
    });

    test('paused → stream 403; resumed → stream 200', async ({
      page,
      request,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

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
      expect(userId).toBeTruthy();
      expect(orgId).toBeTruthy();

      // Baseline: ACTIVE subscription mints a stream URL cleanly.
      const streamBaseline = await page.request.post(
        `${orgBase(page)}/_app/remote/getStreamingUrl`,
        { data: { contentSlug: SEEDED_CONTENT_SLUG } }
      );
      expect([200, 201]).toContain(streamBaseline.status());

      // ── Pause ──────────────────────────────────────────────────────────────
      await triggerSubscriptionEvent(request, 'paused', userId, orgId);

      // Stream request MUST be denied while paused (revocation key present).
      const streamPaused = await page.request.post(
        `${orgBase(page)}/_app/remote/getStreamingUrl`,
        { data: { contentSlug: SEEDED_CONTENT_SLUG } }
      );
      expect(streamPaused.status()).toBe(403);

      // ── Resume ─────────────────────────────────────────────────────────────
      await triggerSubscriptionEvent(request, 'resumed', userId, orgId);

      // Stream request MUST succeed again (revocation cleared on resume).
      const streamResumed = await page.request.post(
        `${orgBase(page)}/_app/remote/getStreamingUrl`,
        { data: { contentSlug: SEEDED_CONTENT_SLUG } }
      );
      expect([200, 201]).toContain(streamResumed.status());
    });
  });
