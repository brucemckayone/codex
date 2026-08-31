/**
 * TurnSection — the six compositions, the `from`/`to` read and the collapse check
 * (`docs/design/journey-sections/02-axis-contract.md` A9/A28).
 *
 * WHAT THIS FILE IS FOR. The axes are custom properties resolved on an ANCESTOR
 * (`.jp-sec`) and jsdom implements neither container queries nor `color-mix()`, so
 * contrast and geometry are measured in a real browser and recorded in the WP
 * report (contract A10). What jsdom pins down is what this component decides in
 * MARKUP:
 *
 *  - `from`/`to` — the `OWED_READS.turn` entries (A28). The `before-after`
 *    composition is made entirely of two keys nothing read.
 *  - DEGRADATION TO AN EMPTY ARRAY. `points` is a `list` field with no editor UI
 *    (contract A29), so `arc` and `numbered` must render their copy and no list.
 *  - `paired` moves the lede OUT of the head into the grid's second column — a
 *    DOM difference no attribute check sees.
 *  - REAL TEXT CHILDREN under `editable` (pilot lesson 9 — the SEO contract).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import TurnSection from './TurnSection.svelte';

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

function context(): JourneySalesContext {
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
  };
}

/** What every real page stores — the builder's flat vocabulary. */
const FLAT: SectionProps = {
  kicker: 'What changes',
  heading: 'The shift on offer.',
  body: 'Not insight — practice.',
};

const WITH_POINTS: SectionProps = {
  ...FLAT,
  points: [
    'Naming — saying the unsaid out loud',
    'Holding — staying with what rises',
    'Return',
  ],
};

const WITH_PANELS: SectionProps = {
  ...FLAT,
  from: 'Carrying it alone.',
  to: 'Held by a practice.',
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(TurnSection, {
    target: document.body,
    props: {
      config: props.config ?? FLAT,
      context: context(),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

const root = () => document.body.querySelector('.turn');
const statement = () => document.body.querySelector('h2.turn__statement');
const lede = () => document.body.querySelector('.turn__lede');
const names = () =>
  [...document.body.querySelectorAll('.turn__name')].map((e) =>
    e.textContent?.trim()
  );
const numerals = () =>
  [...document.body.querySelectorAll('.turn__num')].map((e) =>
    e.textContent?.trim()
  );

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('TurnSection — compositions', () => {
  for (const id of [
    'statement',
    'column',
    'paired',
    'arc',
    'before-after',
    'numbered',
  ]) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id, config: { ...WITH_POINTS, ...WITH_PANELS } });
      expect(root()?.getAttribute('data-turn')).toBe(id);
      expect(statement()?.textContent?.trim()).toBe('The shift on offer.');
    });
  }

  it('falls back to statement for an unknown variant', () => {
    render({ variant: 'no-such-composition' });
    expect(root()?.getAttribute('data-turn')).toBe('statement');
  });

  it('falls back to statement when no variant is passed', () => {
    // `statement` is the catalogue's `defaultVariant` for `turn`.
    render({});
    expect(root()?.getAttribute('data-turn')).toBe('statement');
  });

  it('self-hides entirely when there is no copy at all', () => {
    render({ config: {} });
    expect(root()).toBeNull();
  });

  it('marks only arc and paired as split, so the grid is two-column there', () => {
    for (const [id, expected] of [
      ['arc', 'yes'],
      ['paired', 'yes'],
      ['statement', 'no'],
      ['column', 'no'],
      ['numbered', 'no'],
      ['before-after', 'no'],
    ] as const) {
      render({ variant: id, config: WITH_POINTS });
      expect(root()?.getAttribute('data-split'), id).toBe(expected);
      reset();
    }
  });

  it('paired renders the lede OUTSIDE the head, as the second column', () => {
    render({ variant: 'paired' });
    expect(document.body.querySelector('.turn__head .turn__lede')).toBeNull();
    expect(lede()?.textContent?.trim()).toBe('Not insight — practice.');
  });

  it('every other composition keeps the lede inside the head', () => {
    render({ variant: 'column' });
    expect(
      document.body.querySelector('.turn__head .turn__lede')
    ).not.toBeNull();
  });
});

describe('TurnSection — the arc, and degrading when points are absent', () => {
  it('splits a point on an en dash into a name and a gloss', () => {
    render({ variant: 'arc', config: WITH_POINTS });
    expect(names()).toEqual(['Naming', 'Holding', 'Return']);
    expect(
      document.body.querySelector('.turn__gloss')?.textContent?.trim()
    ).toBe('saying the unsaid out loud');
  });

  it('numbers the arc in roman and the numbered composition in digits', () => {
    render({ variant: 'arc', config: WITH_POINTS });
    expect(numerals()).toEqual(['i', 'ii', 'iii']);
    reset();
    render({ variant: 'numbered', config: WITH_POINTS });
    expect(numerals()).toEqual(['1', '2', '3']);
  });

  it('draws the rail and root for arc only', () => {
    render({ variant: 'arc', config: WITH_POINTS });
    expect(document.body.querySelectorAll('.turn__rail')).toHaveLength(2);
    expect(document.body.querySelector('.turn__root')).not.toBeNull();
    reset();
    render({ variant: 'numbered', config: WITH_POINTS });
    expect(document.body.querySelectorAll('.turn__rail')).toHaveLength(0);
    expect(document.body.querySelector('.turn__root')).toBeNull();
  });

  it('keeps the stage list an ordered list with an accessible name', () => {
    render({ variant: 'arc', config: WITH_POINTS });
    const list = document.body.querySelector('ol.turn__stages');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('aria-label')).toBeTruthy();
    // The `<ol>` conveys order, so the numerals are decoration — otherwise a
    // screen reader hears the position twice per row.
    for (const n of document.body.querySelectorAll('.turn__num')) {
      expect(n.getAttribute('aria-hidden')).toBe('true');
    }
  });

  for (const id of ['arc', 'numbered']) {
    it(`${id} degrades to copy-only with no points`, () => {
      render({ variant: id, config: FLAT });
      expect(document.body.querySelector('.turn__stages')).toBeNull();
      expect(statement()).not.toBeNull();
      expect(lede()).not.toBeNull();
    });
  }
});

describe('TurnSection — before/after (OWED_READS.turn)', () => {
  it('renders both panels from `from` and `to`', () => {
    render({ variant: 'before-after', config: WITH_PANELS });
    const bodies = [...document.body.querySelectorAll('.turn__panel-body')].map(
      (e) => e.textContent?.trim()
    );
    expect(bodies).toEqual(['Carrying it alone.', 'Held by a practice.']);
  });

  it('renders one panel when only one side is authored', () => {
    render({ variant: 'before-after', config: { ...FLAT, to: 'Held.' } });
    expect(document.body.querySelectorAll('.turn__panel')).toHaveLength(2);
    expect(document.body.querySelectorAll('.turn__panel-body')).toHaveLength(1);
  });

  it('degrades to copy-only when neither side is authored', () => {
    render({ variant: 'before-after', config: FLAT });
    expect(document.body.querySelector('.turn__panels')).toBeNull();
    expect(statement()).not.toBeNull();
  });
});

describe('TurnSection — the editable seam', () => {
  it('adds NO edit attributes on the public page', () => {
    render({ config: FLAT });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    render({ config: FLAT, editable: true });
    const h = statement();
    expect(h?.getAttribute('contenteditable')).toBe('true');
    expect(h?.textContent?.trim()).toBe('The shift on offer.');
    expect(h?.childNodes.length).toBeGreaterThan(0);
  });

  it('writes back to the key the value was READ from, not the renderer prop', () => {
    // A page storing `statement` must be edited as `statement`; one storing the
    // builder's `heading` must be edited as `heading`. Writing the wrong one would
    // leave BOTH keys stored, and the alias order would hide the newer value.
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: { statement: 'Authored' }, editable: true, onEdit });
    const h = statement() as HTMLElement;
    h.textContent = 'Edited';
    h.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('statement', 'Edited');

    reset();
    onEdit.mockClear();
    render({ config: FLAT, editable: true, onEdit });
    const h2 = statement() as HTMLElement;
    h2.textContent = 'Edited';
    h2.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('heading', 'Edited');
  });
});
