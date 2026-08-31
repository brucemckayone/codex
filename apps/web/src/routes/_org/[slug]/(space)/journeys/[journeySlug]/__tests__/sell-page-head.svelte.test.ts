/**
 * Public journey sales page — the `<svelte:head>` contract (WP-4).
 *
 * The most SEO-critical public surface in the product. What it emits is not
 * observable from the server-load test beside this one (that one locks the
 * shell/stream wiring), and "HTTP 200" says nothing about a share card, so the
 * head is pinned HERE, against the rendered document.
 *
 * WHAT EACH GROUP IS DEFENDING, and why it is worth a test:
 *
 *   1. `?preview` MUST NOT BE INDEXABLE. The builder's "View live ↗" opens
 *      `/journeys/<slug>?preview=1` (studio `page/+page.svelte`), and the sell
 *      load treats ANY `?preview` value as a bypass of the entitled→dashboard
 *      redirect (`+page.server.ts:175`, `.has()` — so `?preview=0` bypasses too).
 *      That makes the URL a creator copies out of that tab a fully-rendered
 *      second address for the canonical page. The `robots` predicate here mirrors
 *      the load's `.has()` EXACTLY; if the two ever disagree, one of them is
 *      wrong, and the failure is silent (a duplicate quietly competing with the
 *      page it duplicates).
 *
 *   2. THE CANONICAL IS QUERY-FREE. It is the only thing that consolidates
 *      `?preview=1`, `?utm_source=…` and every future param onto one URL.
 *
 *   3. og:image RIDES THE AWAITED ENVELOPE. `course.coverImageUrl` is the only
 *      image the head can have: the hero still arrives on the STREAMED
 *      `sellPreview` promise, and a head is flushed long before one settles.
 *
 *   4. `seo` OVERRIDES FALL BACK ON THE EMPTY STRING, not just on absence. A
 *      creator who clears the meta title must get the course title back, so the
 *      derivation uses `||`; a `??` would emit an empty `<title>` and pass any
 *      test that only checked the absent case. Both cases are asserted. (The
 *      DESCRIPTION half of that rule now lives in the load, and is asserted in
 *      `page.server.test.ts` — see group 5.)
 *
 *   5. THIS PAGE MUST NOT EMIT `description` OR `og:type` (O32). The ROOT layout
 *      emits exactly one of each from `data.pageMeta`. Before that, both were
 *      emitted twice — root first, page second — and because a parser takes the
 *      FIRST value of a repeated Open Graph property, the page's
 *      `og:type="product"` was DEAD and every journey snippet was shadowed by
 *      the platform tagline. So the assertion here is a NEGATIVE one: re-adding
 *      either tag to this component silently restores the duplication, and the
 *      root's generic value wins again. `og:description` / `twitter:description`
 *      are NOT duplicated by the root, so those stay and are asserted present.
 *
 *   6. EVERY PRICE COMES FROM THE OFFER, NEVER FROM `course.priceCents`. The
 *      JSON-LD used to read the course row while the visible sections read
 *      `context.offer`, and the two disagree by design — `updateJourneyOffer`
 *      NULLs `price_cents` when the one-off path is switched off. The cases
 *      below pin all three directions: a one-off course, a subscription-only
 *      course (which used to publish NO price at all to a crawler while showing
 *      the reader a monthly one), and a withdrawn course.
 *
 * Mounts the real route component (jsdom, `resolve.conditions: ['browser']`), so
 * these are assertions about the DOM a crawler is served, not about a derived
 * string.
 */
import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';

// `page.url` decides the canonical + the noindex, so it is the one thing these
// tests vary. A getter (not a captured value) so each test can re-point it
// before mounting; `vi.hoisted` because the mock factory can run before this
// module's top-level `let`s are initialised.
const { urlRef } = vi.hoisted(() => ({
  urlRef: { current: null as URL | null },
}));

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return urlRef.current;
    },
  },
}));

import Page from '../+page.svelte';

const CLEAN_URL = 'http://of-blood-and-bones.lvh.me:3010/journeys/bone-deep';
const CANONICAL = 'http://of-blood-and-bones.lvh.me:3010/journeys/bone-deep';
const ORIGIN = 'http://of-blood-and-bones.lvh.me:3010';
/** Whatever the load derived; this component only forwards it. */
const DEFAULT_DESCRIPTION = 'Slow work, close to the bone.';

function coursePage(
  page: Partial<JourneyCoursePage['page']> = {},
  course: Partial<JourneyCoursePage['course']> = {}
): JourneyCoursePage {
  return {
    page: {
      id: '00000000-0000-4000-8000-0000000000a0',
      organizationId: '00000000-0000-4000-8000-000000000001',
      publishedAt: '2026-08-01T00:00:00.000Z',
      pageType: 'course',
      slug: 'bone-deep',
      title: 'Bone Deep',
      status: 'published',
      subjectType: 'course',
      subjectId: '00000000-0000-4000-8000-0000000000c0',
      brandOverrides: null,
      sections: [],
      ...page,
    },
    course: {
      id: '00000000-0000-4000-8000-0000000000c0',
      slug: 'bone-deep',
      title: 'Bone Deep',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: null,
      stageCount: 0,
      practiceCount: 0,
      ...course,
    },
    stages: [],
    testimonials: [],
  };
}

/**
 * A `CourseOffer` with just the paths a case needs. Defaults to NO path at all —
 * the withdrawn-course shape, which is 5 of the 7 seeded dev courses — so every
 * price assertion below has to opt IN to a price rather than inherit one.
 */
function offer(shape: Partial<CourseOffer> = {}): CourseOffer {
  return {
    courseId: '00000000-0000-4000-8000-0000000000c0',
    organizationId: '00000000-0000-4000-8000-000000000001',
    paths: [],
    purchase: null,
    subscription: null,
    tiers: [],
    entitled: false,
    ...shape,
  } satisfies CourseOffer;
}

let component: ReturnType<typeof mount> | null = null;
let baselineHead: Element[] = [];

function render(opts: {
  url?: string;
  draftPreview?: boolean;
  page?: Partial<JourneyCoursePage['page']>;
  course?: Partial<JourneyCoursePage['course']>;
  /** The AUTHORITATIVE offer — the only source of any price on this page. */
  offer?: CourseOffer | null;
  /** What the load publishes for the ROOT layout to render (O32). */
  pageMeta?: { description?: string; ogType?: string };
  /** The org layout's awaited data, which backs the JSON-LD `provider`. */
  org?: { name: string } | null;
}): void {
  urlRef.current = new URL(opts.url ?? CLEAN_URL);
  // The route's real `PageData` carries the whole layout tree; this fixture
  // supplies only what the load returns and the head reads, so it is cast once
  // here rather than stubbing an org layout the head never touches.
  const props = {
    data: {
      coursePage: coursePage(opts.page, opts.course),
      orgSlug: 'of-blood-and-bones',
      enrolled: false,
      offer: opts.offer ?? null,
      pageMeta: opts.pageMeta ?? { description: DEFAULT_DESCRIPTION },
      org: 'org' in opts ? opts.org : { name: 'Of Blood & Bones' },
      draftPreview: opts.draftPreview ?? false,
      sellPreview: Promise.resolve(null),
    },
  } as unknown as ComponentProps<typeof Page>;

  component = mount(Page, { target: document.body, props });
  // `<title>` is set from a render effect (the other head tags are template
  // output and land synchronously). Without this flush `document.title` is still
  // '' and every title assertion below would fail for the wrong reason.
  flushSync();
}

/** `<meta name=…>` / `<meta property=…>` content, or null when absent. */
function meta(key: string): string | null {
  const el =
    document.head.querySelector(`meta[name="${key}"]`) ??
    document.head.querySelector(`meta[property="${key}"]`);
  return el?.getAttribute('content') ?? null;
}

/**
 * HOW MANY of a tag the COMPONENT emits. The count is the whole point of the
 * O32 group: `meta()` above returns the first match and would happily pass on a
 * page emitting two.
 */
function metaCount(key: string): number {
  return document.head.querySelectorAll(
    `meta[name="${key}"], meta[property="${key}"]`
  ).length;
}

function linkHref(rel: string): string | null {
  return (
    document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ??
    null
  );
}

/**
 * The parsed JSON-LD, read back out of the document exactly as a crawler would.
 * `StructuredData` escapes every `<` as a `<` JSON escape before injecting
 * the script, so parsing the served text (rather than inspecting a derived
 * object) is what proves the payload actually survives that round trip.
 */
function jsonLd(): Record<string, unknown> | null {
  const el = document.head.querySelector('script[type="application/ld+json"]');
  if (!el) return null;
  return JSON.parse(el.textContent ?? 'null');
}

beforeAll(() => {
  baselineHead = [...document.head.children];
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  // Svelte's head anchors can outlive an unmount; a leaked tag from the previous
  // test would make the next one pass for the wrong reason.
  for (const el of [...document.head.children]) {
    if (!baselineHead.includes(el)) el.remove();
  }
});

describe('journey sell page <svelte:head>', () => {
  // ── the canonical (query-free) ────────────────────────────────────────────
  it('emits a canonical + og:url stripped of the query string', () => {
    render({ url: `${CLEAN_URL}?preview=1&utm_source=newsletter` });

    expect(linkHref('canonical')).toBe(CANONICAL);
    expect(meta('og:url')).toBe(CANONICAL);
  });

  // ── the noindex predicate, both directions ────────────────────────────────
  it('does NOT noindex the real page (the negative control)', () => {
    render({ url: CLEAN_URL });

    // The whole point of the tag is that it is CONDITIONAL. Without this case a
    // blanket noindex would pass every assertion below and de-index the product.
    expect(meta('robots')).toBeNull();
  });

  it('noindexes ?preview=1 — the URL the builder hands the creator', () => {
    render({ url: `${CLEAN_URL}?preview=1` });

    expect(meta('robots')).toBe('noindex, nofollow');
  });

  it('noindexes ?preview=0 too — PRESENCE is the signal, as in the load', () => {
    // `+page.server.ts` bypasses the entitlement redirect on `.has('preview')`,
    // so `?preview=0` is a preview URL. The head must agree with the load.
    render({ url: `${CLEAN_URL}?preview=0` });

    expect(meta('robots')).toBe('noindex, nofollow');
  });

  it('noindexes a draft preview even with no query param', () => {
    render({
      draftPreview: true,
      page: { status: 'draft', publishedAt: null },
    });

    expect(meta('robots')).toBe('noindex, nofollow');
  });

  it('leaves an unrelated query param indexable (canonical consolidates it)', () => {
    render({ url: `${CLEAN_URL}?utm_source=newsletter` });

    expect(meta('robots')).toBeNull();
    expect(linkHref('canonical')).toBe(CANONICAL);
  });

  // ── the share card ────────────────────────────────────────────────────────
  it('emits og:image from the AWAITED cover and asks for a large card', () => {
    render({
      course: { coverImageUrl: 'http://cdn.test/courses/c1/cover/md.webp' },
    });

    expect(meta('og:image')).toBe('http://cdn.test/courses/c1/cover/md.webp');
    expect(meta('twitter:card')).toBe('summary_large_image');
  });

  it('omits og:image and falls back to a small card with no cover', () => {
    render({ course: { coverImageUrl: null } });

    // An `og:image` pointing at nothing is worse than none: the platforms cache
    // a broken card. `summary` is the honest shape for a text-only share.
    expect(meta('og:image')).toBeNull();
    expect(meta('twitter:card')).toBe('summary');
  });

  // ── the page must NOT duplicate the root layout's two tags (O32) ───────────
  it('emits NEITHER description NOR og:type — the root layout owns both', () => {
    render({ pageMeta: { description: 'Slow work.', ogType: 'product' } });

    // Emitting either here does not override the root's copy, it APPENDS a
    // second tag, and a parser takes the FIRST value of a repeated Open Graph
    // property — which is exactly how `og:type="product"` came to be dead on
    // arrival while the generic `website` won. The load publishes `pageMeta`
    // instead, and the root renders one of each.
    expect(metaCount('description')).toBe(0);
    expect(metaCount('og:type')).toBe(0);
  });

  it('still emits og:description + twitter:description from the load value', () => {
    // These two are NOT duplicated by the root, so they belong to the page —
    // and they must read the same one string the root's `description` does, or
    // the head would state two different descriptions for one page.
    render({ pageMeta: { description: 'Slow work, close to the bone.' } });

    expect(meta('og:description')).toBe('Slow work, close to the bone.');
    expect(meta('twitter:description')).toBe('Slow work, close to the bone.');
    expect(metaCount('og:description')).toBe(1);
  });

  // ── the price meta comes from the OFFER, never from the course row ─────────
  it('prices product:price from the offer one-off path', () => {
    render({
      // The course row deliberately says something ELSE. If the head ever reads
      // it again this case fails loudly rather than silently agreeing.
      course: { priceCents: 4900 },
      offer: offer({ paths: ['purchase'], purchase: { priceCents: 2499 } }),
    });

    expect(meta('product:price:amount')).toBe('24.99');
    // GBP, never USD.
    expect(meta('product:price:currency')).toBe('GBP');
  });

  it('omits product:price for a SUBSCRIPTION-only course (no flat amount exists)', () => {
    // Open Graph's product price has nowhere to state a cadence, so a monthly
    // figure here would advertise £27 as the cost of the course. The JSON-LD
    // carries it instead, with its cadence attached — asserted below.
    render({
      offer: offer({
        paths: ['subscription'],
        subscription: {
          planId: '00000000-0000-4000-8000-0000000000f0',
          priceMonthly: 2700,
          priceAnnual: 27000,
        },
      }),
    });

    expect(meta('product:price:amount')).toBeNull();
    expect(meta('product:price:currency')).toBeNull();
  });

  it('omits the price meta when the course has no way in at all', () => {
    // 5 of the 7 seeded dev courses are in exactly this state.
    render({ course: { priceCents: null }, offer: offer() });

    expect(meta('product:price:amount')).toBeNull();
    expect(meta('product:price:currency')).toBeNull();
  });

  it('omits the price meta when the priced course row has a FAILED offer read', () => {
    // `offer: null` is a `.catch()`-ed pricing hiccup, not an empty offer. The
    // page must not fall back to the course row to fill the gap — a price the
    // checkout may no longer honour is worse than no price.
    render({ course: { priceCents: 4900 }, offer: null });

    expect(meta('product:price:amount')).toBeNull();
  });

  // ── the authored seo bag (Codex-2j8nq) ────────────────────────────────────
  it('prefers the page seo over the derived title + description', () => {
    render({
      page: {
        seo: {
          title: 'Bone Deep · a 6-week descent',
          description: 'Slow work.',
        },
      },
      course: {
        title: 'Bone Deep',
        lede: 'The lede that would otherwise show.',
      },
    });

    expect(document.title).toBe('Bone Deep · a 6-week descent');
    expect(meta('og:title')).toBe('Bone Deep · a 6-week descent');
    expect(meta('twitter:title')).toBe('Bone Deep · a 6-week descent');
  });

  it('falls back to the course title when seo.title is CLEARED to ""', () => {
    // The case a naive `??` gets wrong: the key is present, so `??` keeps `''`
    // and the page ships an empty <title>. A creator must be able to undo their
    // own override. (The same rule for the DESCRIPTION is asserted in the load
    // test — that derivation moved there so the root layout can render it once.)
    render({
      page: { seo: { title: '', description: '' } },
      course: { title: 'Bone Deep', lede: 'The lede that must come back.' },
    });

    expect(document.title).toBe('Bone Deep');
  });

  it('marks a draft title and keeps the authored meta title inside it', () => {
    render({
      draftPreview: true,
      page: { status: 'draft', publishedAt: null, seo: { title: 'Authored' } },
    });

    expect(document.title).toBe('Draft · Authored');
  });

  // ── the JSON-LD, priced from the offer (the item this group exists for) ─────
  describe('Course JSON-LD', () => {
    it('emits ONE Offer per real path, each priced from the offer', () => {
      render({
        course: { title: 'Bone Deep', priceCents: 4900 },
        offer: offer({
          paths: ['purchase'],
          purchase: { priceCents: 2499 },
        }),
      });

      const ld = jsonLd();
      expect(ld?.['@type']).toBe('Course');
      expect(ld?.offers).toEqual([
        {
          '@type': 'Offer',
          // The derived default name, not authored copy — no `invite` section
          // in this fixture to decorate it.
          name: 'Own Bone Deep',
          // 24.99, NOT the course row's 49.00. The whole point.
          price: '24.99',
          priceCurrency: 'GBP',
          availability: 'https://schema.org/InStock',
          url: `${ORIGIN}/journeys/bone-deep/checkout?offer=purchase`,
        },
      ]);
    });

    it('PRICES A SUBSCRIPTION-ONLY COURSE — the case that published nothing', () => {
      // The defect this item names: `courses.price_cents` is NULL for a course
      // sold only by subscription, so the old JSON-LD had no `offers` node at
      // all while the invite section showed the reader "£27 per month". Now both
      // read the same source, and the cadence travels WITH the price so £27 is
      // never published as the cost of the course.
      render({
        course: { title: 'Bone Deep', priceCents: null },
        offer: offer({
          paths: ['subscription'],
          subscription: {
            planId: '00000000-0000-4000-8000-0000000000f0',
            priceMonthly: 2700,
            priceAnnual: 27000,
          },
        }),
      });

      const offers = jsonLd()?.offers as Array<Record<string, unknown>>;
      expect(offers).toHaveLength(2);
      expect(offers.map((o) => o.price)).toEqual(['27.00', '270.00']);
      expect(offers[0].priceSpecification).toEqual({
        '@type': 'UnitPriceSpecification',
        price: '27.00',
        priceCurrency: 'GBP',
        referenceQuantity: {
          '@type': 'QuantitativeValue',
          value: 1,
          unitCode: 'MON',
        },
      });
      // The annual interval maps to its own unit code, not to the monthly one.
      expect(
        (offers[1].priceSpecification as Record<string, unknown>)
          ?.referenceQuantity
      ).toMatchObject({ unitCode: 'ANN' });
    });

    it('omits `offers` entirely when the course has no way in', () => {
      // A withdrawn course must not advertise a purchase a crawler could
      // surface. `priceCents` is deliberately still set on the row.
      render({ course: { priceCents: 4900 }, offer: offer() });

      const ld = jsonLd();
      expect(ld).not.toHaveProperty('offers');
    });

    it('omits `offers` when the offer read FAILED (never falls back to the row)', () => {
      render({ course: { priceCents: 4900 }, offer: null });

      expect(jsonLd()).not.toHaveProperty('offers');
    });

    it('never emits the string "NaN" as a price', () => {
      // `course.priceCents !== null` was the old test, and in a
      // `strictNullChecks: false` workspace it passes for an ABSENT field too —
      // `(undefined / 100).toFixed(2)` is the literal "NaN". Nothing in the
      // payload may contain it, whatever the row says.
      render({
        // Model an older worker deployment that omits the field entirely.
        course: { priceCents: undefined as unknown as number },
        offer: offer({ paths: ['purchase'], purchase: { priceCents: 1500 } }),
      });

      expect(JSON.stringify(jsonLd())).not.toContain('NaN');
      expect(meta('product:price:amount')).toBe('15.00');
    });

    it('carries the canonical url, the cover image and the org as provider', () => {
      render({
        course: { coverImageUrl: 'http://cdn.test/courses/c1/cover/md.webp' },
        org: { name: 'Of Blood & Bones' },
      });

      const ld = jsonLd();
      expect(ld?.url).toBe(CANONICAL);
      expect(ld?.image).toBe('http://cdn.test/courses/c1/cover/md.webp');
      expect(ld?.provider).toEqual({
        '@type': 'Organization',
        name: 'Of Blood & Bones',
        url: ORIGIN,
      });
    });

    it('omits provider and image rather than emitting empty ones', () => {
      // A `provider` with no name, or an `image` pointing nowhere, is worse than
      // the absence — a crawler caches the broken node.
      render({ org: null, course: { coverImageUrl: null } });

      const ld = jsonLd();
      expect(ld).not.toHaveProperty('provider');
      expect(ld).not.toHaveProperty('image');
    });

    it('describes the course with the same string the head does', () => {
      render({ pageMeta: { description: 'One description, one page.' } });

      // The JSON-LD description and og:description disagreeing would be the same
      // class of defect as the price disagreeing.
      expect(jsonLd()?.description).toBe('One description, one page.');
      expect(meta('og:description')).toBe('One description, one page.');
    });
  });
});
