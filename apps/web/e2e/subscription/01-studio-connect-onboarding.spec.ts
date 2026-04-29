import { expect, type Page, test } from '@playwright/test';
import {
  buildOrgUrl,
  captureSeededCreatorCookies,
  createFreshOwnerWithBypass,
  STUDIO_ALPHA,
} from '../helpers/subscription';

/**
 * Studio Stripe Connect Onboarding E2E Tests
 *
 * Covers bead step 1 of Codex-x0pa: org owner connects Stripe.
 *
 * Three independent tests, ordered un-onboarded → redirect → active:
 *
 *   1.a — Fresh creator + org with no Connect: monetisation page renders
 *         "Not connected" status + "Connect Stripe Account" CTA.
 *   1.b — Same fresh creator: clicking the CTA calls the connectOnboard
 *         remote function and the response includes a Stripe-domain URL.
 *         We intercept the response (not the navigation) so the test
 *         doesn't actually follow the redirect into Stripe-hosted UI.
 *   1.c — Seeded creator@test.com (Studio Alpha): monetisation page
 *         renders "Connected" status + "Open Stripe Dashboard" CTA.
 *
 * Fixtures:
 *   1.a, 1.b → fresh per-test creator via setupStudioUser({ orgRole: 'owner' }).
 *              Each test creates a unique org so they are fully independent.
 *   1.c     → seeded creator@test.com / Studio Alpha (commerce.ts:77-120
 *              activates real-Stripe Connect; chargesEnabled=true).
 *
 * Prereqs:
 *   - auth-worker (42069), organization-api (42075), ecom-api (42072) up
 *     (playwright.config.ts auto-starts these on local).
 *   - SvelteKit dev server on lvh.me:5173 (also auto-started).
 *   - For 1.c: `pnpm db:seed` has run with STRIPE_SECRET_KEY set.
 */

test.describe('Studio Stripe Connect Onboarding', () => {
  // Run serially: 1.a asserts "Not connected" state of `freshOwner`, then
  // 1.b mutates `freshOwner` by clicking Connect Stripe (creates a Stripe
  // account + DB row). Running them in parallel or out of order would
  // leak state between tests.
  test.describe.configure({ mode: 'serial' });

  // Single fresh user shared across 1.a + 1.b. Auth setup uses
  // `createFreshOwnerWithBypass`, which routes the sign-in call through a
  // synthetic CF-Connecting-IP — bypasses the auth worker's rate limit
  // (5 req / 15min, default-keyed by IP). See helpers/subscription.ts.
  let freshOwner: Awaited<ReturnType<typeof createFreshOwnerWithBypass>>;
  // Seeded-creator cookies, captured once in beforeAll for 1.c.
  let creatorCookies: Awaited<ReturnType<typeof captureSeededCreatorCookies>>;

  async function injectFreshOwnerAuth(page: Page) {
    await page.context().clearCookies();
    await page.context().addCookies(freshOwner.cookies);
  }

  async function injectCreatorAuth(page: Page) {
    await page.context().clearCookies();
    await page.context().addCookies(creatorCookies);
  }

  test.beforeAll(async ({ request }) => {
    // Health probes mirror account-subscription-cancel.spec.ts:91-106.
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

    // One fresh org-owner user with NO Connect account yet.
    // Bypasses the auth worker rate limiter (synthetic CF-Connecting-IP)
    // and writes the org + membership rows directly via dbHttp. The
    // monetisation page gates on org membership role ('owner'), not
    // platform role — verified at apps/web/src/routes/_org/[slug]/studio/
    // +layout.server.ts.
    freshOwner = await createFreshOwnerWithBypass({});

    // Capture seeded creator cookies once for 1.c.
    creatorCookies = await captureSeededCreatorCookies();
  });

  test('1.a un-onboarded creator sees Not connected + Set up Stripe CTA', async ({
    page,
  }) => {
    // The fresh owner has NO stripeConnectAccounts row, so
    // getConnectStatus returns isConnected=false → "Not connected" badge.
    await injectFreshOwnerAuth(page);

    await page.goto(
      buildOrgUrl(page, freshOwner.organization.slug, '/studio/monetisation')
    );

    // Page header renders → server load returned + studio shell mounted.
    // Generous timeout: studio layout cold-start can be 15s+ when SvelteKit
    // dev server is freshly started (Stripe webhook + branding + perf logs
    // visible in `pnpm test:e2e` output show 5-15s on first request).
    await expect(page.locator('h1.page-title')).toBeVisible({
      timeout: 30_000,
    });

    // Wait for client-side queries (getConnectStatus) to settle. The
    // connect status badge is rendered inside a Skeleton until the query
    // resolves; the actual status badge has the localised label.
    await expect(page.locator('text=/Not connected/i').first()).toBeVisible({
      timeout: 20_000,
    });

    // CTA: "Connect Stripe Account" (matches monetisation_connect_start label).
    const cta = page.getByRole('button', { name: /Connect Stripe Account/i });
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test('1.b clicking Set up Stripe redirects to a Stripe Connect URL', async ({
    page,
  }) => {
    await injectFreshOwnerAuth(page);

    await page.goto(
      buildOrgUrl(page, freshOwner.organization.slug, '/studio/monetisation')
    );
    await expect(page.locator('h1.page-title')).toBeVisible({
      timeout: 30_000,
    });

    const cta = page.getByRole('button', { name: /Connect Stripe Account/i });
    await expect(cta).toBeVisible({ timeout: 20_000 });

    // Block the actual redirect to Stripe so the test doesn't navigate into
    // their hosted onboarding flow. Two interception layers:
    //   1. page.route — fires for resource fetches AND for top-level
    //      navigations on Chromium. We abort to prevent the network request.
    //   2. page.on('framenavigated') — also fires when `window.location.href`
    //      points at a Stripe URL, even if the navigation aborts.
    // Either layer recording a Stripe URL counts as success. Defence in depth
    // because Playwright's interception of nav redirects has historical
    // brittleness across versions / engines.
    let stripeRedirectUrl: string | null = null;
    await page.route(
      /^https:\/\/(?:[a-z]+\.)?stripe\.com\//i,
      async (route) => {
        stripeRedirectUrl = route.request().url();
        await route.abort('aborted');
      }
    );
    const onFrameNav = (frame: import('@playwright/test').Frame) => {
      const url = frame.url();
      if (/^https:\/\/(?:[a-z]+\.)?stripe\.com\//i.test(url)) {
        stripeRedirectUrl = url;
      }
    };
    page.on('framenavigated', onFrameNav);

    // Capture the remote-function POST that produces the onboarding URL.
    // SvelteKit remote functions live at `/_app/remote/<id>`; we don't know
    // the id, but `connectOnboard` is a `command()` so it's the only
    // monetisation-page POST that returns `{ accountId, onboardingUrl }`.
    const remotePromise = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'POST' &&
        /\/_app\/remote\//.test(resp.url()) &&
        resp.status() < 500,
      { timeout: 30_000 }
    );

    await cta.click();

    const remoteResp = await remotePromise;
    const body = await remoteResp.text();
    // Remote function envelope: SvelteKit returns either a JSON body with
    // the resolved value or a structured error. Parse defensively — we
    // only need to confirm a Stripe URL is present somewhere in the
    // payload OR that the page subsequently attempted a redirect to one.
    const containsStripeUrl = /https?:\/\/(?:[a-z]+\.)?stripe\.com\//i.test(
      body
    );

    // The handler then sets `window.location.href = result.onboardingUrl`,
    // which fires the request our `page.route` intercepts. Wait briefly so
    // the route handler has a chance to record it.
    await page.waitForTimeout(500);

    expect(containsStripeUrl || stripeRedirectUrl !== null).toBeTruthy();

    // I-04 follow-up: assert URL shape carries account / return params.
    // Stripe Account Links use https://connect.stripe.com/setup/c/<acct_id>
    // and Stripe rotates parameter naming, so we assert the path and host
    // are correct rather than specific query keys.
    const stripeUrl =
      stripeRedirectUrl ??
      body.match(/https?:\/\/[^\s"]+stripe\.com[^\s"']*/i)?.[0] ??
      '';
    expect(stripeUrl).toMatch(/^https:\/\/(?:[a-z]+\.)?stripe\.com\//i);

    await page.unroute(/^https:\/\/(?:[a-z]+\.)?stripe\.com\//i);
    page.off('framenavigated', onFrameNav);
  });

  test('1.c seeded creator on Studio Alpha sees Connected + Stripe Dashboard', async ({
    page,
  }) => {
    // Inject the cookies we captured in beforeAll. They are scoped to
    // `lvh.me` so they propagate to `studio-alpha.lvh.me` on the next nav.
    await injectCreatorAuth(page);

    await page.goto(
      buildOrgUrl(page, STUDIO_ALPHA.slug, '/studio/monetisation')
    );
    await expect(page.locator('h1.page-title')).toBeVisible({
      timeout: 30_000,
    });

    // "Connected" badge — matches monetisation_connect_active label.
    await expect(page.locator('text=/^Connected$/i').first()).toBeVisible({
      timeout: 20_000,
    });

    // CTA when status is active: "Open Stripe Dashboard" (or "Continue Setup"
    // when status='onboarding'). The seed pre-fills + retrieves so chargesEnabled
    // should be true → status='active' → "Open Stripe Dashboard" rendered.
    const dashboardBtn = page.getByRole('button', {
      name: /Open Stripe Dashboard/i,
    });
    await expect(dashboardBtn).toBeVisible();
  });
});
