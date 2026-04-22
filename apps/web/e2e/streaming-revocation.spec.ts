import { expect, test } from '@playwright/test';

/**
 * Streaming Revocation E2E (PR 2 — defense-in-depth)
 *
 * Covers the PR 2 row in docs/subscription-cache-audit/testing-matrix.md:
 *   "Revoked user: streaming URL returns 403 within 10 min"
 *   "AccessRevokedOverlay renders with reason = subscription_deleted"
 *
 * Flow:
 *   1. Log in as seeded viewer@test.com (ACTIVE Standard sub on studio-alpha)
 *   2. Navigate to a published content page, confirm the player mounts
 *   3. Simulate revocation — write `revoked:user:{userId}:{orgId}` into KV
 *      directly (via the wrangler dev KV API OR a test-only worker endpoint).
 *   4. Re-request a streaming URL and expect a 403 with
 *      `details.reason === 'subscription_deleted'`
 *   5. Navigate back to the content page → expect AccessRevokedOverlay to
 *      render with the subscription_deleted copy
 *   6. Click the "View plan" secondary CTA → expect navigation to
 *      `/account/subscriptions`
 *
 * ── Fixture strategy: Option C (AUTHOR-ONLY) ─────────────────────────────────
 *
 * Blocker: Codex-z1wuz — the seeded subscription has a synthetic
 * `stripeSubscriptionId` so real Stripe-driven flows 404. The cleanest way to
 * drive this test is to write the revocation KV key directly, but there is
 * NO test-only worker endpoint today and the Playwright runner cannot talk
 * to wrangler's KV directly from Node without setting up a miniflare RPC
 * bridge. Rather than invent one speculatively, this spec is wired with
 * `test.skip(true, …)` pointing at Codex-z1wuz — the structure is complete
 * so when the blocker is resolved (either by fixing the seeded Stripe ID or
 * by landing a test-only `/_test/revocation` endpoint), deleting the
 * `test.skip` lines and wiring `seedRevocation()` is the only change needed.
 *
 * The approaches the author MUST pick from when unblocking (in priority):
 *   A. Expose a test-only POST `/_test/revocation` on ecom-api (gated by
 *      `env.ALLOW_TEST_HOOKS` which is set in `wrangler.toml` env=test only)
 *      that takes `{ action: 'revoke' | 'clear', userId, orgId, reason? }`
 *      and calls `AccessRevocation.revoke(...)` / `.clear(...)` directly.
 *      Fastest. No Stripe coupling.
 *   B. Run `stripe trigger customer.subscription.deleted` + forward the event
 *      to the ecom-api webhook with a spec-local helper. Slower, requires the
 *      seeded subscription to match a real Stripe object (blocked by z1wuz).
 *   C. Direct miniflare KV put via an `npx wrangler kv key put` spawn. Brittle.
 *
 * Per task spec (line "prefer the direct KV write if a dev endpoint exists"),
 * Option A is recommended.
 *
 * Follow the Codex-a8g6h patterns exactly (see account-subscription-cancel.spec.ts):
 *   - baseURL from playwright.config.ts (http://lvh.me:5173)
 *   - login via the real form + auth worker
 *   - health-probe bail-out in beforeAll so missing workers skip cleanly
 *   - idempotent teardown — clear the revocation key in afterEach
 */

const SEED_USER = {
  email: 'viewer@test.com',
  password: 'Test1234!', // SEED_PASSWORD in packages/database/scripts/seed/constants.ts
};

// Seeded on `pnpm db:seed` — Studio Alpha org, slug "studio-alpha", hosts
// published content "intro-to-typescript" which the seeded viewer's Standard
// tier can access.
const SEEDED_ORG_SLUG = 'studio-alpha';
const SEEDED_CONTENT_SLUG = 'intro-to-typescript';

// Until Codex-z1wuz ships, none of the PR 2 E2E specs can RUN green. This
// flag keeps the specs enumerated (so CI reports them as skipped, not missing)
// without failing the suite.
const BLOCKER_MESSAGE =
  'Blocked by Codex-z1wuz — seeded subscription has synthetic stripeSubscriptionId. ' +
  'Enable by: (a) landing a test-only /_test/revocation endpoint on ecom-api and ' +
  'implementing seedRevocation()/clearRevocation() below, or (b) fixing the seed ' +
  'to use a real Stripe test-mode subscription. See docs/subscription-cache-audit/phase-2-followup.md.';

async function loginAsSeedViewer(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', SEED_USER.email);
  await page.fill('input[name="password"]', SEED_USER.password);
  await page.click('button[type="submit"]', { noWaitAfter: true });
  await expect(page).toHaveURL(/\/library/, { timeout: 30_000 });
}

/**
 * Build an absolute URL on the org subdomain from the current baseURL. The
 * test runner's baseURL is on `lvh.me` which resolves its wildcard DNS to
 * 127.0.0.1 — perfect for cross-subdomain cookie support in dev.
 */
function orgBase(
  page: import('@playwright/test').Page,
  slug = SEEDED_ORG_SLUG
) {
  const base = new URL(page.url());
  return `${base.protocol}//${slug}.${base.host}`;
}

/**
 * Seed a revocation entry for the current viewer. When the test-only endpoint
 * exists this should POST to it; currently throws so tests that rely on it
 * will surface the skip reason clearly if the test.skip is ever removed
 * prematurely.
 *
 * Signature is intentionally sync-returning-Promise so callers can `await`
 * without waiting on wrangler startup or similar when the real impl lands.
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
    'seedRevocation() not implemented — add a POST /_test/revocation to ' +
      'workers/ecom-api gated by env.ALLOW_TEST_HOOKS and call it here. ' +
      'See Codex-z1wuz.'
  );
}

async function clearRevocation(
  _request: import('@playwright/test').APIRequestContext,
  _userId: string,
  _orgId: string
): Promise<void> {
  // Idempotent: safe to no-op if nothing was seeded.
  // Real impl should POST { action: 'clear', userId, orgId }.
}

test.describe
  .serial('Streaming revocation — revoked user is denied + overlay renders', () => {
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
      // Idempotent teardown — always try to clear the revocation key so the
      // next run starts clean. Never fail teardown on error.
      try {
        const userId = await page.evaluate(() => {
          const match = document.cookie.match(/codex-user-id=([^;]+)/);
          return match ? decodeURIComponent(match[1]) : null;
        });
        if (userId) await clearRevocation(request, userId, '__any__');
      } catch {
        // swallow
      }
    });

    test('revoked user: next streaming URL mint returns 403 with subscription_deleted reason', async ({
      page,
      request,
    }) => {
      test.skip(true, BLOCKER_MESSAGE);

      await loginAsSeedViewer(page);

      // Navigate to a content page to confirm baseline access works.
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });

      // Capture the authenticated user's ID + org ID from page data. In SvelteKit
      // these are exposed via the layout load; we grab them from __sveltekit data.
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

      // Baseline: a streaming-URL mint succeeds while the user is ACTIVE. The
      // access remote function is `/_app/remote/…`; we intercept the network
      // call by issuing it directly through the page's session.
      const streamBefore = await page.request.post(
        `${orgBase(page)}/_app/remote/getStreamingUrl`,
        {
          data: { contentSlug: SEEDED_CONTENT_SLUG },
        }
      );
      expect([200, 201]).toContain(streamBefore.status());

      // Simulate revocation via the test-only endpoint.
      await seedRevocation(request, userId, orgId, 'subscription_deleted');

      // Next mint MUST be 403 with reason=subscription_deleted.
      const streamAfter = await page.request.post(
        `${orgBase(page)}/_app/remote/getStreamingUrl`,
        {
          data: { contentSlug: SEEDED_CONTENT_SLUG },
        }
      );
      expect(streamAfter.status()).toBe(403);
      const body = await streamAfter.json();
      // Error envelope shape from mapErrorToResponse: { error: { code, message, details } }
      expect(body?.error?.details?.reason).toBe('subscription_deleted');
    });

    test('revoked user: content page renders AccessRevokedOverlay with subscription_deleted copy', async ({
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

      await seedRevocation(request, userId, orgId, 'subscription_deleted');

      // Re-navigate to the content page — the server load will attempt to mint
      // a streaming URL, get a 403 with reason, and thread `revocationReason`
      // into the ContentDetailView, which renders the AccessRevokedOverlay.
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);

      // Assert: overlay is visible with data-reason="subscription_deleted"
      const overlay = page.locator(
        '.access-revoked[data-reason="subscription_deleted"]'
      );
      await expect(overlay).toBeVisible({ timeout: 10_000 });

      // Copy matches the AccessRevokedOverlay config for subscription_deleted:
      //   title: "Your subscription has ended"
      //   body:  "Reactivate to continue watching."
      await expect(overlay.locator('.access-revoked__title')).toHaveText(
        'Your subscription has ended'
      );
      await expect(overlay.locator('.access-revoked__body')).toHaveText(
        'Reactivate to continue watching.'
      );
    });

    test('"View plan" secondary CTA on the overlay navigates to /account/subscriptions', async ({
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

      await seedRevocation(request, userId, orgId, 'subscription_deleted');
      await page.goto(`${orgBase(page)}/content/${SEEDED_CONTENT_SLUG}`);

      const overlay = page.locator(
        '.access-revoked[data-reason="subscription_deleted"]'
      );
      await expect(overlay).toBeVisible({ timeout: 10_000 });

      // The "View plan" CTA is wired as action='href' with href=/account/subscriptions.
      // The overlay's handler uses `window.location.href = href` (full nav), so we
      // wait for a navigation rather than a SPA transition.
      const viewPlanBtn = overlay.getByRole('button', { name: /view plan/i });
      await expect(viewPlanBtn).toBeVisible();
      await Promise.all([
        page.waitForURL(/\/account\/subscriptions/, { timeout: 10_000 }),
        viewPlanBtn.click(),
      ]);
      await expect(page).toHaveURL(/\/account\/subscriptions/);
    });
  });
