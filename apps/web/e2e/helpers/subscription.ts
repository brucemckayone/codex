/**
 * Subscription E2E Test Helpers
 *
 * Minimal helpers for the subscription suite (Codex-x0pa, Session 1).
 *
 * The 4 webhook-driven helpers (postForgedWebhookEvent, waitForSubscriptionRow,
 * cancelAnyActiveSubscriptions, triggerStripeCliEvent) are owned by Session 2 —
 * specs 01 and 02 don't need them.
 */

import type { Page } from '@playwright/test';

/**
 * The seeded creator @ Studio Alpha (commerce.ts seed).
 *
 * Connect is genuinely active in real Stripe (charges_enabled +
 * payouts_enabled = true) — verified via `accounts.retrieve()` after
 * `activateConnectAccount()` (commerce.ts:77-120).
 *
 * Use this for any spec that needs to operate on a real, active Connect
 * account without standing up `setupStudioUserWithConnect` (rejected per
 * U-02 in docs/triage/iter-010-x0pa-unclears.md — would either duplicate
 * 50 lines of seed activation logic or silently lie about chargesEnabled).
 */
export const SEEDED_CREATOR = {
  email: 'creator@test.com',
  password: 'Test1234!',
} as const;

/**
 * Studio Alpha — pre-seeded org with Connect active and 2 tiers
 * (alphaStandard £4.99/mo, alphaPro £9.99/mo).
 */
export const STUDIO_ALPHA = {
  slug: 'studio-alpha',
  name: 'Studio Alpha',
  /** Use {@link buildOrgUrl} via {@link import('@playwright/test').Page} `baseURL` for portable URL building. */
  baseUrl: 'http://studio-alpha.lvh.me:5173',
} as const;

/**
 * Build an org-subdomain URL from the page's baseURL so specs honour
 * `PLAYWRIGHT_BASE_URL` in CI. Mirrors the pattern in
 * `subscription-cross-device.spec.ts:135-136`.
 */
export function buildOrgUrl(
  page: Page,
  orgSlug: string,
  path: string = '/'
): string {
  const base = new URL(page.url());
  // If page hasn't navigated yet (about:blank), fall back to the configured
  // baseURL via context options. lvh.me:5173 is the dev default.
  const protocol =
    base.protocol === 'about:' || !base.protocol ? 'http:' : base.protocol;
  const host = base.host && base.host !== '' ? base.host : 'lvh.me:5173';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}//${orgSlug}.${host}${cleanPath}`;
}

/**
 * Log in as the seeded creator via the real login form. Mirrors
 * `loginAsSeedViewer` in account-subscription-cancel.spec.ts:47-55.
 *
 * After a successful login the page is at `/library`. Cookies are
 * scoped to `lvh.me` (the parent domain) so they propagate to any
 * `*.lvh.me` subdomain on the next navigation.
 *
 * @remarks
 * `/api/auth/sign-in/email` is rate-limited at 5 req / 15 min per IP
 * (RATE_LIMIT_PRESETS.auth). Specs that share a seeded creator across
 * multiple tests should consider {@link captureSeededCreatorCookies} +
 * `page.context().addCookies` to spend only one auth slot per spec run.
 */
export async function loginAsSeededCreator(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', SEEDED_CREATOR.email);
  await page.fill('input[name="password"]', SEEDED_CREATOR.password);
  await page.click('button[type="submit"]', { noWaitAfter: true });
  // After login the user is redirected to /library. 30s budget mirrors
  // the cancel spec — auth worker + session KV cold start can be slow.
  await page.waitForURL(/\/library/, { timeout: 30_000 });
}

/** Playwright-compatible cookie shape. */
type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expires: number;
};

/**
 * Parse a list of Set-Cookie response header strings into Playwright cookies.
 *
 * Sets BOTH the explicit name and a `codex-session` alias when the cookie is
 * `better-auth.session_token` (mirrors `apps/web/e2e/helpers/studio.ts:152-163`).
 * Domain is `.lvh.me` (with leading dot) to match every `*.lvh.me` subdomain
 * unambiguously — Chromium treats no-dot domains as host-only, which would
 * mean cookies set on `lvh.me` are NOT sent to `studio-alpha.lvh.me`.
 */
function parseSetCookieHeaders(setCookieHeaders: string[]): BrowserCookie[] {
  const cookies: BrowserCookie[] = [];
  for (const sc of setCookieHeaders) {
    const firstSemi = sc.indexOf(';');
    const nameValue = firstSemi > 0 ? sc.substring(0, firstSemi) : sc;
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx <= 0) continue;
    const cookieName = nameValue.substring(0, eqIdx).trim();
    const cookieValue = nameValue.substring(eqIdx + 1).trim();
    cookies.push({
      name: cookieName,
      value: cookieValue,
      domain: '.lvh.me',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: -1,
    });
    if (cookieName === 'better-auth.session_token') {
      cookies.push({
        name: 'codex-session',
        value: cookieValue,
        domain: '.lvh.me',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: -1,
      });
    }
  }
  return cookies;
}

/**
 * Capture the seeded creator's session cookies via a single direct call to
 * the auth worker, returning a Playwright-compatible cookie set scoped to
 * `.lvh.me` (works on every `*.lvh.me` subdomain).
 *
 * Designed for `test.beforeAll` use: spend one auth slot, then re-use the
 * cookies across all tests in the describe block via
 * `page.context().addCookies(...)`. Bypasses the auth worker rate limiter
 * via a synthetic CF-Connecting-IP header (per-process random IP).
 */
export async function captureSeededCreatorCookies(): Promise<BrowserCookie[]> {
  // The auth worker rate-limits `/api/auth/sign-in/email` at 5 req / 15min
  // per IP (`RATE_LIMIT_PRESETS.auth`). On localhost the IP fallback is the
  // string "unknown", which means EVERY developer / CI process shares one
  // bucket — easily exhausted by a single failed test run. Send a synthetic
  // CF-Connecting-IP per spec invocation so each run gets its own bucket.
  // The header is honoured by `defaultKeyGenerator` in
  // packages/security/src/rate-limit.ts:135-143.
  const syntheticIp = `127.${Math.floor(Math.random() * 200) + 50}.${Math.floor(
    Math.random() * 200
  )}.${Math.floor(Math.random() * 200)}`;

  const response = await fetch(
    'http://localhost:42069/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': syntheticIp,
      },
      body: JSON.stringify({
        email: SEEDED_CREATOR.email,
        password: SEEDED_CREATOR.password,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `captureSeededCreatorCookies: sign-in failed (${response.status}): ${errorText.slice(0, 200)}`
    );
  }

  return parseSetCookieHeaders(response.headers.getSetCookie());
}

/**
 * Create a fresh org-owner user without going through the auth-worker's
 * rate-limited `/api/auth/sign-in/email` path.
 *
 * Why this exists: `@codex/test-utils`'s `orgFixture.createOrgMember` calls
 * `authFixture.registerUser`, which uses fast-register first then falls back
 * to `_loginFallback` (POST sign-in/email) when fast-register doesn't return
 * session cookies. That fallback uses the auth worker's rate-limited bucket
 * (5 req / 15min per IP), which is shared across all parallel/sequential
 * test runs and is easily exhausted by retries / failed runs.
 *
 * This helper does the same work as `registerSharedStudioUser` but routes
 * the (mandatory) sign-in call through a unique synthetic CF-Connecting-IP,
 * which the auth worker honours per `defaultKeyGenerator`
 * (packages/security/src/rate-limit.ts:135-143). Result: every spec invocation
 * lands in a fresh rate-limit bucket and never collides with the shared bucket.
 *
 * @returns user + org + cookie ready for `injectOrgCookies` (or set directly
 *          via `page.context().addCookies` with domain `lvh.me`).
 */
export async function createFreshOwnerWithBypass(opts: {
  orgName?: string;
  orgSlug?: string;
}): Promise<{
  userId: string;
  email: string;
  password: string;
  organization: { id: string; slug: string; name: string };
  cookies: Awaited<ReturnType<typeof captureSeededCreatorCookies>>;
}> {
  // Lazy-import database helpers — Node-only modules can't load in browser.
  const { dbHttp, schema } = await import('@codex/database');

  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const email = `e2e-x0pa-${timestamp}-${rand}@test.codex`;
  const password = 'Test123!@#';
  const name = `E2E x0pa User ${rand}`;
  const orgSlug = opts.orgSlug ?? `e2e-x0pa-${timestamp}-${rand}`;
  const orgName = opts.orgName ?? `E2E x0pa Org ${timestamp}`;

  // Step 1: Fast-register (test endpoint, NOT rate-limited).
  const registerRes = await fetch(
    'http://localhost:42069/api/test/fast-register',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:42069',
      },
      body: JSON.stringify({ email, password, name, role: 'customer' }),
    }
  );
  if (!registerRes.ok) {
    throw new Error(
      `createFreshOwnerWithBypass: fast-register failed ${registerRes.status}: ${await registerRes.text()}`
    );
  }
  const registerBody = (await registerRes.json()) as {
    user?: { id?: string };
  };
  const userId = registerBody?.user?.id;
  if (!userId) {
    throw new Error(
      'createFreshOwnerWithBypass: fast-register returned no user.id'
    );
  }

  // Step 2: Sign in with a synthetic IP — bypasses the rate limiter.
  const syntheticIp = `127.${Math.floor(Math.random() * 200) + 50}.${Math.floor(
    Math.random() * 200
  )}.${Math.floor(Math.random() * 200)}`;
  const signInRes = await fetch(
    'http://localhost:42069/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': syntheticIp,
      },
      body: JSON.stringify({ email, password }),
    }
  );
  if (!signInRes.ok) {
    throw new Error(
      `createFreshOwnerWithBypass: sign-in failed ${signInRes.status}: ${await signInRes.text()}`
    );
  }

  const setCookieHeaders = signInRes.headers.getSetCookie();
  const cookies = parseSetCookieHeaders(setCookieHeaders);

  // Step 3: Create org + membership directly via DB (mirrors orgFixture).
  const [org] = await dbHttp
    .insert(schema.organizations)
    .values({
      name: orgName,
      slug: orgSlug,
      description: 'E2E x0pa Test Organization',
    })
    .returning();
  if (!org) {
    throw new Error('createFreshOwnerWithBypass: failed to insert org');
  }
  await dbHttp.insert(schema.organizationMemberships).values({
    organizationId: org.id,
    userId,
    role: 'owner',
    status: 'active',
    invitedBy: userId,
  });

  return {
    userId,
    email,
    password,
    organization: { id: org.id, slug: org.slug, name: org.name },
    cookies,
  };
}

/**
 * Archive Stripe test-mode products created by E2E tests.
 *
 * @remarks
 * **TierService does NOT support custom metadata on tier-created products**
 * — see `packages/subscription/src/services/tier-service.ts:212-220`,
 * which hard-codes `metadata: { codex_organization_id, codex_type: 'subscription_tier' }`.
 * Without a metadata hook, the only way to identify products created by THIS
 * spec run (vs the seed's `codex_seed='true'` products) is by name prefix.
 *
 * Tests using this helper MUST give their tier names a unique prefix
 * (e.g. `E2E Bronze ${Date.now()}`) so this teardown can target them.
 *
 * Best-effort: logs and swallows on failure. Never blocks test suite shutdown.
 *
 * @returns count of products archived
 */
export async function archiveTestStripeProducts(opts: {
  /** Required — names matching this prefix will be archived. */
  namePrefix: string;
}): Promise<{ archived: number }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !stripeKey.startsWith('sk_test_')) {
    // Either no key, or accidentally pointed at live — refuse to touch.
    return { archived: 0 };
  }

  let Stripe: typeof import('stripe').default;
  try {
    Stripe = (await import('stripe')).default;
  } catch {
    // Stripe SDK not available in test runtime (apps/web doesn't depend on
    // it directly — the SDK is used by service packages). Returns 0 so the
    // afterAll log shows the gap clearly. Test products in Stripe accumulate
    // until the next `pnpm db:seed` run (which only cleans `codex_seed=true`).
    // To enable real cleanup: add `"stripe": "^19"` to apps/web/package.json
    // devDependencies. Filed as U-17 in iter-010-x0pa-unclears.md.
    return { archived: 0 };
  }

  const stripe = new Stripe(stripeKey);
  let archived = 0;

  try {
    // List recent active products and filter by name prefix client-side.
    // Stripe's `products.search` requires the search API to be enabled and
    // even then doesn't accept name LIKE queries — listing is more reliable.
    const products = await stripe.products.list({ active: true, limit: 100 });
    for (const product of products.data) {
      if (!product.name?.startsWith(opts.namePrefix)) continue;
      // Archive prices first (Stripe rule: can't deactivate a product with
      // active prices in some edge cases — be defensive).
      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 100,
      });
      for (const price of prices.data) {
        await stripe.prices.update(price.id, { active: false }).catch(() => {});
      }
      await stripe.products
        .update(product.id, { active: false })
        .catch(() => {});
      archived++;
    }
  } catch (err) {
    // Best-effort. Log via console.warn — tests run in their own process.
    // eslint-disable-next-line no-console
    console.warn(
      `[archiveTestStripeProducts] cleanup failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { archived };
}
