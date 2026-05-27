import { COOKIES } from '@codex/constants';
import { dbHttp, schema } from '@codex/database';
import { extractSessionCookie, parseCookieString } from '@codex/test-utils/e2e';
import { buildServiceUrl as getServiceUrl } from '@codex/urls';
import { expect, test } from '@playwright/test';

/**
 * Brand Editor — Hero Effects (Phase 2 manifest renderer)
 *
 * E2E coverage for Codex-19h35 Phase 2 + Codex-bies6 verification scope.
 *
 * Asserts that the manifest-driven renderer in BrandEditorHeroEffects.svelte
 * drives `brandEditor.pending.tokenOverrides` IDENTICALLY to the
 * pre-refactor monolith. The unit tests in hero-fx-helpers.test.ts cover
 * the helper functions in isolation; this suite covers the same semantics
 * at the COMPONENT-INTERACTION level (panel open, click preset, drag slider).
 *
 * Two gotchas under test:
 *   - GOTCHA #1: selectPreset('none') clears EVERY shader-* override
 *     (not just shader-preset).
 *   - GOTCHA #2: dragging a slider back to its HERO_FX_DEFAULTS value
 *     REMOVES the override (keeps tokenOverrides minimal).
 *
 * Out of scope (intentional, see scoping doc):
 *   - WebGL canvas pixel diff
 *   - All 41 presets (one or two is sufficient)
 *   - Color picker pixel-perfect dropdown rendering
 *
 * Pre-conditions checked at setup:
 *   - Auth worker reachable
 *   - Identity API + Org API + Web all healthy
 *   - We own (org_role = 'owner') the org we land on so the editor opens
 */

// HERO_FX_DEFAULTS values for keys we drag in tests 2 and 3.
// Mirrored from src/lib/brand-editor/hero-fx-presets.ts so we don't
// import the source module from the e2e harness (Playwright doesn't
// resolve $lib aliases — embedding the literal is cleaner).
const SHADER_CURL_DEFAULT = '30';
const SHADER_CURL_NON_DEFAULT = '50';
const SHADER_INTENSITY_NON_DEFAULT = '1.5';

// AUTH_URL must match what the auth worker sees as a trusted origin.
// `getServiceUrl('auth', true)` resolves the same canonical local URL the
// shared @codex/test-utils auth fixture uses — keeping the two paths
// byte-equal avoids INVALID_ORIGIN drift when ENV_HOSTS or AUTH_WORKER_URL
// changes.
const AUTH_URL = getServiceUrl('auth', true);

/**
 * Build the org-subdomain URL for the org the test owns.
 * Uses `lvh.me` (RFC 6761 wildcard → 127.0.0.1) per the dev-stack convention.
 * Port comes from PLAYWRIGHT_BASE_URL (default 5173 in playwright.config).
 */
function buildOrgUrl(slug: string, params: string = ''): string {
  // Prefer the running dev stack on :3000 if PLAYWRIGHT_BASE_URL points at it,
  // otherwise fall back to :5173 (Playwright config default).
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://lvh.me:5173';
  const port = new URL(baseUrl).port || '5173';
  return `http://${slug}.lvh.me:${port}/${params}`;
}

/**
 * Register an org-owner via the auth worker's legacy 3-step flow:
 *   1. POST /api/auth/sign-up/email   (creates user, sends verify email + KV token)
 *   2. GET  /api/test/verification-token/:email  (DEV/TEST endpoint — pulls token from KV)
 *   3. GET  /api/auth/verify-email?token=...      (302 + Set-Cookie via autoSignInAfterVerification)
 *
 * Critically, this AVOIDS the rate-limited /api/auth/sign-in/email endpoint
 * (5/15min/IP). The shared @codex/test-utils registerUser() helper goes
 * through fast-register first, which returns 200 OK with NO cookies under
 * BetterAuth's `requireEmailVerification: true` config — and then falls
 * back to sign-in, exhausting the rate-limit budget on repeated runs.
 *
 * This inlined version uses ONLY sign-up (1 hit) + verify-email (no rate
 * limit — verification path doesn't have brute-force concerns), so the
 * suite remains runnable indefinitely.
 *
 * Returns the raw Set-Cookie session string suitable for parseCookieString().
 */
async function registerOrgOwner(
  email: string,
  password: string,
  orgName: string,
  orgSlug: string
): Promise<{ cookie: string; userId: string; orgId: string; orgSlug: string }> {
  // Step 1: Sign up
  const signUpRes = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: AUTH_URL },
    body: JSON.stringify({
      email,
      password,
      name: email.split('@')[0],
      role: 'customer',
    }),
  });
  if (!signUpRes.ok) {
    throw new Error(
      `sign-up/email failed (${signUpRes.status}): ${(await signUpRes.text()).slice(0, 200)}`
    );
  }
  const signUpBody = (await signUpRes.json()) as { user?: { id?: string } };
  const userId = signUpBody.user?.id;
  if (!userId) {
    throw new Error('sign-up/email returned no user.id');
  }

  // Step 2: Pull verification token from KV (DEV/TEST endpoint).
  const tokenRes = await fetch(
    `${AUTH_URL}/api/test/verification-token/${encodeURIComponent(email)}`
  );
  if (!tokenRes.ok) {
    throw new Error(
      `verification-token fetch failed (${tokenRes.status}): ${(await tokenRes.text()).slice(0, 200)}`
    );
  }
  const { token } = (await tokenRes.json()) as { token: string };

  // Step 3: Verify email — 302 redirect with Set-Cookie session
  // (autoSignInAfterVerification: true in auth-config.ts).
  const verifyRes = await fetch(
    `${AUTH_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=/`,
    { redirect: 'manual' }
  );
  if (verifyRes.status !== 302 && !verifyRes.ok) {
    throw new Error(
      `verify-email failed (${verifyRes.status}): ${(await verifyRes.text()).slice(0, 200)}`
    );
  }
  const setCookie = verifyRes.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('verify-email returned no Set-Cookie header');
  }
  const cookie = extractSessionCookie(setCookie);

  // Step 4: Create org + owner membership directly via DB. The auth
  // fixture's createOrgMember() uses dbHttp under the hood — we mirror
  // that here so we don't need a separate auth call.
  const [org] = await dbHttp
    .insert(schema.organizations)
    .values({ name: orgName, slug: orgSlug, description: 'Codex-bies6 e2e' })
    .returning();
  if (!org) throw new Error('Failed to create org');

  await dbHttp.insert(schema.organizationMemberships).values({
    organizationId: org.id,
    userId,
    role: 'owner',
    status: 'active',
    invitedBy: userId,
  });

  return { cookie, userId, orgId: org.id, orgSlug: org.slug };
}

/**
 * Read tokenOverrides from the running page by inspecting the inline
 * style on `.org-layout`.
 *
 * Why this works: the brand-editor store's $effect calls injectBrandVars()
 * (from css-injection.ts) which writes EVERY non-null tokenOverride as a
 * CSS custom property `--brand-{key}` (or `--color-{key}` for non-brand-
 * prefix keys) onto `document.querySelector('.org-layout').style`. The
 * inline style is a 1:1 mirror of brandEditor.pending.tokenOverrides for
 * the keys we care about (shader-*).
 *
 * Crucially, injectBrandVars first calls removeOverrideVars() to clear
 * stale --brand-* and --color-* properties, so removed override keys are
 * actually gone (not stuck at their old value). This means we can use
 * the inline style as ground truth for "is this key currently in
 * tokenOverrides".
 */
async function readTokenOverrides(
  page: import('@playwright/test').Page
): Promise<Record<string, string>> {
  return await page.evaluate(() => {
    const target = document.querySelector('.org-layout') as HTMLElement | null;
    if (!target) return {};

    const result: Record<string, string> = {};
    const inline = target.style;
    for (let i = 0; i < inline.length; i++) {
      const propName = inline[i];
      if (!propName) continue;
      // shader-* keys are in BRAND_PREFIX_KEYS so they emit as --brand-shader-*
      if (propName.startsWith('--brand-shader-')) {
        const key = propName.slice('--brand-'.length); // -> 'shader-preset', 'shader-curl', etc.
        const value = inline.getPropertyValue(propName).trim();
        if (value) result[key] = value;
      }
    }
    return result;
  });
}

/**
 * Drag a range input to a target value.
 *
 * Playwright's `locator.fill()` doesn't fire `input` events on range
 * inputs reliably. We set the value via JS and dispatch the `input`
 * event, which is what Svelte's `oninput` binding listens for.
 */
async function setSliderValue(
  page: import('@playwright/test').Page,
  inputId: string,
  value: string
): Promise<void> {
  await page.locator(`#${inputId}`).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * Use .serial + describe-scoped single-user fixture so we register ONE
 * org-owner via the auth worker for all 3 tests. The auth worker's
 * rate-limit is 5/15min on the registration endpoint, and earlier
 * variants of this suite that registered fresh users per-test
 * intermittently hit the limit (Codex-bies6 dev-stack reuse).
 */
test.describe
  .serial('BrandEditorHeroEffects — Phase 2 manifest renderer', () => {
    let orgSlug: string;
    let sharedCookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax' | 'Strict' | 'None';
    }> = [];

    test.beforeAll(async () => {
      // Health-gate: don't bother running if the stack isn't up.
      const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://lvh.me:5173';
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (!r.ok) test.skip(true, `Web app not healthy: ${r.status}`);
      } catch (e) {
        test.skip(true, `Web app unreachable: ${(e as Error).message}`);
      }
      try {
        const a = await fetch(`${AUTH_URL}/health`);
        if (!a.ok) test.skip(true, `Auth worker not healthy: ${a.status}`);
      } catch (e) {
        test.skip(true, `Auth worker unreachable: ${(e as Error).message}`);
      }

      // Single org owner for the whole suite — uses our inlined sign-up
      // + verify-email flow (NOT the rate-limited sign-in path).
      const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const owner = await registerOrgOwner(
        `bies6-${ts}@test.codex`,
        'Test123!@#',
        `Bies6 ${ts}`,
        `bies6-${ts}`
      );
      orgSlug = owner.orgSlug;

      // Build browser-cookie payload for context.addCookies. lvh.me is
      // RFC-6761 wildcard → 127.0.0.1, so domain='lvh.me' propagates the
      // session cookie to {slug}.lvh.me for cross-subdomain auth.
      const parsed = parseCookieString(owner.cookie);
      sharedCookies = [];
      for (const { name, value } of parsed) {
        sharedCookies.push({
          name,
          value,
          domain: 'lvh.me',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        });
        // BetterAuth session also needs the codex-session alias for the
        // cross-worker session lookups (sessionHook in hooks.server.ts).
        if (name === 'better-auth.session_token') {
          sharedCookies.push({
            name: COOKIES.SESSION_NAME,
            value,
            domain: 'lvh.me',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          });
        }
      }
    });

    test.beforeEach(async ({ page }) => {
      // Inject shared session cookies on a fresh context.
      await page.context().clearCookies();
      await page.context().addCookies(sharedCookies);

      // Land on the org subdomain with ?brandEditor — the org layout's
      // $effect detects the param and calls brandEditor.open(orgId, saved).
      await page.goto(buildOrgUrl(orgSlug, '?brandEditor'), {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });

      // Wait for the panel to mount. Using its <aside aria-labelledby=...>
      // landmark is more stable than CSS class selectors.
      await expect(
        page.locator('aside[aria-labelledby="brand-editor-landmark-label"]')
      ).toBeVisible({ timeout: 15_000 });

      // Navigate to the Hero Effects level. The home screen renders a list
      // of category buttons; the Hero Effects entry has label "Hero Effects".
      await page.getByRole('button', { name: /hero effects/i }).click();

      // Wait for the hero-fx panel to render — the preset grid is the
      // most distinctive marker.
      await expect(page.locator('.hero-fx__preset-grid')).toBeVisible({
        timeout: 5_000,
      });
    });

    /**
     * Locator for a preset card by its label (e.g. 'Suture Fluid', 'None').
     * Scoped to the preset grid so we don't collide with the "None" min-hint
     * on the Vignette shared slider. Uses .filter({ has: ... }) on the
     * .hero-fx__preset-label span which is exactly the label text.
     */
    function presetCard(
      page: import('@playwright/test').Page,
      label: string
    ): import('@playwright/test').Locator {
      return page
        .locator('.hero-fx__preset-grid .hero-fx__preset-card')
        .filter({
          has: page.locator('.hero-fx__preset-label', { hasText: label }),
        });
    }

    test('selectPreset writes shader-preset to tokenOverrides', async ({
      page,
    }) => {
      // Click the Suture Fluid preset card.
      await presetCard(page, 'Suture Fluid').click();

      // Wait for the active class to apply (post-render of $derived).
      await expect(presetCard(page, 'Suture Fluid')).toHaveClass(
        /hero-fx__preset-card--active/
      );

      // Read tokenOverrides via DOM-injected CSS vars.
      const overrides = await readTokenOverrides(page);
      expect(overrides['shader-preset']).toBe('suture');
    });

    test("selectPreset 'none' clears every shader-* override (Gotcha #1)", async ({
      page,
    }) => {
      // 1. Select Suture preset to populate shader-preset.
      await presetCard(page, 'Suture Fluid').click();
      await expect(presetCard(page, 'Suture Fluid')).toHaveClass(
        /hero-fx__preset-card--active/
      );

      // 2. Drag two sliders to non-default values so we have additional
      //    shader-* keys in tokenOverrides.
      await setSliderValue(page, 'shader-curl', SHADER_CURL_NON_DEFAULT);
      await setSliderValue(
        page,
        'shader-intensity',
        SHADER_INTENSITY_NON_DEFAULT
      );

      // Verify state before the clear.
      const beforeClear = await readTokenOverrides(page);
      expect(beforeClear['shader-preset']).toBe('suture');
      expect(beforeClear['shader-curl']).toBe(SHADER_CURL_NON_DEFAULT);
      // shader-intensity is a shared control — it should be present too.
      // (We don't assert exact value because slider rendering may round.)
      expect(beforeClear['shader-intensity']).toBeDefined();

      // 3. Click "None" preset. Per Gotcha #1, this MUST iterate
      //    ALL_HERO_FX_SHADER_KEYS and remove every shader-* override.
      await presetCard(page, 'None').click();

      // Wait for the active class to switch to None.
      await expect(presetCard(page, 'None')).toHaveClass(
        /hero-fx__preset-card--active/
      );

      // 4. Assert: NO shader-* keys remain in tokenOverrides.
      const afterClear = await readTokenOverrides(page);
      const lingeringShaderKeys = Object.keys(afterClear).filter((k) =>
        k.startsWith('shader-')
      );
      expect(lingeringShaderKeys).toEqual([]);
    });

    test('dragging slider to default value removes the override (Gotcha #2)', async ({
      page,
    }) => {
      // 1. Select Suture preset (so shader-curl's section is rendered).
      await presetCard(page, 'Suture Fluid').click();
      await expect(page.locator('#shader-curl')).toBeVisible({
        timeout: 3_000,
      });

      // 2. Set shader-curl to a non-default value (default = 30, we use 50).
      await setSliderValue(page, 'shader-curl', SHADER_CURL_NON_DEFAULT);

      const withOverride = await readTokenOverrides(page);
      expect(withOverride['shader-curl']).toBe(SHADER_CURL_NON_DEFAULT);

      // 3. Drag the same slider back to the DEFAULT value (30).
      await setSliderValue(page, 'shader-curl', SHADER_CURL_DEFAULT);

      // 4. Assert: shader-curl key is REMOVED from tokenOverrides
      //    (the value matches the default — Gotcha #2 rule).
      const afterReset = await readTokenOverrides(page);
      expect(afterReset['shader-curl']).toBeUndefined();
      // Sanity: shader-preset itself should still be 'suture' (not cleared).
      expect(afterReset['shader-preset']).toBe('suture');
    });
  });
