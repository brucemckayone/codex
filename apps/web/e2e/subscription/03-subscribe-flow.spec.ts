import { expect, type Frame, test } from '@playwright/test';
import { loginAsSeedViewer } from '../helpers/seed-auth';
import { buildOrgUrl, STUDIO_ALPHA } from '../helpers/subscription';

/**
 * Subscribe Flow — Codex-x0pa step 5 ("Customer subscribes to a tier").
 *
 * A seeded user with NO active subscription (james@test.com) opens the
 * Studio Alpha public pricing page and clicks Subscribe on a tier. The
 * pricing page's `handleSubscribe` creates a Stripe Checkout session and
 * sets `window.location.href = result.sessionUrl`
 * (apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte:303-349).
 *
 * We block the real navigation to `checkout.stripe.com` and assert a Stripe
 * Checkout URL was produced — the automatable half of step 5. (The hosted
 * Stripe Checkout page itself and the webhook round-trip are out of scope
 * for a browser test; the seed + downstream specs already exercise an active
 * subscription end-to-end. Full forged-webhook completion is tracked by
 * Codex-z1wuz.)
 *
 * Mirrors the redirect-interception pattern in
 * 01-studio-connect-onboarding.spec.ts (1.b).
 *
 * Prereqs: auth (42069), ecom-api (42072), organization-api (42071) up;
 * `pnpm db:seed` (Studio Alpha Connect active + Standard/Pro tiers with real
 * Stripe test-mode prices; james@test.com seeded with NO subscription).
 */

const NO_SUB_USER = { email: 'james@test.com', password: 'Test1234!' } as const;
const STRIPE_URL_RE = /^https:\/\/(?:[a-z]+\.)?stripe\.com\//i;

test.describe('Subscribe flow (Codex-x0pa step 5)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const probes: Array<[number, string]> = [
      [42069, 'auth'],
      [42072, 'ecom-api'],
      [42071, 'organization-api'],
    ];
    for (const [port, name] of probes) {
      try {
        const res = await request.get(`http://localhost:${port}/health`);
        if (!res.ok()) test.skip(true, `${name} not running on port ${port}`);
      } catch {
        test.skip(true, `${name} not running on port ${port}`);
      }
    }
  });

  test('5 clicking Subscribe on a tier initiates a Stripe Checkout session', async ({
    page,
  }) => {
    // Fresh no-subscription user — fast-signin (no rate limit), skip the
    // default /library post-nav so we go straight to the org pricing page.
    await loginAsSeedViewer(page, { user: NO_SUB_USER, navigateTo: null });

    await page.goto(buildOrgUrl(page, STUDIO_ALPHA.slug, '/pricing'));

    // A no-sub user sees a Subscribe CTA on every tier card.
    const cta = page.locator('[data-testid="tier-cta-subscribe"]').first();
    await expect(cta).toBeVisible({ timeout: 30_000 });

    // Block the real redirect to Stripe so the test never navigates into the
    // hosted checkout. Two interception layers (defence in depth — see 1.b):
    let stripeRedirectUrl: string | null = null;
    await page.route(STRIPE_URL_RE, async (route) => {
      stripeRedirectUrl = route.request().url();
      await route.abort('aborted');
    });
    const onFrameNav = (frame: Frame) => {
      if (STRIPE_URL_RE.test(frame.url())) stripeRedirectUrl = frame.url();
    };
    page.on('framenavigated', onFrameNav);

    // Capture the checkout-session POST (SvelteKit remote function). Optional
    // — the redirect interception above is the primary signal.
    const checkoutResp = page
      .waitForResponse(
        (resp) =>
          resp.request().method() === 'POST' &&
          /\/_app\/remote\//.test(resp.url()) &&
          resp.status() < 500,
        { timeout: 30_000 }
      )
      .catch(() => null);

    // Direct DOM click — the org nav / sticky CTA can intercept pointer events.
    await cta.evaluate((el: HTMLElement) => el.click());

    const resp = await checkoutResp;
    const body = resp ? await resp.text() : '';
    const bodyHasStripeUrl = STRIPE_URL_RE.test(body);

    // Give the handler a beat to set window.location.href = sessionUrl.
    await page.waitForTimeout(1000);

    // Success: either the checkout response carried a Stripe URL, or the page
    // attempted to navigate to checkout.stripe.com.
    expect(bodyHasStripeUrl || stripeRedirectUrl !== null).toBeTruthy();

    const stripeUrl =
      stripeRedirectUrl ??
      body.match(/https?:\/\/[^\s"']+stripe\.com[^\s"']*/i)?.[0] ??
      '';
    expect(stripeUrl).toMatch(STRIPE_URL_RE);

    await page.unroute(STRIPE_URL_RE);
    page.off('framenavigated', onFrameNav);
  });
});
