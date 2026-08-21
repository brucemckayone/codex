/**
 * MapSection — the six compositions, the axes read in markup, the read boundary
 * and the heading outline
 * (`docs/design/journey-sections/02-axis-contract.md` A9, `05-bridge-table.md` WT-4).
 *
 * WHAT THIS FILE IS FOR, and what it deliberately leaves to the browser.
 *
 * The axes are CSS custom properties resolved on an ANCESTOR (`.jp-sec`), and jsdom
 * implements neither `container-type` nor `cqw` nor `color-mix()`, so it cannot say
 * anything true about what an axis PAINTS. Contrast, geometry at the three preview
 * widths and the reduced-motion kill switch are therefore measured in a real browser
 * and recorded in the WP report (contract A10/A24).
 *
 * What jsdom CAN pin down, and what this file exists to pin down, is everything the
 * component decides in MARKUP:
 *
 *  - which composition renders, and what each one degrades to at 0 and 1 stages —
 *    the compositions differ by ELEMENT STRUCTURE, so a regression here is invisible
 *    to any attribute-level check;
 *  - the one axis read in markup (`motion: none`, which unwires the scroll
 *    choreography rather than merely speeding it up);
 *  - the read boundary: `title ← heading` and `foot ← note`, which were a LIVE copy
 *    loss on all seven journey pages (bead `Codex-tqr51`);
 *  - the heading OUTLINE, which research §5.1 requires to be independent of the
 *    `type` axis — visual scale and document structure are separate;
 *  - that the heading is real server-rendered TEXT rather than an element a
 *    client-side action fills in later (pilot lesson 9);
 *  - that no emoji reaches the rendered output, which is a recorded product rule and
 *    was being violated by a 🔒 glyph on twelve practice cards of the golden page.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import MapSection from './MapSection.svelte';

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

function practice(n: number, type = 'video', order = n) {
  return {
    contentId: `p${n}`,
    slug: `p${n}`,
    title: `Practice ${n}`,
    contentType: type as 'video' | 'audio' | 'written',
    sortOrder: order,
  };
}

function stage(
  n: number,
  practices = [practice(n)],
  gloss: string | null = `Gloss ${n}`
) {
  return {
    id: `s${n}`,
    name: `Stage ${n}`,
    gloss,
    sortOrder: n,
    practices,
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
      stageCount: 3,
      practiceCount: 3,
    },
    stages: [stage(1), stage(2), stage(3)],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
    dashboardUrl: 'http://lvh.me:3000/journeys/demo/dashboard',
    enrolled: false,
    offer: null,
    sellPreview: Promise.resolve<SellPreview | null>(null),
    ...overrides,
  };
}

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  context?: JourneySalesContext;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(MapSection, {
    target: document.body,
    props: {
      config: props.config ?? {},
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

function reset() {
  if (component) {
    unmount(component);
    component = undefined;
  }
  document.body.innerHTML = '';
}

const composition = () =>
  document.body.querySelector('.descent')?.getAttribute('data-map');

afterEach(reset);

describe('MapSection — compositions', () => {
  it('defaults to `spine`: the gate list, the drawn spine and per-practice cards', () => {
    render({ variant: 'spine' });

    expect(composition()).toBe('spine');
    expect(document.body.querySelectorAll('.descent__band')).toHaveLength(3);
    expect(document.body.querySelector('.descent__spine-draw')).not.toBeNull();
    expect(document.body.querySelectorAll('.descent__card')).toHaveLength(3);
  });

  it('falls back to `spine` for a variant the catalogue does not declare', () => {
    // `resolveVariant` maps every retired id forward, so an unknown value can only
    // come from a client older than the catalogue. It must still render the stages.
    render({ variant: 'no-such-composition' });

    expect(composition()).toBe('spine');
    expect(document.body.querySelectorAll('.descent__band')).toHaveLength(3);
  });

  it('renders each of the six compositions with its own structure', () => {
    const skeletons: Array<[string, string, number]> = [
      ['spine', '.descent__band', 3],
      ['rows', '.descent__row', 3],
      ['cards', '.descent__stagecard', 3],
      ['table', '.descent__table tbody tr', 3],
      ['timeline', '.descent__panel', 3],
      ['numbered-prose', '.descent__para', 3],
    ];

    for (const [variant, selector, count] of skeletons) {
      render({ variant });
      expect(composition(), variant).toBe(variant);
      expect(document.body.querySelectorAll(selector), variant).toHaveLength(
        count
      );
      reset();
    }
  });

  it('gives the `table` composition real table semantics, not a div grid', () => {
    render({ variant: 'table' });

    const table = document.body.querySelector('.descent__table');
    expect(table?.tagName).toBe('TABLE');
    // Three columns, because `minutes` and per-stage `access` have no field on the
    // public read model — a fourth column would be a control that renders nothing.
    expect(table?.querySelectorAll('thead th')).toHaveLength(3);
    expect(
      [...(table?.querySelectorAll('thead th') ?? [])].every(
        (th) => th.getAttribute('scope') === 'col'
      )
    ).toBe(true);
    // The stage name is the ROW header — that is the heading relationship in a
    // table, and it is why these rows carry no `h3`.
    const rowHeaders = table?.querySelectorAll('tbody th[scope="row"]');
    expect(rowHeaders).toHaveLength(3);
    expect(table?.querySelectorAll('tbody h3')).toHaveLength(0);
  });

  it('makes the `timeline` scroll region keyboard-operable', () => {
    render({ variant: 'timeline' });

    const track = document.body.querySelector('.descent__track');
    // WCAG 2.1.1: nothing inside a panel is focusable, so the region itself must
    // be. The tabindex sits on a generic wrapper, not on the `ol` — a list has a
    // non-interactive role.
    expect(track?.tagName).toBe('DIV');
    expect(track?.getAttribute('tabindex')).toBe('0');
    expect(track?.querySelector('ol.descent__panels')).not.toBeNull();
  });

  it('drops the stats row on the two compositions that must not carry chrome', () => {
    for (const variant of ['spine', 'rows', 'cards', 'timeline']) {
      render({ variant });
      expect(
        document.body.querySelector('.descent__stats'),
        variant
      ).not.toBeNull();
      reset();
    }
    for (const variant of ['table', 'numbered-prose']) {
      render({ variant });
      // `table` states the same counts per row; `numbered-prose` is defined as
      // having no chrome at all.
      expect(
        document.body.querySelector('.descent__stats'),
        variant
      ).toBeNull();
      reset();
    }
  });
});

describe('MapSection — degradation', () => {
  it('renders NOTHING when the course has no stages', () => {
    render({ context: context({ stages: [] }) });

    expect(document.body.querySelector('.descent')).toBeNull();
    expect(document.body.textContent?.trim()).toBe('');
  });

  it('renders one coherent item per composition for a single-stage course', () => {
    const one = context({
      stages: [stage(1)],
      course: { ...context().course, stageCount: 1, practiceCount: 1 },
    });
    const skeletons: Array<[string, string]> = [
      ['spine', '.descent__band'],
      ['rows', '.descent__row'],
      ['cards', '.descent__stagecard'],
      ['table', '.descent__table tbody tr'],
      ['timeline', '.descent__panel'],
      ['numbered-prose', '.descent__para'],
    ];

    for (const [variant, selector] of skeletons) {
      render({ variant, context: one });
      expect(document.body.querySelectorAll(selector), variant).toHaveLength(1);
      // The singular of the count label, because paraglide 1.11.8 has no plurals
      // and a bare "1 practices" is the failure that rule exists to prevent.
      expect(document.body.textContent, variant).not.toContain('1 practices');
      reset();
    }
  });

  it('omits a stage with no practices from the pool rather than drawing an empty one', () => {
    render({
      variant: 'spine',
      context: context({ stages: [stage(1, []), stage(2)] }),
    });

    expect(document.body.querySelectorAll('.descent__band')).toHaveLength(2);
    expect(document.body.querySelectorAll('.descent__practices')).toHaveLength(
      1
    );
  });

  it('numbers past ten without changing numbering system', () => {
    // The previous ROMAN table stopped at ten and fell through to arabic, so an
    // eleven-stage course read `… ix, x, 11, 12`.
    const many = context({
      stages: Array.from({ length: 12 }, (_, i) => stage(i + 1)),
      course: { ...context().course, stageCount: 12, practiceCount: 12 },
    });
    render({ variant: 'rows', context: many });

    const numerals = [
      ...document.body.querySelectorAll('.descent__row-rn'),
    ].map((el) => el.textContent?.trim());
    expect(numerals[9]).toBe('x');
    expect(numerals[10]).toBe('xi');
    expect(numerals[11]).toBe('xii');
  });

  it('orders practices by sortOrder, not by array position', () => {
    render({
      variant: 'spine',
      context: context({
        stages: [
          stage(1, [
            practice(3, 'video', 3),
            practice(1, 'video', 1),
            practice(2, 'video', 2),
          ]),
        ],
      }),
    });

    const titles = [
      ...document.body.querySelectorAll('.descent__card-title'),
    ].map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Practice 1', 'Practice 2', 'Practice 3']);
  });
});

describe('MapSection — the axis read in markup', () => {
  it('`motion: none` unwires the choreography instead of speeding it up', () => {
    render({ variant: 'spine', design: { ...CANDLELIT, motion: 'none' } });

    // The enhanced class is what arms every hidden/dim pre-lit state, so removing
    // it is what makes `motion: none` a genuine no-op rather than a fast reveal.
    expect(document.body.querySelector('.descent')?.className).not.toContain(
      'descent--enhanced'
    );
    // Everything is still there and still legible.
    expect(document.body.querySelectorAll('.descent__band')).toHaveLength(3);
    expect(document.body.querySelector('.descent__spine-draw')).not.toBeNull();
  });

  it('keeps the spine markup mounted so the atmosphere gate can zero it', () => {
    // Research §2.3 chose an opacity/mix gate over conditional rendering. That
    // only holds if the markup is unconditional.
    render({ variant: 'spine', design: { ...CANDLELIT, surface: 'bare' } });

    expect(document.body.querySelector('.descent__spine')).not.toBeNull();
    expect(document.body.querySelector('.descent__spine-track')).not.toBeNull();
    expect(document.body.querySelector('.descent__spine-draw')).not.toBeNull();
  });
});

describe('MapSection — the read boundary', () => {
  it('reads the BUILDER keys `heading` and `note` (bead Codex-tqr51)', () => {
    // Verified against the database before the fix: all seven stored map sections
    // hold exactly `{eyebrow, heading, sub, note}`. The renderer read `title` and
    // `foot`, so `note` never rendered at all and `heading` was masked by a
    // byte-identical hardcoded fallback.
    render({
      config: {
        eyebrow: 'The whole path',
        heading: 'The stored heading',
        sub: 'The stored sub-line',
        note: 'The stored closing note',
      },
    });

    expect(
      document.body.querySelector('.descent__title')?.textContent?.trim()
    ).toBe('The stored heading');
    expect(
      document.body.querySelector('.descent__foot')?.textContent?.trim()
    ).toBe('The stored closing note');
    expect(
      document.body.querySelector('.descent__eyebrow')?.textContent?.trim()
    ).toBe('The whole path');
    expect(
      document.body.querySelector('.descent__sub')?.textContent?.trim()
    ).toBe('The stored sub-line');
  });

  it('still prefers the renderer’s own `title` / `foot` when a page authored those', () => {
    render({
      config: {
        title: 'The renderer key',
        heading: 'The builder key',
        foot: 'The renderer foot',
        note: 'The builder note',
      },
    });

    expect(
      document.body.querySelector('.descent__title')?.textContent?.trim()
    ).toBe('The renderer key');
    expect(
      document.body.querySelector('.descent__foot')?.textContent?.trim()
    ).toBe('The renderer foot');
  });

  it('falls back to the course’s OWN title, never to invented prose', () => {
    // `Codex-i9pzs`: this used to be the hardcoded "Everything you'll walk." —
    // one org's editorial voice compiled into every org's sell page.
    render({ config: {} });

    const h2 = document.body.querySelector('.descent__title');
    expect(h2?.textContent?.trim()).toBe('The course title');
    expect(document.body.textContent).not.toContain("Everything you'll walk");
  });

  it('self-hides the closing note when the creator wrote none', () => {
    render({ config: { heading: 'A heading' } });

    expect(document.body.querySelector('.descent__foot')).toBeNull();
  });
});

describe('MapSection — accessibility contracts', () => {
  it('keeps the heading OUTLINE independent of the `type` axis', () => {
    // Research §5.1: `type` is visual scale only. `monumental` must not promote a
    // heading level, and `restrained` must not demote one.
    const outline = (design: ResolvedSectionDesign) => {
      render({ variant: 'spine', design });
      const tags = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(
        (h) => h.tagName
      );
      reset();
      return tags;
    };

    const monumental = outline({ ...CANDLELIT, type: 'monumental' });
    const restrained = outline({ ...CANDLELIT, type: 'restrained' });

    expect(monumental).toEqual(restrained);
    // h2 (section) → h3 (stage) → h4 (practice): three levels, no skips.
    expect(monumental[0]).toBe('H2');
    expect(monumental.filter((t) => t === 'H3')).toHaveLength(3);
    expect(monumental.filter((t) => t === 'H4')).toHaveLength(3);
  });

  it('carries the lock affordance as an icon plus a screen-reader hint, with NO emoji', () => {
    render({ variant: 'spine' });

    // The 🔒 glyph was served twelve times on the golden page, and `▶ ♪ ✎` were a
    // "typographic" glyph map whose `▶` (U+25B6) has emoji presentation on Apple
    // platforms. Both are gone; the meaning is an icon plus a visually-hidden hint.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const glyph of ['🔒', '▶', '♪', '✎', '•']) {
      expect(html, glyph).not.toContain(glyph);
    }
    expect(document.body.querySelectorAll('svg').length).toBeGreaterThan(0);
    const hint = document.body.querySelector('.sr-only');
    expect(hint?.textContent?.trim()).toBe('included with membership');
    // The global utility, not a local re-declaration (contract A18).
    expect(document.body.querySelector('.descent__sr')).toBeNull();
  });

  it('hides the decorative numeral from assistive tech — the `ol` carries the order', () => {
    render({ variant: 'spine' });

    const node = document.body.querySelector('.descent__node');
    expect(node?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.querySelector('.descent__stages')?.tagName).toBe('OL');
  });
});

describe('MapSection — the edit seam', () => {
  it('renders the heading as REAL TEXT, with no edit attributes, on the public page', () => {
    render({
      config: { heading: 'Server rendered heading', note: 'Served note' },
    });

    const h2 = document.body.querySelector('.descent__title');
    // `render-edit/EditableText.svelte` renders an EMPTY element and fills
    // `textContent` from a Svelte ACTION; actions do not run during SSR, so using
    // it here would serve `<h2></h2>` and paint the heading in after hydration.
    expect(h2?.textContent?.trim()).toBe('Server rendered heading');
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(
      document.body.querySelector('.descent__foot')?.textContent?.trim()
    ).toBe('Served note');
  });

  it('layers contenteditable on the same real text and writes back the BUILDER keys', () => {
    const edits: Array<[string, string]> = [];
    render({
      config: {
        eyebrow: 'Kicker',
        heading: 'A heading',
        sub: 'A sub',
        note: 'A note',
      },
      editable: true,
      onEdit: (key, value) => edits.push([key, value]),
    });

    const h2 = document.body.querySelector('.descent__title') as HTMLElement;
    expect(h2.getAttribute('contenteditable')).toBe('true');
    expect(h2.getAttribute('data-field')).toBe('heading');
    expect(h2.textContent?.trim()).toBe('A heading');

    h2.textContent = 'Typed in the canvas';
    h2.dispatchEvent(new Event('input', { bubbles: true }));

    const foot = document.body.querySelector('.descent__foot') as HTMLElement;
    // The key is `note`, the builder's name — NOT the renderer's `foot`. An edit
    // has to write back to the key `section-fields.ts` declares.
    expect(foot.getAttribute('data-field')).toBe('note');
    foot.textContent = 'Edited note';
    foot.dispatchEvent(new Event('input', { bubbles: true }));

    expect(edits).toEqual([
      ['heading', 'Typed in the canvas'],
      ['note', 'Edited note'],
    ]);
  });
});
