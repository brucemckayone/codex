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
 *      creator who clears the meta description must get the lede back, so the
 *      derivation uses `||`; a `??` would emit `<meta content="">` and pass any
 *      test that only checked the absent case. Both cases are asserted.
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
import type { JourneyCoursePage } from '$lib/page-builder';

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

let component: ReturnType<typeof mount> | null = null;
let baselineHead: Element[] = [];

function render(opts: {
  url?: string;
  draftPreview?: boolean;
  page?: Partial<JourneyCoursePage['page']>;
  course?: Partial<JourneyCoursePage['course']>;
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
      offer: null,
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

function linkHref(rel: string): string | null {
  return (
    document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ??
    null
  );
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

  it('declares the product vertical, with the price when sold standalone', () => {
    render({ course: { priceCents: 4900 } });

    expect(meta('og:type')).toBe('product');
    expect(meta('product:price:amount')).toBe('49.00');
    // GBP, never USD.
    expect(meta('product:price:currency')).toBe('GBP');
  });

  it('omits the price meta when the journey is membership-only', () => {
    render({ course: { priceCents: null } });

    expect(meta('product:price:amount')).toBeNull();
    expect(meta('product:price:currency')).toBeNull();
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
    expect(meta('description')).toBe('Slow work.');
    expect(meta('og:description')).toBe('Slow work.');
  });

  it('falls back to the lede when a seo field is CLEARED to an empty string', () => {
    // The case a naive `??` gets wrong: the key is present, so `??` keeps `''`
    // and the page ships an empty description. A creator must be able to undo
    // their own override.
    render({
      page: { seo: { title: '', description: '' } },
      course: { title: 'Bone Deep', lede: 'The lede that must come back.' },
    });

    expect(document.title).toBe('Bone Deep');
    expect(meta('description')).toBe('The lede that must come back.');
    expect(meta('og:description')).toBe('The lede that must come back.');
  });

  it('marks a draft title and keeps the authored meta title inside it', () => {
    render({
      draftPreview: true,
      page: { status: 'draft', publishedAt: null, seo: { title: 'Authored' } },
    });

    expect(document.title).toBe('Draft · Authored');
  });
});
