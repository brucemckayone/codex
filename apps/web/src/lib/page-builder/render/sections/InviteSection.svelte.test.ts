/**
 * `InviteSection` — what an ENROLLED viewer is shown.
 *
 * THE STATE THIS PINS. The invite composed every available offer path into cards
 * and then, for a viewer who already held the course, re-pointed each card's CTA
 * at the same dashboard. A member who had bought The Long Descent was shown four
 * cards quoting £24.99 one-off, £27/month, £270/year and a £15/month tier — all
 * of which they already had — behind four links with one destination.
 *
 * The component said as much in its own comment ("An enrolled viewer has nothing
 * to buy") while rendering the buying UI regardless, which is the shape of bug a
 * source read finds and a test does not, unless the test mounts the real
 * component with a REAL multi-path offer. That is what the fixture below is for:
 * asserting the collapse against `offer: null` would pass on the price-less
 * branch and prove nothing.
 *
 * It also compounded a WCAG 2.4.4 problem the file works around for the
 * non-enrolled case: the composition CTAs are disambiguated by an accessible
 * name built from each path, but for an enrolled viewer the four links were not
 * merely similarly named — they were the same link, four times.
 */

import type { CourseOffer } from '@codex/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import InviteSection from './InviteSection.svelte';

const CANDLELIT: ResolvedSectionDesign = {
  width: 'text',
  density: 'airy',
  surface: 'media',
  edge: 'none',
  align: 'center',
  type: 'monumental',
  accent: 'glow',
  motion: 'drift',
  media: 'bleed',
};

/**
 * The four-path offer from the reported page: a one-off purchase, a course
 * subscription billed either monthly or annually, and one org tier that includes
 * the course. `deriveOfferPaths` turns this into the four cards.
 */
function fourPathOffer(): CourseOffer {
  return {
    courseId: 'c1',
    organizationId: 'o1',
    paths: ['purchase', 'subscription', 'tier'],
    purchase: { priceCents: 2499 },
    subscription: { planId: 'plan_1', priceMonthly: 2700, priceAnnual: 27000 },
    tiers: [
      {
        tierId: 'tier_1',
        tierName: 'Soul Path',
        priceMonthly: 1500,
        priceAnnual: 15000,
      },
    ],
    entitled: false,
  };
}

function context(
  overrides: Partial<JourneySalesContext> = {}
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'the-long-descent',
      title: 'The Long Descent',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: 2499,
      stageCount: 3,
      practiceCount: 9,
    },
    stages: [],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/the-long-descent/checkout',
    dashboardUrl: 'http://lvh.me:3000/journeys/the-long-descent/dashboard',
    enrolled: false,
    offer: fourPathOffer(),
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview | null>(null),
    ...overrides,
  };
}

const COPY: SectionProps = {
  heading: 'The ground',
  accent: 'is waiting.',
  sub: 'One key opens everything that grows from here.',
  risk: 'Start free · cancel anytime',
};

let component: ReturnType<typeof mount> | undefined;

function render(enrolled: boolean): void {
  component = mount(InviteSection, {
    target: document.body,
    props: {
      config: COPY,
      context: context({ enrolled }),
      variant: 'tiers',
      design: CANDLELIT,
    },
  });
  flushSync();
}

/**
 * Render with an arbitrary context, so a case can vary `purchasable` and `offer`
 * independently of enrolment. `render(enrolled)` above stays as-is because five
 * existing cases read it.
 */
function renderWith(overrides: Partial<JourneySalesContext>): void {
  component = mount(InviteSection, {
    target: document.body,
    props: {
      config: COPY,
      context: context(overrides),
      variant: 'tiers',
      design: CANDLELIT,
    },
  });
  flushSync();
}

function ctaHrefs(): string[] {
  return [...document.body.querySelectorAll('a[href]')].map(
    (a) => a.getAttribute('href') ?? ''
  );
}

/** Unmount + clear, so a test can render BOTH enrolment states in one case. */
function teardown(): void {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(teardown);

describe('InviteSection — the enrolled viewer', () => {
  it('shows the FOUR priced paths to a viewer who is not enrolled', () => {
    // The control case, and the one that makes the next test non-vacuous: this
    // fixture really does produce a multi-path composition, so a collapse in the
    // enrolled case is caused by enrolment and not by an empty offer.
    render(false);

    const hrefs = ctaHrefs();
    expect(hrefs.length).toBeGreaterThan(1);
    // Every CTA goes to checkout, each with its own path pre-selected.
    expect(hrefs.every((h) => h.includes('/checkout'))).toBe(true);
    expect(new Set(hrefs).size).toBeGreaterThan(1);
  });

  it('collapses to ONE dashboard CTA once enrolled', () => {
    render(true);

    const hrefs = ctaHrefs();
    expect(hrefs).toEqual([
      'http://lvh.me:3000/journeys/the-long-descent/dashboard',
    ]);
  });

  it('quotes no price to a viewer who already owns it', () => {
    // The cards carried £24.99 / £27 / £270 / £15. None of those amounts is true
    // information for a member holding the course, and the tier price is
    // actively misleading — it advertises a subscription they may not be on.
    render(true);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('24.99');
    expect(text).not.toContain('270');
    expect(text).not.toContain('15');
  });

  it('drops the purchase risk note, which says nothing true to a member', () => {
    // "Start free · cancel anytime" is copy about beginning. It renders for
    // everyone else and must not render here.
    render(true);
    expect(document.body.textContent ?? '').not.toContain('cancel anytime');

    teardown();

    render(false);
    expect(document.body.textContent ?? '').toContain('cancel anytime');
  });

  it('still renders the authored heading — the collapse is of the OFFER, not the section', () => {
    // A member arriving at the page should still meet its close. Only the
    // purchase machinery goes.
    render(true);
    const text = document.body.textContent ?? '';
    expect(text).toContain('The ground');
    expect(text).toContain('is waiting.');
  });
});

describe('InviteSection — a course with nothing to sell', () => {
  it('offers NO transactional affordance when the offer RESOLVED with no path', () => {
    // The third of three dead-end "Begin" affordances. The hero CTA and the
    // floating pill were withheld in an earlier change; this branch still sent a
    // visitor to a checkout that answers "isn't open for enrolment just now"
    // after re-pitching the course — a closed loop back to where they started.
    // Five of the seven seeded courses are in exactly this state.
    renderWith({ enrolled: false, purchasable: false, offer: null });
    expect(ctaHrefs().filter((h) => h.includes('/checkout'))).toEqual([]);
  });

  it('KEEPS the affordance when the offer read merely FAILED — purchasable is a CONFIDENT negative', () => {
    // `offer: null` alone means the `.catch(() => null)`-guarded read failed, and
    // a failed read produces an empty `paths` array just as a genuinely unsellable
    // course does. Testing `!context.purchasable` instead of `=== false` would
    // strip the buy button off a perfectly purchasable page on any transient
    // pricing hiccup — the opposite defect, on the same element. This case is the
    // guard against that, and it is why the two cases must both exist.
    renderWith({ enrolled: false, purchasable: true, offer: null });
    expect(
      ctaHrefs().filter((h) => h.includes('/checkout')).length
    ).toBeGreaterThan(0);
  });

  it('KEEPS an enrolled member their dashboard doorway even with no purchasable path', () => {
    // An enrolled viewer has nothing to buy but everything to return to, so the
    // suppression must not reach them. Their CTA is not transactional.
    renderWith({ enrolled: true, purchasable: false, offer: null });
    const hrefs = ctaHrefs();
    expect(
      hrefs.filter((h) => h.includes('/dashboard')).length
    ).toBeGreaterThan(0);
    expect(hrefs.filter((h) => h.includes('/checkout'))).toEqual([]);
  });

  it('still renders the authored copy — the section has something to SAY, not to sell', () => {
    renderWith({ enrolled: false, purchasable: false, offer: null });
    const text = document.body.textContent ?? '';
    expect(text).toContain('The ground');
    expect(text).toContain('is waiting.');
  });
});

/**
 * THE COURSE-TITLE FALLBACK, AND WHY THIS SECTION WAS THE ONE LEFT OUT.
 *
 * Five sections can fall back to the course title for their heading, and the page
 * hands that permission to exactly ONE of them (`claimTitleFallback`). Four were
 * converted to read a `titleFallback` prop; this one still read
 * `context.course.title` UNCONDITIONALLY, so `claimTitleFallback` could give the
 * claim to (say) `map` while a blank invite printed the title as well — the exact
 * duplication the mechanism exists to prevent, on the conversion section.
 *
 * LATENT ON TODAY'S DATA, and worth stating plainly: all seven seeded pages store
 * an invite `heading`, and the catalogue's `defaultProps` seed one for every new
 * section, so the duplicate only appears once a creator CLEARS a heading (or on a
 * page whose sections were written by the seed script or a direct API call). The
 * array-level proof lives in `render/SectionRenderer.svelte.test.ts`.
 */
describe('InviteSection — the course title is borrowed, not assumed', () => {
  /**
   * Mount with arbitrary copy and an arbitrary page-level claim.
   *
   * `courseTitle` and `titleFallback` are deliberately DIFFERENT strings in the
   * cases below. In production they are the same value, but a fixture where they
   * agree cannot tell "reads the prop" from "reads the context" — which is
   * precisely the bug being fixed, so the test has to be able to see the
   * difference.
   */
  function renderCopy(props: {
    config?: SectionProps;
    titleFallback?: string;
    courseTitle?: string;
    editable?: boolean;
  }): void {
    const base = context();
    component = mount(InviteSection, {
      target: document.body,
      props: {
        config: props.config ?? {},
        context: {
          ...base,
          course: {
            ...base.course,
            title: props.courseTitle ?? base.course.title,
          },
        },
        variant: 'pool',
        design: CANDLELIT,
        editable: props.editable ?? false,
        titleFallback: props.titleFallback,
      },
    });
    flushSync();
  }

  const headingEl = () => document.body.querySelector('h2.invite__heading');

  /** Every heading this section renders, whitespace-normalised. */
  const sectionHeadings = (): string[] =>
    [...document.body.querySelectorAll('h2, h3')].map((h) =>
      (h.textContent ?? '').replace(/\s+/g, ' ').trim()
    );

  it('prints the authored heading, claim or no claim', () => {
    // The control case: an authored heading never consults the fallback, so this
    // must pass identically before and after the conversion.
    renderCopy({ config: { heading: 'The ground' }, courseTitle: 'Bone Deep' });
    expect(headingEl()?.textContent?.trim()).toBe('The ground');
  });

  it('falls back to the course title WHEN THE PAGE HAS CLAIMED IT HERE', () => {
    renderCopy({
      config: {},
      courseTitle: 'The course in the context',
      titleFallback: 'The title the page granted',
    });
    expect(headingEl()?.textContent?.trim()).toBe('The title the page granted');
  });

  it('does NOT print the course title as a heading when the page claimed it elsewhere', () => {
    // The defect. Before the conversion this rendered `<h2>Bone Deep</h2>`
    // regardless of which section the page had actually given the claim to.
    //
    // SCOPED TO HEADINGS ON PURPOSE. The course title legitimately appears
    // elsewhere in this section — each offer CTA's accessible name is built from
    // it ("Own Bone Deep") to keep four similarly-named links distinguishable
    // (WCAG 2.4.4) — so a body-wide `not.toContain` would be asserting the
    // opposite of another fix in this same file. The discipline is at the heading
    // read and nowhere else.
    renderCopy({ config: {}, courseTitle: 'Bone Deep' });
    expect(sectionHeadings()).not.toContain('Bone Deep');
  });

  it('renders no heading element at all rather than an empty one', () => {
    // An empty `<h2>` is worse than no `<h2>`: this heading ships
    // `--text-display` (80px on the seeded pages), so a blank one is a screenful
    // of nothing between the eyebrow and the offer.
    renderCopy({ config: {}, courseTitle: 'Bone Deep' });
    expect(headingEl()).toBeNull();
  });

  it('still prints an authored ACCENT when the heading is unclaimed and blank', () => {
    // The accent is the creator's own words — the italic second line closing the
    // heading, `OWED_READS.invite`. Dropping it because the heading beside it has
    // no claim would be a copy loss, which is the class of bug this file's own
    // history is mostly made of.
    renderCopy({
      config: { accent: 'is waiting.' },
      courseTitle: 'Bone Deep',
    });
    const h2 = headingEl();
    expect(h2).not.toBeNull();
    // UNTRIMMED on purpose: `String.trim()` strips U+00A0, so a `.trim()` here
    // would not notice the `&nbsp;` separator being emitted with nothing on its
    // left — a visible indent on an 80px heading, and invisible to the test.
    expect(h2?.textContent).toBe('is waiting.');
    expect(sectionHeadings()).not.toContain('Bone Deep');
  });

  it('keeps the canvas edit seam on an authored heading', () => {
    // The `{#if}` guard sits OUTSIDE the contenteditable span, so a heading the
    // creator has typed is still clickable in the studio canvas. Asserted because
    // wrapping a contenteditable in a condition is the obvious way to break inline
    // editing, and the studio is `ssr = false` so nothing else would catch it.
    renderCopy({ config: { heading: 'The ground' }, editable: true });
    const field = document.body.querySelector(
      'h2.invite__heading [data-field="heading"]'
    );
    expect(field).not.toBeNull();
    expect(field?.getAttribute('contenteditable')).toBe('true');
  });

  it('has no inline heading field when the heading is blank AND unclaimed — the inspector owns that case', () => {
    // The known consequence of the guard, recorded rather than discovered later:
    // with nothing to print there is no node to make editable, so an empty
    // heading is authored from the inspector's own content field (which exists —
    // the Design panel carries every section's copy fields) rather than inline.
    // This is the same behaviour the other four converted sections already have.
    renderCopy({ config: {}, editable: true });
    expect(document.body.querySelector('[data-field="heading"]')).toBeNull();
  });

  it('keeps the heading and the accent in one h2, in that order, when both exist', () => {
    renderCopy({
      config: { heading: 'The ground', accent: 'is waiting.' },
      courseTitle: 'Bone Deep',
    });
    // One heading element, not two — the accent is part of the sentence, and the
    // ` ` between them is the only separator (the markup is deliberately
    // whitespace-tight so no second space creeps in).
    expect(document.body.querySelectorAll('h2.invite__heading')).toHaveLength(
      1
    );
    expect(headingEl()?.textContent?.replace(/ /g, ' ').trim()).toBe(
      'The ground is waiting.'
    );
  });
});
