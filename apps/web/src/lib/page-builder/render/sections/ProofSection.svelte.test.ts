/**
 * ProofSection — the six compositions, the read boundary and the precedence flip
 * (`docs/design/journey-sections/02-axis-contract.md` A9/A10, `05-bridge-table.md`).
 *
 * WHAT THIS FILE IS FOR, and what it leaves to the browser.
 *
 * The axes are CSS custom properties resolved on an ANCESTOR (`.jp-sec`), and jsdom
 * implements neither `container-type`/`cqw`, nor `color-mix()`, nor `getAnimations()`
 * — so it cannot say anything true about what an axis PAINTS. Contrast, geometry and
 * the reduced-motion kill switch are verified by measurement in a real browser and
 * recorded in the WP report (contract A10).
 *
 * What jsdom CAN pin down is everything this component decides in MARKUP:
 *
 *  - which composition renders, and how many quotes each one shows — `spotlight`
 *    and `pull` differ from `grid` by CARDINALITY, which no attribute check sees;
 *  - `marquee`'s clone track, which must be `aria-hidden` so nobody hears each
 *    quote twice;
 *  - the `accent` axis read in markup, which decides whether the avatar has a
 *    plate to sit on at all;
 *  - the AUTHORED-WINS precedence flip, which is the one behavioural change here;
 *  - that the copy is real server-rendered TEXT rather than an element some
 *    client-side action fills in later (pilot lesson 9 — the SEO contract).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import ProofSection from './ProofSection.svelte';

/** The Candlelit bundle — the axes every existing published page actually stores. */
const CANDLELIT: ResolvedSectionDesign = {
  width: 'narrow',
  density: 'airy',
  surface: 'media',
  edge: 'none',
  align: 'center',
  type: 'monumental',
  accent: 'glow',
  motion: 'drift',
  media: 'bleed',
};

type Testimonial = JourneySalesContext['testimonials'][number];

function courseRow(n: number): Testimonial {
  return {
    id: `course-${n}`,
    sortOrder: n,
    quote: `Course row ${n}`,
    authorName: `Course Name ${n}`,
    authorContext: 'from the course table',
  };
}

function context(
  overrides: Partial<JourneySalesContext> = {}
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'demo',
      title: 'The course title',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: null,
      stageCount: 1,
      practiceCount: 1,
    },
    stages: [],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
    dashboardUrl: 'http://lvh.me:3000/journeys/demo/dashboard',
    enrolled: false,
    offer: null,
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview | null>(null),
    ...overrides,
  };
}

/** Three authored quotes in the builder's numbered vocabulary. */
const AUTHORED: SectionProps = {
  heading: 'What people say.',
  q1: 'Authored one',
  n1: 'Ada',
  c1: 'six months in',
  q2: 'Authored two',
  n2: 'Bea',
  q3: 'Authored three',
  n3: 'Cai',
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  context?: JourneySalesContext;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(ProofSection, {
    target: document.body,
    props: {
      config: props.config ?? AUTHORED,
      context: props.context ?? context(),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

const root = () => document.body.querySelector('.proof');
const quotes = () => [...document.body.querySelectorAll('.proof__quote')];

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('ProofSection — compositions', () => {
  for (const id of ['grid', 'stack', 'spotlight', 'wall', 'marquee', 'pull']) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id });
      expect(root()?.getAttribute('data-proof')).toBe(id);
    });
  }

  it('falls back to grid for a variant this build does not know', () => {
    // `resolveVariant` has already mapped every retired id forward, so an unknown
    // value can only come from a client newer than this bundle. Falling back keeps
    // the page rendering its quotes rather than nothing.
    render({ variant: 'no-such-composition' });
    expect(root()?.getAttribute('data-proof')).toBe('grid');
  });

  it('falls back to grid when no variant is passed at all', () => {
    render({});
    expect(root()?.getAttribute('data-proof')).toBe('grid');
  });

  it('shows every quote in the multi-quote compositions', () => {
    for (const id of ['grid', 'stack', 'wall']) {
      render({ variant: id });
      expect(quotes(), id).toHaveLength(3);
      reset();
    }
  });

  it('renders exactly ONE quote for spotlight and pull', () => {
    // The canvas partial hid cards 2+ with `display: none`, which still serves
    // quotes nobody can read. These compositions render one.
    for (const id of ['spotlight', 'pull']) {
      render({ variant: id });
      expect(quotes(), id).toHaveLength(1);
      expect(quotes()[0].textContent?.trim()).toBe('Authored one');
      reset();
    }
  });
});

describe('ProofSection — marquee', () => {
  it('duplicates the track and hides the clone from assistive tech', () => {
    render({ variant: 'marquee' });
    const tracks = document.body.querySelectorAll('.proof__track');
    expect(tracks).toHaveLength(2);
    const clone = document.body.querySelector('.proof__track--clone');
    expect(clone?.getAttribute('aria-hidden')).toBe('true');
    // Six figures in the DOM, three of them announced.
    expect(quotes()).toHaveLength(6);
  });

  it('renders no clone track in any other composition', () => {
    render({ variant: 'grid' });
    expect(document.body.querySelector('.proof__track--clone')).toBeNull();
  });
});

describe('ProofSection — testimonial precedence (authored wins)', () => {
  it('prefers the authored q/n/c fields over the course testimonial rows', () => {
    // The behavioural flip. Every other prop in the renderer reads
    // `authored ?? derived`; proof was the only one reversed, so a creator's
    // typed quotes were discarded in favour of course rows they could not see.
    render({
      config: AUTHORED,
      context: context({ testimonials: [courseRow(1), courseRow(2)] }),
    });
    expect(quotes().map((q) => q.textContent?.trim())).toEqual([
      'Authored one',
      'Authored two',
      'Authored three',
    ]);
  });

  it('falls back to the course rows when nothing is authored', () => {
    render({
      config: { heading: 'Proof' },
      context: context({ testimonials: [courseRow(2), courseRow(1)] }),
    });
    expect(quotes().map((q) => q.textContent?.trim())).toEqual([
      'Course row 1',
      'Course row 2',
    ]);
  });

  it('sorts the course rows by sortOrder', () => {
    render({
      config: { heading: 'Proof' },
      context: context({
        testimonials: [courseRow(3), courseRow(1), courseRow(2)],
      }),
    });
    expect(quotes().map((q) => q.textContent?.trim())).toEqual([
      'Course row 1',
      'Course row 2',
      'Course row 3',
    ]);
  });

  it('self-hides when there is neither authored copy nor a course row', () => {
    render({ config: { heading: 'Proof' }, context: context() });
    expect(root()).toBeNull();
  });

  it('skips a numbered slot whose quote is blank', () => {
    render({ config: { q1: 'Only this', n1: 'Ada', q2: '', n2: 'Bea' } });
    expect(quotes()).toHaveLength(1);
  });
});

describe('ProofSection — the read boundary', () => {
  it('reads the trust line through the legacy `trust` alias', () => {
    // `05-bridge-table.md`: the builder writes `trust`, the renderer prop is
    // `trustLabel`. The stored key is what pages actually hold.
    render({ config: { ...AUTHORED, trust: '2,400 and counting' } });
    expect(
      document.body.querySelector('.proof__count')?.textContent?.trim()
    ).toBe('2,400 and counting');
  });

  it('prefers the canonical trustLabel when both are present', () => {
    render({
      config: { ...AUTHORED, trustLabel: 'canonical', trust: 'legacy' },
    });
    expect(
      document.body.querySelector('.proof__count')?.textContent?.trim()
    ).toBe('canonical');
  });

  it('omits the trust line entirely when neither key is set', () => {
    render({ config: AUTHORED });
    expect(document.body.querySelector('.proof__trust')).toBeNull();
  });

  it('caps the decorative dot stack at five', () => {
    const many: SectionProps = { trust: 'lots' };
    for (let i = 1; i <= 8; i += 1) {
      many[`q${i}`] = `Quote ${i}`;
      many[`n${i}`] = `Name ${i}`;
    }
    render({ config: many });
    expect(quotes()).toHaveLength(8);
    expect(document.body.querySelectorAll('.proof__dot')).toHaveLength(5);
  });
});

describe('ProofSection — the hardcoded voice is gone (Codex-i9pzs)', () => {
  it('renders NO heading element when the creator set none', () => {
    render({ config: { q1: 'A quote', n1: 'Ada' } });
    expect(document.body.querySelector('.proof__heading')).toBeNull();
    expect(document.body.querySelector('h2')).toBeNull();
  });

  it('never emits the retired editorial fallback', () => {
    render({ config: { q1: 'A quote', n1: 'Ada' } });
    expect(document.body.textContent).not.toContain('the ground gives back');
  });

  it('renders the creator heading when there is one', () => {
    render({ config: AUTHORED });
    expect(document.body.querySelector('h2')?.textContent?.trim()).toBe(
      'What people say.'
    );
  });
});

describe('ProofSection — the accent axis read in markup', () => {
  // `--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`, so
  // the avatar has no plate and its paired ink would land on the section
  // background instead (pilot lesson 4, contract A34).
  it('marks the avatar unplated where the accent fill is transparent', () => {
    for (const accent of ['text', 'edge'] as const) {
      render({ design: { ...CANDLELIT, accent } });
      expect(root()?.getAttribute('data-plated'), accent).toBe('no');
      reset();
    }
  });

  it('keeps the plate where the accent fill is a real colour', () => {
    for (const accent of ['fill', 'glow', 'none'] as const) {
      render({ design: { ...CANDLELIT, accent } });
      expect(root()?.getAttribute('data-plated'), accent).toBe('yes');
      reset();
    }
  });
});

describe('ProofSection — the motion axis read in markup', () => {
  // `marquee`'s ticker is an enhancement over a static wrapped list, so a
  // creator who asks for no motion must not get a scrolling ticker. The CSS
  // cannot read the ancestor `data-jp-motion`, hence the markup read.
  it('switches the ticker off at motion: none', () => {
    render({ variant: 'marquee', design: { ...CANDLELIT, motion: 'none' } });
    expect(root()?.getAttribute('data-motion')).toBe('none');
  });

  it('leaves the ticker on for every other motion value', () => {
    for (const motion of ['fade', 'rise', 'stagger', 'drift'] as const) {
      render({ variant: 'marquee', design: { ...CANDLELIT, motion } });
      expect(root()?.getAttribute('data-motion'), motion).toBe('on');
      reset();
    }
  });

  it('still renders every quote when the ticker is off', () => {
    // The static list is the baseline, so switching the ticker off must not
    // strand any quote — the clone is what disappears, not the content.
    render({ variant: 'marquee', design: { ...CANDLELIT, motion: 'none' } });
    expect(document.body.querySelectorAll('.proof__track')).toHaveLength(2);
    expect(
      [
        ...document.body.querySelectorAll(
          '.proof__track:not(.proof__track--clone) .proof__quote'
        ),
      ].map((q) => q.textContent?.trim())
    ).toEqual(['Authored one', 'Authored two', 'Authored three']);
  });
});

describe('ProofSection — the motion axis stagger', () => {
  it('arms one reveal container rather than one per quote', () => {
    // The shared atom is `.reveal--armed .jp-reveal`, a DESCENDANT selector, so
    // the action belongs on the container; both on one element matches nothing.
    render({ variant: 'grid' });
    expect(document.body.querySelectorAll('.proof__inner')).toHaveLength(1);
    expect(
      document.body.querySelectorAll('.proof__item.jp-reveal').length
    ).toBe(3);
  });

  it('clamps the stagger step at five for a long list', () => {
    const many: SectionProps = {};
    for (let i = 1; i <= 8; i += 1) {
      many[`q${i}`] = `Quote ${i}`;
      many[`n${i}`] = `Name ${i}`;
    }
    render({ config: many });
    const steps = [...document.body.querySelectorAll('.proof__item')].map(
      (el) => el.getAttribute('data-jp-step')
    );
    expect(steps).toEqual(['1', '2', '3', '4', '5', '5', '5', '5']);
  });
});

describe('ProofSection — the edit seam', () => {
  it('emits NO edit attributes on the public render', () => {
    render({ config: AUTHORED });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    // Pilot lesson 9: `EditableText` renders an empty element and fills
    // `textContent` from an action, and actions do not run during SSR — so the
    // public page would serve `<h2></h2>`. This asserts the text is a real child.
    render({ config: AUTHORED, editable: true });
    const h2 = document.body.querySelector('h2');
    expect(h2?.getAttribute('contenteditable')).toBe('true');
    expect(h2?.textContent?.trim()).toBe('What people say.');
    expect(quotes()[0].textContent?.trim()).toBe('Authored one');
  });

  it('reports an edit against the stored numbered key', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: AUTHORED, editable: true, onEdit });
    const second = quotes()[1] as HTMLElement;
    expect(second.getAttribute('data-field')).toBe('q2');
    second.textContent = 'Edited';
    second.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('q2', 'Edited');
  });

  it('leaves course-owned rows read-only, because they have no props key', () => {
    render({
      config: { heading: 'Proof' },
      context: context({ testimonials: [courseRow(1)] }),
      editable: true,
    });
    // The heading is authored copy, so it stays editable…
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
    // …but a course row has no `q<n>` to write back to.
    expect(quotes()[0].getAttribute('contenteditable')).toBeNull();
  });
  /* ═══════════════════════════════════════════════════════════════════════
     THE TWO CONTROLS THAT WERE NOT CONTROLS (WP-2's section sweep).

     Both are properties of a composition rather than of the copy, and both were
     invisible to every assertion in this file before it swept the compositions:
     one is a scroll container nothing can reach by keyboard, the other a pause
     mechanism whose selector can never match.
     ═══════════════════════════════════════════════════════════════════════ */
  describe('keyboard reach into the mobile snap-row (WCAG 2.1.1)', () => {
    /*
      `@container (max-width: 48rem)` rewrites `grid` and `wall` into
      `display: flex; overflow-x: auto` with `flex: 0 0 84%` per quote and
      `scrollbar-width: none`. Nothing inside a quote is focusable, so the box
      scrolls and no keyboard can scroll it. jsdom implements no container
      queries, so the ATTRIBUTE is what is asserted here — the CSS that consumes
      it, and the 674px measurement that found it, are recorded in the component.
    */
    it('makes the row focusable for the two compositions that become a scroller', () => {
      for (const variant of ['grid', 'wall']) {
        render({ variant });
        expect(
          document.body.querySelector('.proof__grid')?.getAttribute('tabindex'),
          variant
        ).toBe('0');
        reset();
      }
    });

    it('adds no tab stop to a composition that never scrolls', () => {
      for (const variant of ['stack', 'spotlight', 'pull']) {
        render({ variant });
        expect(
          document.body.querySelector('.proof__grid')?.getAttribute('tabindex'),
          variant
        ).toBeNull();
        reset();
      }
    });

    it('adds no tab stop to a single quote, which cannot overflow', () => {
      render({
        variant: 'grid',
        config: { heading: 'One', q1: 'Only', n1: 'Ada' },
      });
      expect(quotes()).toHaveLength(1);
      expect(
        document.body.querySelector('.proof__grid')?.getAttribute('tabindex')
      ).toBeNull();
    });
  });

  describe('the marquee can be stopped (WCAG 2.2.2)', () => {
    /*
      The ticker is `animation: … linear infinite`, 15.6s–42s a cycle, and it
      starts on its own. Its only declared stop was
      `.proof__marquee:hover, .proof__marquee:focus-within` — and `:focus-within`
      CANNOT MATCH, because the strip holds no focusable node (`<figure>` /
      `<blockquote>` / `<figcaption>`, and the clone track is `aria-hidden`). So
      the real coverage was pointer-only: no keyboard user and no touch user had
      any mechanism at all.
    */
    it('has no focusable node inside the strip — which is why the button exists', () => {
      render({ variant: 'marquee' });
      const strip = document.body.querySelector('.proof__marquee');
      expect(strip).not.toBeNull();
      expect(
        strip?.querySelectorAll('a,button,input,select,textarea,[tabindex]')
      ).toHaveLength(0);
    });

    it('offers a named pause control that toggles the paused state', () => {
      render({ variant: 'marquee' });
      const button =
        document.body.querySelector<HTMLButtonElement>('.proof__pause');
      expect(button).not.toBeNull();
      // The house keys, shared with `components/pricing/ContentMarquee.svelte`.
      expect(button?.getAttribute('aria-label')).toBe('Pause the moving row');
      expect(
        document.body
          .querySelector('.proof__marquee')
          ?.getAttribute('data-paused')
      ).toBeNull();

      button?.click();
      flushSync();
      expect(
        document.body
          .querySelector('.proof__marquee')
          ?.getAttribute('data-paused')
      ).toBe('true');
      expect(
        document.body.querySelector('.proof__pause')?.getAttribute('aria-label')
      ).toBe('Resume the moving row');
    });

    it('sits OUTSIDE the masked strip, so the edge fade cannot fade the control', () => {
      render({ variant: 'marquee' });
      const button = document.body.querySelector('.proof__pause');
      expect(button?.closest('.proof__marquee')).toBeNull();
      expect(button?.closest('.proof__ticker')).not.toBeNull();
    });

    it('offers nothing to pause when the motion axis is off', () => {
      render({ variant: 'marquee', design: { ...CANDLELIT, motion: 'none' } });
      expect(document.body.querySelector('.proof__pause')).toBeNull();
    });

    it('offers nothing to pause on a composition with no ticker', () => {
      render({ variant: 'grid' });
      expect(document.body.querySelector('.proof__pause')).toBeNull();
    });
  });
});
