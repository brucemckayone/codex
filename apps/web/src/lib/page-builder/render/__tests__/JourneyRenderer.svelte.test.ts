/**
 * JourneyRenderer — the money path (WP-1).
 *
 * Three defects live in this component, and all three are about the ONE element
 * a visitor must use to give the creator money:
 *
 *  1. THE DEAD-END CHECKOUT. The load already awaits the authoritative offer, and
 *     nothing but `invite` ever asked it. Three "Begin" affordances (hero CTA,
 *     floating pill, invite CTA) pointed at `/journeys/<slug>/checkout` regardless,
 *     and checkout answers "<Course> isn't open for enrolment just now." Measured
 *     live before the fix on http://studio-beta.lvh.me:3010/journeys/bone-deep:
 *     three anchors, all `/journeys/bone-deep/checkout`, labelled
 *     'Begin' / 'Begin' / 'Begin →' — and that page's course has
 *     `price_cents IS NULL` with zero `course_subscription_plans` and zero
 *     `course_tier_access` rows. FIVE of the seven seeded pages are in that state.
 *
 *  2. TWO KEY-SPACES, ONE TARGET. `checkoutUrl` and `dashboardUrl` were both built
 *     from `courses.slug`, but the checkout route resolves `landing_pages.slug`
 *     and the dashboard resolves `courses.slug`. The two are independently
 *     authored; when they drift, every primary CTA 404s.
 *
 *  3. THE HARDCODED PILL LABEL. `'Continue →'` / `'Begin →'` — untranslated
 *     English, ignoring the `invite.ctaLabel` / `hero.ctaLabel` the creator typed.
 *
 * WHY A DEDICATED FILE. These are properties of the ASSEMBLER, not of any
 * section: the URLs, the `purchasable` derivation and the pill's label are all
 * decided here and nowhere else, so a section-level test cannot see them.
 *
 * WHAT jsdom CAN AND CANNOT SAY. It can say which hrefs and labels reach the DOM,
 * and whether the pill element exists at all — which is all three defects. It
 * cannot say anything about the pill's OVERLAP with the invite section (fixed
 * position, z-index, an isolated stacking context); the intersection behaviour is
 * asserted here at the observer level and its geometry belongs in a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyRenderer from '../JourneyRenderer.svelte';

// `page.url` is the only thing this component takes from `$app/state`, and it
// takes it for `buildJourneyUrl` (which uses the hostname to decide root-relative
// vs cross-org absolute). An org host keeps every built URL root-relative, so the
// assertions below read as paths.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://studio-beta.lvh.me:3010/journeys/sell-page') },
}));

/**
 * The PAGE slug and the COURSE slug deliberately DIFFER — that divergence is the
 * whole point of the key-space assertions. On all seven seeded pages they happen
 * to agree, which is exactly why the bug was latent and why a fixture that
 * mirrors production would prove nothing.
 */
function coursePage(
  overrides: Partial<JourneyCoursePage['page']> = {}
): JourneyCoursePage {
  return {
    page: {
      id: 'page-1',
      organizationId: 'org-1',
      publishedAt: '2026-08-01T00:00:00.000Z',
      pageType: 'course',
      slug: 'sell-page',
      title: 'Bone Deep',
      status: 'published',
      subjectType: 'course',
      subjectId: 'course-1',
      brandOverrides: null,
      sections: [
        { id: 's-hero', type: 'hero', enabled: true, props: {} },
        { id: 's-invite', type: 'invite', enabled: true, props: {} },
      ],
      ...overrides,
    },
    course: {
      id: 'course-1',
      slug: 'the-course',
      title: 'Bone Deep',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: null,
      stageCount: 2,
      practiceCount: 6,
    },
    stages: [],
    testimonials: [],
  };
}

/** An offer with ONE real path — a one-off purchase. */
function purchasableOffer(): CourseOffer {
  return {
    courseId: 'course-1',
    organizationId: 'org-1',
    paths: ['purchase'],
    purchase: { priceCents: 4900 },
    subscription: null,
    tiers: [],
    entitled: false,
  };
}

/**
 * A RESOLVED offer with NO paths — the live state of five of the seven seeded
 * pages. Distinct from `offer: null`, which means the read FAILED.
 */
function emptyOffer(): CourseOffer {
  return {
    courseId: 'course-1',
    organizationId: 'org-1',
    paths: [],
    purchase: null,
    subscription: null,
    tiers: [],
    entitled: false,
  };
}

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  coursePage?: JourneyCoursePage;
  offer?: CourseOffer | null;
  enrolled?: boolean;
}) {
  component = mount(JourneyRenderer, {
    target: document.body,
    props: {
      coursePage: props.coursePage ?? coursePage(),
      sellPreview: Promise.resolve(null),
      enrolled: props.enrolled ?? false,
      offer: props.offer ?? null,
    },
  });
  flushSync();
  return document.body;
}

/** The hero's own primary CTA — the page's first and largest affordance. */
function heroCta(): Element | null {
  return document.body.querySelector(
    '[data-section-type="hero"] .cta[data-variant="primary"]'
  );
}

/** The floating pill's link. */
function pillCta(): Element | null {
  return document.body.querySelector('.floatcta .cta');
}

afterEach(() => {
  if (component) {
    unmount(component);
    component = undefined;
  }
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// A DRIVEABLE IntersectionObserver
//
// The repo's global stub (`src/tests/setup.ts`) observes nothing and never
// fires, so with it in place the pill's yield is unobservable AND only the
// "no observer" fallback ever runs. This records every instance so a test can
// pick out the ONE that observes the invite section and drive it.
// ─────────────────────────────────────────────────────────────────────────────

interface ObserverProbe {
  targets: Element[];
  fire: (isIntersecting: boolean) => void;
}

const probes: ObserverProbe[] = [];

class RecordingObserver {
  private readonly targets: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    probes.push({
      targets: this.targets,
      fire: (isIntersecting: boolean) =>
        callback(
          this.targets.map(
            (target) =>
              ({ target, isIntersecting }) as IntersectionObserverEntry
          ),
          this as unknown as IntersectionObserver
        ),
    });
  }

  observe(target: Element): void {
    this.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

/** The observer watching the invite SECTION element (not one of its children). */
function inviteProbe(): ObserverProbe | undefined {
  return probes.find((probe) =>
    probe.targets.some(
      (target) => target.getAttribute('data-section-type') === 'invite'
    )
  );
}

describe('JourneyRenderer — never offer a purchase it cannot fulfil', () => {
  it('renders the pill and the hero CTA when the offer has a real path', () => {
    render({ offer: purchasableOffer() });

    expect(document.body.querySelector('.floatcta')).not.toBeNull();
    expect(heroCta()?.getAttribute('href')).toBe(
      '/journeys/sell-page/checkout'
    );
  });

  it('withholds EVERY renderer-owned purchase affordance when a RESOLVED offer has no path', () => {
    render({ offer: emptyOffer() });

    // The pill is the renderer's own affordance — gone outright.
    expect(document.body.querySelector('.floatcta')).toBeNull();
    // And the hero's primary CTA, which is the page's first and largest element.
    expect(heroCta()).toBeNull();
    // The hero still renders — this suppresses a button, not a section.
    expect(
      document.body.querySelector('[data-section-type="hero"]')
    ).not.toBeNull();
  });

  it('leaves an empty actions row out of the DOM rather than an empty flex box', () => {
    // `.hero__actions` sits in a gapped column and carries a staggered entrance
    // animation, so an empty one is a visible hole where the CTA was.
    render({ offer: emptyOffer() });
    expect(document.body.querySelector('.hero__actions')).toBeNull();
  });

  it('KEEPS the affordances when the offer read FAILED (null), not just when it succeeded', () => {
    // The load `.catch(() => null)`s the offer so a pricing hiccup cannot 500 an
    // SEO-critical page. Treating that null as "unpurchasable" would strip the buy
    // button off a page that sells perfectly well — the same defect, inverted.
    render({ offer: null });

    expect(document.body.querySelector('.floatcta')).not.toBeNull();
    expect(heroCta()).not.toBeNull();
  });

  it('keeps an ENROLLED member’s affordances even with no purchasable path', () => {
    // Their target is the dashboard, which does not depend on the offer at all.
    render({ offer: emptyOffer(), enrolled: true });

    expect(pillCta()?.getAttribute('href')).toBe(
      '/journeys/the-course/dashboard'
    );
    expect(heroCta()?.getAttribute('href')).toBe(
      '/journeys/the-course/dashboard'
    );
  });
});

describe('JourneyRenderer — two surfaces, two key-spaces', () => {
  // `/journeys/<slug>/checkout` resolves `landing_pages.slug`;
  // `/journeys/<slug>/dashboard` resolves `courses.slug`. One target for both
  // 404s the primary CTA the moment the two drift.
  it('builds checkout from the PAGE slug', () => {
    render({ offer: purchasableOffer() });

    expect(heroCta()?.getAttribute('href')).toBe(
      '/journeys/sell-page/checkout'
    );
    expect(pillCta()?.getAttribute('href')).toBe(
      '/journeys/sell-page/checkout'
    );
    // The invite's per-path deep links inherit `context.checkoutUrl`, so they
    // move with it — that is the whole reason the split lands here rather than
    // in each section.
    expect(document.body.innerHTML).not.toContain(
      '/journeys/the-course/checkout'
    );
  });

  it('builds the dashboard from the COURSE slug', () => {
    render({ offer: purchasableOffer(), enrolled: true });

    expect(heroCta()?.getAttribute('href')).toBe(
      '/journeys/the-course/dashboard'
    );
    expect(pillCta()?.getAttribute('href')).toBe(
      '/journeys/the-course/dashboard'
    );
    expect(document.body.innerHTML).not.toContain(
      '/journeys/sell-page/dashboard'
    );
  });
});

describe('JourneyRenderer — the floating pill speaks the creator’s words', () => {
  it('reads the invite’s authored label, through the builder’s stored `button` key', () => {
    // The builder writes `button`; only `aliasKeys` makes that readable. Skipping
    // the alias is exactly how the hero used to publish hardcoded English over a
    // stored label (Codex-tqr51).
    const page = coursePage({
      sections: [
        { id: 's-hero', type: 'hero', enabled: true, props: {} },
        {
          id: 's-invite',
          type: 'invite',
          enabled: true,
          props: { button: 'Walk with me' },
        },
      ],
    });
    render({ coursePage: page, offer: purchasableOffer() });

    const pill = document.body.querySelector('.floatcta');
    expect(pill?.textContent).toContain('Walk with me');
    expect(pill?.textContent).not.toContain('Begin →');
  });

  it('falls back to the HERO’s label when the invite authors none', () => {
    const page = coursePage({
      sections: [
        {
          id: 's-hero',
          type: 'hero',
          enabled: true,
          props: { button: 'Start the descent' },
        },
        { id: 's-invite', type: 'invite', enabled: true, props: {} },
      ],
    });
    render({ coursePage: page, offer: purchasableOffer() });

    expect(document.body.querySelector('.floatcta')?.textContent).toContain(
      'Start the descent'
    );
  });

  it('prefers the INVITE’s label over the hero’s when both are authored', () => {
    // The pill is the page's standing conversion affordance, so the page's actual
    // OFFER names it, not the hero's opening line.
    const page = coursePage({
      sections: [
        {
          id: 's-hero',
          type: 'hero',
          enabled: true,
          props: { button: 'Start the descent' },
        },
        {
          id: 's-invite',
          type: 'invite',
          enabled: true,
          props: { button: 'Walk with me' },
        },
      ],
    });
    render({ coursePage: page, offer: purchasableOffer() });

    const text = document.body.querySelector('.floatcta')?.textContent ?? '';
    expect(text).toContain('Walk with me');
    expect(text).not.toContain('Start the descent');
  });

  it('uses an i18n key, never a hardcoded arrow string, when nothing is authored', () => {
    render({ offer: purchasableOffer() });
    const text = document.body.querySelector('.floatcta')?.textContent ?? '';
    expect(text).not.toContain('Begin →');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('relabels for an enrolled member without consulting the sales copy', () => {
    const page = coursePage({
      sections: [
        {
          id: 's-invite',
          type: 'invite',
          enabled: true,
          props: { button: 'Walk with me' },
        },
      ],
    });
    render({ coursePage: page, offer: purchasableOffer(), enrolled: true });

    const text = document.body.querySelector('.floatcta')?.textContent ?? '';
    expect(text).not.toContain('Walk with me');
    expect(text).not.toContain('Continue →');
  });
});

/**
 * The pill's deference to the invite section, at the level jsdom can speak to:
 * WHICH element it observes, and what it does when that element reports itself
 * visible. The geometry (fixed position over a sticky bar inside an isolated
 * stacking context) is a browser measurement, not a jsdom one.
 *
 * The repo's global `IntersectionObserver` stub observes nothing and never fires,
 * so without a real one here the fix would be untestable AND the "no observer"
 * fallback would be the only path ever exercised.
 */
describe('JourneyRenderer — the pill yields to the invite section', () => {
  const realObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    probes.length = 0;
    // The pill reads `scrollY` SYNCHRONOUSLY in `onMount` (the listener's own
    // first `update()`), so parking the reader past the fold before mounting
    // makes the whole test synchronous — no rAF, no timers.
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 10_000,
    });
    globalThis.IntersectionObserver =
      RecordingObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = realObserver;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('observes the INVITE SECTION ITSELF, not one of its children', () => {
    render({ offer: purchasableOffer() });

    // Several observers exist on this page — every section arms its own through
    // `reveal.ts` — so the assertion has to name the one whose target IS the
    // section element. `reveal` observes `.invite__inner`, a descendant, which is
    // why this stays unambiguous.
    const probe = inviteProbe();
    expect(probe).toBeDefined();
    // apps/web has `strictNullChecks` OFF, so the assertion above is the only
    // narrowing this needs (and a `?.` here would make the test vacuous).
    expect(probe.targets).toHaveLength(1);
  });

  it('hides the pill while the invite is on screen and restores it after', () => {
    render({ offer: purchasableOffer() });
    const pill = document.body.querySelector('.floatcta') as HTMLElement;

    expect(pill.classList.contains('is-shown')).toBe(true);
    // `inert` is what stops the pill taking the focus the offer beneath it should
    // get. Svelte sets it as a DOM PROPERTY, so `hasAttribute` reads false even
    // when it is on — assert the property.
    expect(pill.inert).toBe(false);

    const probe = inviteProbe();
    expect(probe).toBeDefined();

    probe.fire(true);
    flushSync();
    expect(pill.classList.contains('is-shown')).toBe(false);
    expect(pill.inert).toBe(true);

    probe.fire(false);
    flushSync();
    expect(pill.classList.contains('is-shown')).toBe(true);
    expect(pill.inert).toBe(false);
  });

  it('still shows past the fold on a page with NO invite section', () => {
    const page = coursePage({
      sections: [{ id: 's-hero', type: 'hero', enabled: true, props: {} }],
    });
    render({ coursePage: page, offer: purchasableOffer() });

    // Nothing to observe ⇒ the fold test alone decides, which is the behaviour
    // before this change rather than a permanently hidden pill.
    expect(inviteProbe()).toBeUndefined();
    expect(
      document.body.querySelector('.floatcta')?.classList.contains('is-shown')
    ).toBe(true);
  });
});

/**
 * THE EMPTY PUBLISHED PAGE — the renderer's half of `validatePageShape`.
 *
 * `createJourney` INSERTS `sections: []`, so a creator reaches this state by
 * pressing publish before adding anything. The served document then carries a
 * valid `<title>` and a `Course` JSON-LD asserting the course exists, over a body
 * whose only content is this component's own floating pill — an indexable blank
 * page with a buy button fixed to the bottom of it.
 *
 * The pill's whole justification, stated in `FloatingCta`'s own header, is being
 * "a stand-in for a CTA the reader cannot currently see". On a page with no
 * sections there is no CTA anywhere to stand in for, and nothing the reader has
 * scrolled past — so it stops being a stand-in and becomes the page's only
 * content: a fixed pill following the reader down a blank document to a checkout
 * the page never described.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. `multiple-hero` is also an `error` shape,
 * and the renderer does NOT drop the duplicate hero — `SectionFrame` demotes its
 * heading to `<h2>` instead, because an author who duplicated a section must
 * still be able to see and delete it on the public page and in the canvas alike.
 * Refusing a misshapen page is the builder's publish gate's job, not the public
 * renderer's; the renderer's job is to serve an already-published one honestly.
 */
describe('JourneyRenderer — an empty page serves no chrome', () => {
  it('withholds the floating pill when the page has no sections at all', () => {
    render({
      coursePage: coursePage({ sections: [] }),
      offer: purchasableOffer(),
    });

    expect(document.body.querySelectorAll('.jp-sec')).toHaveLength(0);
    expect(document.body.querySelector('.floatcta')).toBeNull();
  });

  it('withholds it when every section is DISABLED or an unknown type', () => {
    // The same published document as `[]`, reached without deleting anything —
    // so a creator cannot route around the rule by toggling sections off.
    render({
      coursePage: coursePage({
        sections: [
          { id: 's-hero', type: 'hero', enabled: false, props: {} },
          {
            id: 's-future',
            type: 'retreat-only-future',
            enabled: true,
            props: {},
          },
        ],
      }),
      offer: purchasableOffer(),
    });

    expect(document.body.querySelectorAll('.jp-sec')).toHaveLength(0);
    expect(document.body.querySelector('.floatcta')).toBeNull();
  });

  it('withholds it from an ENROLLED member too', () => {
    // An enrolled member's pill points at a dashboard that really exists, which
    // is why they normally keep it even with nothing to buy. On a blank page it
    // is still the only thing in the body, and a member has a dashboard link in
    // the org chrome regardless.
    render({
      coursePage: coursePage({ sections: [] }),
      offer: purchasableOffer(),
      enrolled: true,
    });

    expect(document.body.querySelector('.floatcta')).toBeNull();
  });

  it('KEEPS the pill as soon as ONE section renders', () => {
    // The control, and the assertion that stops this becoming a pill that never
    // appears: a single enabled, known section is a shaped page.
    render({
      coursePage: coursePage({
        sections: [
          { id: 's-hero', type: 'hero', enabled: false, props: {} },
          {
            id: 's-ache',
            type: 'ache',
            enabled: true,
            props: { beats: ['x'] },
          },
        ],
      }),
      offer: purchasableOffer(),
    });

    expect(document.body.querySelectorAll('.jp-sec')).toHaveLength(1);
    expect(document.body.querySelector('.floatcta')).not.toBeNull();
  });
});
