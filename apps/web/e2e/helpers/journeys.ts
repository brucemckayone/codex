/**
 * Journey / portal E2E helpers — fixtures, auth, and the THREE MEASUREMENT TRAPS
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
 */

import { expect, type Page } from '@playwright/test';

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
   * The STORED section types, in stored order — v2 kit ids since WP-9b
   * (`db:seed:portals` writes the same nine for every page), which is also
   * exactly what the kit renders as `data-lp-type`. Refresh with:
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
 * pair; `of-blood-and-bones` is the fully-branded case (its own serif and
 * palette) and the only org with purchasable courses.
 */

/** The nine v2 sections `db:seed:portals` writes for every seeded page. */
const SEEDED_SECTIONS: readonly string[] = [
  'hero',
  'problem',
  'transformation',
  'benefits',
  'curriculum',
  'instructor',
  'pricing',
  'faq',
  'cta',
];

export const JOURNEY_FIXTURES: readonly JourneyFixture[] = [
  {
    org: 'of-blood-and-bones',
    pageSlug: 'ancestral-threads',
    owner: 'luzura@test.com',
    purchasable: true,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'return-to-the-shoreline',
    owner: 'luzura@test.com',
    purchasable: true,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'bone-deep',
    owner: 'luzura@test.com',
    purchasable: false,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'of-blood-and-bones',
    pageSlug: 'tending-the-grief',
    owner: 'luzura@test.com',
    purchasable: false,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'studio-alpha',
    pageSlug: 'bone-deep',
    owner: 'creator@test.com',
    purchasable: false,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'studio-alpha',
    pageSlug: 'tending-the-grief',
    owner: 'creator@test.com',
    purchasable: false,
    sections: SEEDED_SECTIONS,
  },
  {
    org: 'studio-beta',
    pageSlug: 'bone-deep',
    owner: 'admin@test.com',
    purchasable: false,
    sections: SEEDED_SECTIONS,
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
      // `data-lp-type` (kit `SectionShell`), not the legacy renderer's
      // `data-section-type` (Codex-61zsk.6 · WP-6).
      sectionTypes: [...document.querySelectorAll('[data-lp-type]')].map(
        (element) => (element as HTMLElement).dataset.lpType ?? ''
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
        // `data-lp-type` (kit `SectionShell`), not the legacy renderer's
        // `data-section-type` (Codex-61zsk.6 · WP-6): the public page now
        // renders through the kit, which upgrades a stored row to v2 at the
        // load choke point.
        page.evaluate(() =>
          [...document.querySelectorAll('[data-lp-type]')].map(
            (element) => (element as HTMLElement).dataset.lpType
          )
        ),
      {
        message:
          'the stored sections did not render in stored order — note a load-thrown 404 on this surface still ' +
          'returns HTTP 200 (Codex-nqop3, upstream SvelteKit)',
        timeout: 15_000,
      }
    )
    // Seeds store v2 types, which is exactly what the kit puts in the DOM.
    .toEqual([...fixture.sections]);
}
