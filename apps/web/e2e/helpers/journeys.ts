/**
 * Journey / portal E2E helpers — fixtures, auth, and the FOUR MEASUREMENT TRAPS
 * that make this surface lie to anyone who measures it naively.
 *
 * WHY THIS FILE EXISTS. Before it, the journey builder and the whole public
 * sales surface had ZERO browser coverage: 11 section types, 62 compositions,
 * 9 design axes, the inline canvas, the variant picker and the checkout funnel,
 * and not one Playwright spec matching `journey`, `data-jp-`, `jp-sec` or
 * `studio/journeys`. Every defect found on this surface was found by an agent
 * driving a browser by hand — four rounds of it. The traps below are the reason
 * that was so expensive, and they are encoded HERE rather than restated in each
 * spec so the next author cannot repeat them.
 *
 * ── TRAP 1 · 29 OF 37 TEXT LEAVES SIT AT OPACITY 0 ────────────────────────────
 * `reveal.ts` arms `.reveal--armed` from JS and only removes it when the element
 * intersects. That is correct progressive enhancement (immediate-reveal for
 * reduced motion, for no IntersectionObserver, and for SSR — a no-JS client gets
 * fully painted content), so DO NOT "fix" it. But it means a `fullPage`
 * screenshot of an un-scrolled journey page captures almost-empty sections —
 * which is exactly why the repo's own `--project=visual` snapshots of this
 * surface are blank. Call {@link forceRevealsIn} before asserting on geometry or
 * capturing anything.
 *
 * ── TRAP 2 · THE ORG OWNER NEVER SEES THEIR OWN SELL PAGE ─────────────────────
 * An entitled viewer (and the org owner always is) is redirected off
 * `/journeys/<slug>` to `/journeys/<slug>/dashboard`. A spec that signs in to
 * use the builder and then measures "the public page" is measuring the
 * DASHBOARD. Worse, `?preview=1` bypasses the REDIRECT but not the CTA
 * resolution, so an owner's preview shows "Go to your dashboard" where a
 * visitor sees "Begin". Measure a visitor's CTA SIGNED OUT, or from an org you
 * are not a member of. {@link expectSellPageRendered} fails loudly rather than
 * silently measuring the wrong page.
 *
 * ── TRAP 3 · A LOAD-THROWN 404 RETURNS HTTP 200 ───────────────────────────────
 * `@sveltejs/kit@2.55.0`'s `render_response()` builds the streaming `Response`
 * without passing `status` through (Codex-nqop3 — an UPSTREAM bug, root-caused
 * in round 3, not a defect in this app). So the status code is worthless as
 * evidence on this surface. Assert the rendered title and section count.
 *
 * ── TRAP 4 · AUTH RATE LIMIT ──────────────────────────────────────────────────
 * `/api/auth/sign-in/email` allows 5 requests / 15 minutes keyed on the
 * CREDENTIAL, so a synthetic IP does not protect a repeated sign-in as the same
 * seeded user. {@link signInAsSeededUser} therefore uses `/api/test/fast-signin`
 * — which calls BetterAuth's handler INSIDE the worker and so never passes
 * through the Hono limiter at all — and caches the cookie set per process so a
 * whole spec file costs at most one call per user.
 */

import { expect, type Page } from '@playwright/test';
import {
  aliasSessionCookies,
  type BrowserCookie,
  parseSetCookieHeaders,
} from './auth-cookies';

/** Shared password for every seeded account (`reference_test_credentials`). */
export const SEEDED_PASSWORD = 'Test1234!';

/**
 * The platform's generic meta description, emitted by the ROOT layout as the
 * fallback for any route that publishes no `pageMeta`. A journey page must never
 * be described by it: before O32's fix the layout and the page BOTH emitted a
 * `<meta name="description">`, the layout's came first, and a parser takes the
 * first value — so every journey page's search snippet was the platform tagline.
 */
export const PLATFORM_META_DESCRIPTION =
  'Discover transformative content from independent creators';

export interface JourneyFixture {
  /** Org slug — also the subdomain the page is served from. */
  readonly org: string;
  /** `landing_pages.slug`, which is the key BOTH the sell page and the checkout resolve by. */
  readonly pageSlug: string;
  /** The org owner, who can open the builder for this page. */
  readonly owner: string;
  /**
   * Whether the course has a real way in (`deriveOfferPaths(...).length > 0`).
   * FIVE OF THE SEVEN SEEDED COURSES HAVE `price_cents IS NULL` — the
   * non-purchasable case is the MAJORITY case here, not an edge case, which is
   * why round 1's whole fix was about it.
   */
  readonly purchasable: boolean;
  /**
   * The stored section types, in stored order. `db:seed:portals` writes the
   * same four for every page. Refresh with:
   *   psql -h db.localtest.me -p 5432 -U postgres -d main -At -c "select o.slug
   *     ||' '||lp.slug||' '||(select string_agg(s->>'type', ',' order by ord)
   *     from jsonb_array_elements(lp.sections) with ordinality t(s, ord))
   *     from landing_pages lp join organizations o on o.id=lp.organization_id
   *     where lp.deleted_at is null order by 1;"
   */
  readonly sections: readonly string[];
}

/**
 * The seven published portal pages `pnpm --filter @codex/database db:seed:portals`
 * leaves behind, verified live. NEVER run `pnpm db:seed` or `db:reset` to
 * refresh them — those TRUNCATE (Codex-bsbf8); `db:seed:portals` is INSERT-only
 * and idempotent.
 *
 * `studio-alpha` (#E11D48) vs `studio-beta` (#2563EB) is the brand-neutrality
 * pair; `of-blood-and-bones` is the fully-branded case (cream/near-black,
 * Playfair) and the only org with a purchasable course.
 */
export const JOURNEY_FIXTURES: readonly JourneyFixture[] = [
  {
    org: 'of-blood-and-bones',
    pageSlug: 'ancestral-threads',
    owner: 'luzura@test.com',
    purchasable: true,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'return-to-the-shoreline',
    owner: 'luzura@test.com',
    purchasable: true,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'bone-deep',
    owner: 'luzura@test.com',
    purchasable: false,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'tending-the-grief',
    owner: 'luzura@test.com',
    purchasable: false,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'studio-alpha',
    pageSlug: 'bone-deep',
    owner: 'creator@test.com',
    purchasable: false,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'studio-alpha',
    pageSlug: 'tending-the-grief',
    owner: 'creator@test.com',
    purchasable: false,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
  {
    org: 'studio-beta',
    pageSlug: 'bone-deep',
    owner: 'admin@test.com',
    purchasable: false,
    sections: ['hero', 'ache', 'map', 'invite'],
  },
];

/** The fixture for one org + page slug. Throws rather than returning undefined. */
export function journeyFixture(org: string, pageSlug: string): JourneyFixture {
  const found = JOURNEY_FIXTURES.find(
    (f) => f.org === org && f.pageSlug === pageSlug
  );
  if (!found) {
    throw new Error(
      `No journey fixture for ${org}/${pageSlug} — add it to JOURNEY_FIXTURES ` +
        'in apps/web/e2e/helpers/journeys.ts'
    );
  }
  return found;
}

/**
 * Build an absolute URL on an org's subdomain from the configured `baseURL`.
 *
 * The org slug lives in the HOSTNAME, never the path, so a journey page cannot
 * be reached with a root-relative `page.goto()` unless the browser is already on
 * that subdomain. Reading the port from `baseURL` keeps every spec portable
 * between the default `lvh.me:5173` and a `PLAYWRIGHT_BASE_URL` override (this
 * effort's worktree serves on `:3010`).
 */
export function orgUrl(baseUrl: string, org: string, path: string): string {
  const base = new URL(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base.protocol}//${org}.${base.host}${suffix}`;
}

/** `orgUrl` bound to the spec's configured baseURL, for use inside a test. */
export function journeyUrl(
  baseUrl: string,
  fixture: JourneyFixture,
  surface: '' | '/checkout' | '/dashboard' = '',
  search = ''
): string {
  return orgUrl(
    baseUrl,
    fixture.org,
    `/journeys/${fixture.pageSlug}${surface}${search}`
  );
}

/**
 * Per-process cookie cache, keyed by email. `fast-signin` is not rate limited,
 * so this is an efficiency measure rather than a correctness one — but a spec
 * file that signs in once instead of once per test is also a spec file that
 * cannot be blamed for a rate-limit storm somebody else caused.
 */
const cookieCache = new Map<string, BrowserCookie[]>();

/**
 * Sign in as a seeded user through `/api/test/fast-signin`.
 *
 * WHY NOT the existing `loginAsSeededCreator` / `captureSeededCreatorCookies`:
 * those drive `/api/auth/sign-in/email`, which is limited to 5 req / 15 min per
 * CREDENTIAL, and they only know the one seeded creator. Journey fixtures span
 * three orgs with three different owners, and `of-blood-and-bones` is owned by
 * `luzura@test.com` — the account with no helper at all. `fast-signin` calls
 * BetterAuth's handler inside the auth worker (dev/test only), so it is exempt
 * from the Hono limiter entirely and works for any seeded account.
 *
 * MUST POST to `lvh.me:42069`, not `localhost:42069`: the worker emits
 * `Domain=.lvh.me` and Chromium silently DROPS a cookie whose Domain does not
 * match the response host. That silent drop is the single most expensive gotcha
 * in this suite (see apps/web/e2e/CLAUDE.md).
 */
export async function signInAsSeededUser(
  page: Page,
  email: string
): Promise<void> {
  let cookies = cookieCache.get(email);
  if (!cookies) {
    const response = await page.request.post(
      'http://lvh.me:42069/api/test/fast-signin',
      {
        headers: { 'Content-Type': 'application/json' },
        data: { email, password: SEEDED_PASSWORD },
      }
    );
    if (!response.ok()) {
      throw new Error(
        `fast-signin failed for ${email}: ${response.status()} ` +
          `${(await response.text()).slice(0, 200)}`
      );
    }
    cookies = aliasSessionCookies(parseSetCookieHeaders(response));
    cookieCache.set(email, cookies);
  }
  await page.context().addCookies(cookies);
}

/**
 * Force every armed scroll-reveal into its in-state — TRAP 1.
 *
 * Adds `.is-in` rather than scrolling the page, because scrolling a journey page
 * to its full height also arms the `FloatingCta` and moves the layout under a
 * measurement that is already in flight. Returns how many elements were armed so
 * a caller can prove it did something (0 on a page whose reveals have already
 * fired, which is a legitimate state — not a reason to fail).
 */
export async function forceRevealsIn(
  page: Page,
  scope = ':root'
): Promise<number> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) ?? document;
    const armed = root.querySelectorAll('.reveal--armed');
    for (const element of armed) element.classList.add('is-in');
    return armed.length;
  }, scope);
}

export interface SettleOptions {
  /**
   * Minimum time to keep sampling even once the count looks stable. THE FLOOR IS
   * LOAD-BEARING: the builder canvas has TWO independent async feeds (the
   * curriculum read and the offer read) and a stability window alone converges in
   * the GAP between them. Measured on `of-blood-and-bones/ancestral-threads`: a
   * stability-only wait returned after ~2.5s with the invite section showing 5
   * text blocks; the same page 12s later showed 10, because the offer had landed
   * and the price card had rendered. A fixed short timeout under-reports canvas
   * fidelity, which makes a parity assertion PASS while broken.
   */
  readonly floorMs?: number;
  /** Consecutive unchanged samples required. Default 4 (= 3s at the default interval). */
  readonly stableSamples?: number;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

/**
 * Wait until a subtree's descendant count stops changing — TRAP for anything
 * measuring the builder canvas.
 *
 * Measured on the same section, same page: 0 descendants at 5.1s, 82 at 7.2s,
 * then stable. Never use a fixed timeout here.
 *
 * Returns the settled count so a spec can assert it is non-zero — a "stable"
 * count of zero means nothing rendered, and that has to fail rather than pass.
 */
export async function settleSubtree(
  page: Page,
  scope: string,
  options: SettleOptions = {}
): Promise<number> {
  const floorMs = options.floorMs ?? 6000;
  const stableSamples = options.stableSamples ?? 4;
  const intervalMs = options.intervalMs ?? 750;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const startedAt = Date.now();
  let previous = -1;
  let stable = 0;
  let count = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(intervalMs);
    try {
      count = await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        return root ? root.querySelectorAll('*').length : -1;
      }, scope);
    } catch {
      // "Execution context was destroyed, most likely because of a navigation".
      // Observed for real: against a Vite DEV server, an edit anywhere in the
      // studio's module graph triggers an HMR full reload mid-measurement, and
      // the studio sub-tree is `ssr = false` so the reload is a full remount.
      // A reload is not a stable tree, so reset and keep sampling rather than
      // failing — the run is then only as slow as the reload, instead of red for
      // a reason that has nothing to do with the canvas.
      count = -1;
      stable = 0;
      previous = -2;
      continue;
    }
    stable = count === previous ? stable + 1 : 0;
    previous = count;
    if (stable >= stableSamples && Date.now() - startedAt >= floorMs) break;
  }
  return count;
}

/**
 * Wait until the builder canvas is fully populated — the ONLY reliable wait for
 * this surface, and the one a count-stability heuristic alone does not give you.
 *
 * WHY NETWORK IDLE AND NOT JUST A SETTLED DOM. The builder fires SEVEN remote
 * reads, and the two the canvas actually renders from land LAST and far apart.
 * Timed on `of-blood-and-bones/ancestral-threads` against the local stack:
 *
 *     +5.6s   getJourneyForBuilder     (the draft — the canvas paints here)
 *     +9.4s   resolveSellPreview
 *     +10.6s  getCourseCurriculum      (the `map` section's stages)
 *     +12.6s  getCourseOffer           (the `invite` section's priced paths)
 *     +13.1s  network idle
 *
 * A stability window of 3s with an 8s floor therefore returns a canvas whose
 * invite section is still drawing the PRICE-LESS branch — measured, 5 text blocks
 * against the published page's 10 — and a fingerprint comparison run on it
 * reports a divergence that does not exist. That is not a hypothetical: it is
 * what this spec did on its second run before this helper existed.
 *
 * So: network idle first (deterministic — every read has answered), then the
 * count-stability pass for the DOM to catch up with the last answer.
 */
export async function settleBuilderCanvas(
  page: Page,
  options: SettleOptions = {}
): Promise<number> {
  // 60s, not the suite's usual 30s: the studio sub-tree is `ssr = false`, so the
  // first paint waits on the client bundle AND on `getJourneyForBuilder`, which
  // was measured landing at ~5.6s on a quiet local stack and did not arrive
  // inside 30s on a contended one. A spec that fails here has learned nothing
  // about the canvas.
  await page.locator('.jbc-page .jp-sec').first().waitFor({ timeout: 60_000 });
  // A generous budget: the reads above are sequential against a cold local
  // stack. Failing here is more useful than measuring a half-loaded canvas, so
  // this deliberately does NOT swallow the timeout.
  await page.waitForLoadState('networkidle', { timeout: 45_000 });
  return settleSubtree(page, '.jbc-page', { floorMs: 1500, ...options });
}

/**
 * Resize the viewport until `.jp-sec`'s own inline size equals `targetPx` —
 * THE TRAP THAT MADE THE ORIGINAL CANVAS-vs-PUBLIC AUDIT INCONCLUSIVE.
 *
 * `.jp-sec` carries `container-type: inline-size`, so every one of the journey
 * CSS's 19 `@container` rules resolves against ITS width, not the viewport's.
 * At a 1440 viewport the published section measures 1440 - 64 = 1376px, so
 * comparing a 1440px canvas against a 1440px viewport still compares two
 * different container widths; 8 of the 19 rules resolve to opposite branches
 * across a gap that size, including the one that stacks `hero.split-media` into
 * one column. The original audit compared 834 against 770 and concluded nothing.
 *
 * Iterative rather than arithmetic because the inset is not a constant: it
 * depends on whether a scrollbar is present, which depends on the content, which
 * depends on the width. Two passes converge in practice; four is the cap.
 */
export async function matchInlineSize(
  page: Page,
  targetPx: number,
  selector = '.jp-sec'
): Promise<number> {
  const readWidth = () =>
    page.evaluate((sel) => {
      const element = document.querySelector(sel) as HTMLElement | null;
      // `offsetWidth`, not `getBoundingClientRect().width`: the builder canvas
      // is `transform: scale()`d, and the container query resolves against the
      // LAYOUT width (which offsetWidth reports) rather than the painted one.
      return element ? element.offsetWidth : -1;
    }, selector);

  let viewport = page.viewportSize()?.width ?? targetPx;
  let width = await readWidth();
  for (let attempt = 0; attempt < 4 && width !== targetPx; attempt++) {
    if (width <= 0) break;
    viewport += targetPx - width;
    await page.setViewportSize({
      width: viewport,
      height: page.viewportSize()?.height ?? 900,
    });
    await page.waitForTimeout(250);
    width = await readWidth();
  }
  return width;
}

export interface JourneyHeadTags {
  readonly title: string;
  readonly descriptions: readonly string[];
  readonly canonicals: readonly string[];
  readonly ogTypes: readonly string[];
  readonly robots: readonly string[];
  readonly ogDescriptions: readonly string[];
  /** `Course.description` from the page's JSON-LD, or null when absent. */
  readonly jsonLdDescription: string | null;
  readonly sectionTypes: readonly string[];
}

/**
 * Read every head tag that has ever been duplicated on this surface — ALL of
 * them, not `querySelector`'s first match, because "exactly one" is the whole
 * assertion. `<svelte:head>` dedupes only `<title>`, so a page that set its own
 * `description` used to APPEND a second tag after the root layout's and lose to
 * it.
 *
 * `jsonLdDescription` is here so a spec can prove the surviving `description` is
 * the PAGE's own without hardcoding a course lede: the page derives both from one
 * `pageMeta.description`, so they agree only if the page's tag is the one that
 * survived. The root layout's generic fallback would not match.
 */
export async function readJourneyHead(page: Page): Promise<JourneyHeadTags> {
  return page.evaluate(() => {
    const contents = (selector: string): string[] =>
      [...document.querySelectorAll(selector)].map(
        (element) => element.getAttribute('content') ?? ''
      );
    let jsonLdDescription: string | null = null;
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]'
    )) {
      try {
        const parsed = JSON.parse(script.textContent ?? '{}') as {
          '@type'?: string;
          description?: string;
        };
        if (parsed['@type'] === 'Course' && parsed.description) {
          jsonLdDescription = parsed.description;
        }
      } catch {
        // A malformed JSON-LD block is a finding for another spec, not a reason
        // to fail the head read.
      }
    }
    return {
      title: document.title,
      descriptions: contents('meta[name="description"]'),
      canonicals: [...document.querySelectorAll('link[rel="canonical"]')].map(
        (element) => element.getAttribute('href') ?? ''
      ),
      ogTypes: contents('meta[property="og:type"]'),
      robots: contents('meta[name="robots"]'),
      ogDescriptions: contents('meta[property="og:description"]'),
      jsonLdDescription,
      sectionTypes: [...document.querySelectorAll('[data-section-type]')].map(
        (element) => (element as HTMLElement).dataset.sectionType ?? ''
      ),
    };
  });
}

/**
 * Assert we are actually looking at a rendered SELL page — TRAPS 2 and 3
 * together.
 *
 * HTTP 200 is not evidence here (a load-thrown 404 also returns 200), and an
 * entitled viewer is redirected to `/dashboard` with no error at all. Both
 * failure modes produce a page that *looks* fine to a status check and has no
 * sections. So: assert the URL is still the sell page and the stored sections
 * rendered, in order.
 */
export async function expectSellPageRendered(
  page: Page,
  fixture: JourneyFixture
): Promise<void> {
  expect(
    new URL(page.url()).pathname,
    'redirected off the sell page — an entitled viewer (the org owner always is) ' +
      'goes to /dashboard; measure signed out or from an org you do not belong to'
  ).toBe(`/journeys/${fixture.pageSlug}`);

  // POLLED, not read once. Observed failing against a Vite DEV server on a
  // perfectly healthy page: a sibling edit anywhere in the module graph triggers
  // an HMR invalidation, and a read landing in that window sees an EMPTY
  // document and reports "no sections rendered" — which is indistinguishable
  // from the real defect this assertion exists to catch. Polling makes the two
  // distinguishable: a real empty render stays empty for the whole budget.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll('[data-section-type]')].map(
            (element) => (element as HTMLElement).dataset.sectionType
          )
        ),
      {
        message:
          'the stored sections did not render in stored order — note a ' +
          'load-thrown 404 on this surface still returns HTTP 200 ' +
          '(Codex-nqop3, upstream SvelteKit)',
        timeout: 15_000,
      }
    )
    .toEqual([...fixture.sections]);
}

/**
 * The page id the builder route takes, resolved from the studio portal list
 * rather than hardcoded.
 *
 * `/studio/journeys/[id]/page` takes the LANDING PAGE id, not the course id —
 * feeding it a course id used to hang on "Loading page…" forever (Codex-b0fm6,
 * now a named empty state). Resolving it from the list keeps this spec working
 * after any re-seed, and exercises the route a creator actually takes.
 */
export async function resolveBuilderPageId(
  page: Page,
  fixture: JourneyFixture,
  baseUrl: string
): Promise<string> {
  await page.goto(orgUrl(baseUrl, fixture.org, '/studio/journeys'));
  const row = page
    .locator('.journey-row')
    .filter({
      has: page.locator(`a[href="/journeys/${fixture.pageSlug}?preview=1"]`),
    })
    .first();
  await expect(
    row,
    `no portal row for ${fixture.org}/${fixture.pageSlug} in the studio list — ` +
      're-seed with `pnpm --filter @codex/database db:seed:portals -- --org=' +
      `${fixture.org}\` (INSERT-only; never \`db:seed\`, which TRUNCATES)`
  ).toBeVisible({ timeout: 30_000 });

  const href = await row.locator('.journey-row__title').getAttribute('href');
  const id = href?.match(/\/studio\/journeys\/([^/]+)\/page/)?.[1];
  expect(id, `could not read a builder page id out of ${href}`).toBeTruthy();
  return id as string;
}
