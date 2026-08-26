/**
 * AcheSection — the six compositions, the `points` read, the `sub` bridge and the
 * collapse check (`docs/design/journey-sections/02-axis-contract.md` A9/A28).
 *
 * WHAT THIS FILE IS FOR. The axes are custom properties resolved on an ANCESTOR
 * (`.jp-sec`) and jsdom implements neither container queries nor `color-mix()`, so
 * contrast and geometry are measured in a real browser and recorded in the WP
 * report (contract A10). What jsdom pins down is what this component decides in
 * MARKUP, and for `ache` that is unusually load-bearing:
 *
 *  - THE `sub` BRIDGE. Six seeded sections across BOTH orgs store their body copy
 *    under `sub`, which nothing had ever read. This is the regression guard for
 *    that copy loss.
 *  - THE FIDELITY FIX. `body` used to become a second "beat" typeset as a
 *    headline, and `beats.length > 1` armed a two-viewport pinned scrolljack. The
 *    heading is now the only `<h2>` and the body is body copy — a DOM difference
 *    no attribute check sees.
 *  - DEGRADATION TO AN EMPTY ARRAY. `points` is a `list` field with no editor UI
 *    (contract A29), so `list` and `checklist` must render their copy and no list
 *    rather than an empty container.
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
import AcheSection from './AcheSection.svelte';

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
    sellPreview: Promise.resolve<SellPreview | null>(null),
  };
}

/** What the golden page stores — the builder's flat vocabulary. */
const FLAT: SectionProps = {
  kicker: 'If this is you',
  heading: 'Name the ache.',
  body: 'Describe the problem this journey speaks to.',
};

/** What the six SEEDED sections store: `eyebrow` + `heading` + `sub`. */
const SEEDED: SectionProps = {
  eyebrow: 'Why this',
  heading: 'You already know the shape of it.',
  sub: 'Grief is not a problem to be solved. These practices make room for it to move.',
};

const WITH_POINTS: SectionProps = {
  ...FLAT,
  points: [
    'You brace for it — and it still arrives sideways',
    'You are told time helps',
  ],
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(AcheSection, {
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

const root = () => document.body.querySelector('.ache');
const heading = () => document.body.querySelector('h2.ache__heading');
const body = () => document.body.querySelector('.ache__body');
const leads = () =>
  [...document.body.querySelectorAll('.ache__point-lead')].map((e) =>
    e.textContent?.trim()
  );

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('AcheSection — compositions', () => {
  for (const id of [
    'column',
    'statement',
    'paired',
    'list',
    'quote',
    'checklist',
  ]) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id, config: WITH_POINTS });
      expect(root()?.getAttribute('data-ache')).toBe(id);
      expect(heading()?.textContent?.trim()).toBe('Name the ache.');
    });
  }

  it('falls back to column for an unknown variant', () => {
    // `variant: "default"` is on SIX real sections across both orgs (contract
    // A49) and is not a declared ache composition. It must fall back, not break.
    render({ variant: 'default' });
    expect(root()?.getAttribute('data-ache')).toBe('column');
  });

  it('falls back to column when no variant is passed', () => {
    render({});
    expect(root()?.getAttribute('data-ache')).toBe('column');
  });

  it('self-hides entirely when there is no copy at all', () => {
    render({ config: {} });
    expect(root()).toBeNull();
  });
});

describe('AcheSection — the builder bridge', () => {
  it('reads the builder`s `kicker` as the eyebrow', () => {
    render({ config: FLAT });
    expect(
      document.body.querySelector('.ache__eyebrow')?.textContent?.trim()
    ).toBe('If this is you');
  });

  it('reads `sub` as the body — the six seeded sections` copy loss', () => {
    render({ config: SEEDED });
    expect(body()?.textContent?.trim()).toBe(
      'Grief is not a problem to be solved. These practices make room for it to move.'
    );
  });

  it('prefers `body` over `sub` when a page holds both', () => {
    render({ config: { ...SEEDED, body: 'The authored body.' } });
    expect(body()?.textContent?.trim()).toBe('The authored body.');
  });

  it('typesets the body as BODY COPY, not as a second heading', () => {
    // The fidelity bug: `beats` was `[heading, body]` and every beat rendered at
    // heading scale, so the creator's paragraph became a second headline.
    render({ config: FLAT });
    expect(document.body.querySelectorAll('h2')).toHaveLength(1);
    expect(body()?.tagName).toBe('P');
  });

  it('renders an authored `beats[]` array when a page holds one', () => {
    render({
      config: { beats: ['One beat', 'Another beat'] },
      variant: 'list',
    });
    expect(leads()).toEqual(['One beat', 'Another beat']);
  });
});

describe('AcheSection — points, and degrading when they are absent', () => {
  it('splits a point on an en dash into a lead and a gloss', () => {
    render({ variant: 'list', config: WITH_POINTS });
    expect(leads()).toEqual(['You brace for it', 'You are told time helps']);
    expect(
      document.body.querySelector('.ache__point-gloss')?.textContent?.trim()
    ).toBe('and it still arrives sideways');
  });

  it('renders a tick per row in the checklist composition', () => {
    render({ variant: 'checklist', config: WITH_POINTS });
    expect(document.body.querySelectorAll('.ache__point')).toHaveLength(2);
    expect(document.body.querySelectorAll('.ache__mark')).toHaveLength(0);
  });

  it('renders a marker per row in the list composition', () => {
    render({ variant: 'list', config: WITH_POINTS });
    expect(document.body.querySelectorAll('.ache__mark')).toHaveLength(2);
  });

  for (const id of ['list', 'checklist']) {
    it(`${id} degrades to copy-only with no points`, () => {
      render({ variant: id, config: FLAT });
      expect(document.body.querySelector('.ache__points')).toBeNull();
      expect(heading()).not.toBeNull();
      expect(body()).not.toBeNull();
    });
  }

  it('the pinned scrolljack is gone — no track, no stage, no progress rail', () => {
    render({ config: { ...FLAT, beats: ['a', 'b', 'c'] } });
    expect(document.body.querySelector('.ache__track')).toBeNull();
    expect(document.body.querySelector('.ache__stage')).toBeNull();
    expect(document.body.querySelector('.ache__progress')).toBeNull();
  });
});

describe('AcheSection — the quote composition', () => {
  it('sets the heading inside a blockquote and keeps it an h2', () => {
    render({ variant: 'quote', config: FLAT });
    const quote = document.body.querySelector('blockquote.ache__quote');
    expect(quote).not.toBeNull();
    // `type` is visual scale ONLY and must never promote or demote a heading
    // LEVEL (research §5.1).
    expect(quote?.querySelector('h2')).not.toBeNull();
  });
});

describe('AcheSection — the editable seam', () => {
  it('adds NO edit attributes on the public page', () => {
    render({ config: FLAT });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    // Pilot lesson 9: `EditableText` renders an empty element and fills
    // `textContent` from an action, and actions do not run during SSR — so the
    // public page would serve `<h2></h2>`. The text must be a real child node.
    render({ config: FLAT, editable: true });
    const h = heading();
    expect(h?.getAttribute('contenteditable')).toBe('true');
    expect(h?.textContent?.trim()).toBe('Name the ache.');
    expect(h?.childNodes.length).toBeGreaterThan(0);
  });

  it('reports edits against the key the builder writes', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: FLAT, editable: true, onEdit });
    const h = heading() as HTMLElement;
    h.textContent = 'Edited';
    h.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('heading', 'Edited');
  });
});
