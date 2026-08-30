/**
 * FeelSection — the six compositions, the `kicker` bridge and the free-taste
 * player (`docs/design/journey-sections/02-axis-contract.md` A9/A29).
 *
 * WHAT THIS FILE IS FOR. The axes are custom properties resolved on an ANCESTOR
 * (`.jp-sec`) and jsdom implements neither container queries nor `color-mix()`, so
 * contrast and geometry are measured in a real browser and recorded in the WP
 * report (contract A10). What jsdom pins down is what this component decides in
 * MARKUP, and for `feel` that includes the copy-loss regression guard:
 *
 *  - THE `kicker` BRIDGE. `Codex-tqr51`: this section read `eyebrow` while the
 *    builder writes `kicker`, so the eyebrow was absent from the served HTML on
 *    every page including the golden one. The alias table already declared it and
 *    nothing consumed it.
 *  - DEGRADATION TO AN EMPTY ARRAY. `inclusions[]` is a `repeater` field with no
 *    editor UI (contract A29), so all six compositions must render copy-only
 *    rather than an empty container.
 *  - THE WAVEFORM IS NO LONGER A FAKE CONTROL. It used to carry
 *    `role="presentation"`, `aria-hidden="true"` AND an `onclick` seek handler.
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
import FeelSection from './FeelSection.svelte';

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

/** What the golden page and both `studio-alpha` pages store. */
const FLAT: SectionProps = {
  kicker: 'What to expect',
  heading: 'How it feels.',
  body: 'No performance, no getting it right.',
};

const WITH_INCLUSIONS: SectionProps = {
  ...FLAT,
  inclusions: [
    { label: 'Twelve guided practices', detail: 'Ten to thirty minutes each' },
    { label: 'A written companion' },
  ],
};

const WITH_PLAYER: SectionProps = {
  ...FLAT,
  previewTitle: 'Naming what is here',
  previewSub: 'Practice one',
  previewDuration: 540,
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(FeelSection, {
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

const root = () => document.body.querySelector('.feel');
const heading = () => document.body.querySelector('h2.feel__heading');
const eyebrow = () => document.body.querySelector('.feel__eyebrow');
const list = () => document.body.querySelector('.feel-list');
const leads = () =>
  [...document.body.querySelectorAll('.feel-list__lead')].map((e) =>
    e.textContent?.trim()
  );

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('FeelSection — compositions', () => {
  for (const id of [
    'paired',
    'column',
    'statement',
    'grid',
    'ledger',
    'stack',
  ]) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id, config: WITH_INCLUSIONS });
      expect(root()?.getAttribute('data-feel')).toBe(id);
      expect(heading()?.textContent?.trim()).toBe('How it feels.');
      expect(leads()).toEqual([
        'Twelve guided practices',
        'A written companion',
      ]);
    });
  }

  it('falls back to paired for an unknown variant', () => {
    render({ variant: 'no-such-composition' });
    expect(root()?.getAttribute('data-feel')).toBe('paired');
  });

  it('falls back to paired when no variant is passed', () => {
    render({});
    expect(root()?.getAttribute('data-feel')).toBe('paired');
  });

  it('self-hides entirely when there is no copy and no player', () => {
    render({ config: {} });
    expect(root()).toBeNull();
  });

  it('marks only paired as split, so the grid is two-column there', () => {
    for (const [id, expected] of [
      ['paired', 'yes'],
      ['column', 'no'],
      ['statement', 'no'],
      ['grid', 'no'],
      ['ledger', 'no'],
      ['stack', 'no'],
    ] as const) {
      render({ variant: id, config: WITH_INCLUSIONS });
      expect(root()?.getAttribute('data-split'), id).toBe(expected);
      reset();
    }
  });
});

describe('FeelSection — one list, six arrangements', () => {
  it('draws the ember spine timeline for paired and column', () => {
    for (const id of ['paired', 'column']) {
      render({ variant: id, config: WITH_INCLUSIONS });
      expect(list()?.getAttribute('data-list'), id).toBe('timeline');
      expect(document.body.querySelectorAll('.feel-list__m')).toHaveLength(2);
      reset();
    }
  });

  it('runs the inclusions on inline for statement, with no markers', () => {
    render({ variant: 'statement', config: WITH_INCLUSIONS });
    expect(list()?.getAttribute('data-list')).toBe('runon');
    expect(document.body.querySelectorAll('.feel-list__m')).toHaveLength(0);
  });

  for (const id of ['grid', 'ledger', 'stack']) {
    it(`uses its own name as the list arrangement for ${id}`, () => {
      render({ variant: id, config: WITH_INCLUSIONS });
      expect(list()?.getAttribute('data-list')).toBe(id);
      expect(document.body.querySelectorAll('.feel-list__m')).toHaveLength(0);
    });
  }

  it('renders a detail line only where one is authored', () => {
    render({ variant: 'ledger', config: WITH_INCLUSIONS });
    expect(document.body.querySelectorAll('.feel-list__sub')).toHaveLength(1);
  });

  it('drops an inclusion with no label rather than rendering a blank row', () => {
    render({
      variant: 'grid',
      config: {
        ...FLAT,
        inclusions: [{ detail: 'orphan' }, { label: 'Kept' }],
      },
    });
    expect(leads()).toEqual(['Kept']);
  });

  for (const id of [
    'paired',
    'column',
    'statement',
    'grid',
    'ledger',
    'stack',
  ]) {
    it(`${id} degrades to copy-only with no inclusions`, () => {
      render({ variant: id, config: FLAT });
      expect(list()).toBeNull();
      expect(heading()).not.toBeNull();
      expect(document.body.querySelector('.feel__body')).not.toBeNull();
    });
  }
});

describe('FeelSection — the builder bridge (Codex-tqr51)', () => {
  it('reads the builder`s `kicker` as the eyebrow', () => {
    render({ config: FLAT });
    expect(eyebrow()?.textContent?.trim()).toBe('What to expect');
  });

  it('prefers an authored `eyebrow` over `kicker`', () => {
    render({ config: { ...FLAT, eyebrow: 'Authored' } });
    expect(eyebrow()?.textContent?.trim()).toBe('Authored');
  });

  it('self-hides the eyebrow when neither key is set', () => {
    render({ config: { heading: 'Only a heading' } });
    expect(eyebrow()).toBeNull();
  });
});

describe('FeelSection — the free-taste player', () => {
  it('self-hides without previewTitle, which is its switch', () => {
    render({ config: FLAT });
    expect(document.body.querySelector('.feel-taste')).toBeNull();
  });

  it('renders with a labelled play control when previewTitle is set', () => {
    render({ config: WITH_PLAYER });
    const button = document.body.querySelector('button.feel-play');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Play preview');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('draws every bar server-side, deterministically', () => {
    render({ config: WITH_PLAYER });
    expect(document.body.querySelectorAll('.feel-wave i')).toHaveLength(56);
  });

  it('the waveform is decoration, with no click handler pretending otherwise', () => {
    // It used to be an aria-hidden, role="presentation" <div> carrying onclick —
    // a seek control with no keyboard path and no name. There is nothing to seek:
    // the transport is a visual taste with no audio (`Codex-scab9`).
    render({ config: WITH_PLAYER });
    const wave = document.body.querySelector('.feel-wave') as HTMLElement;
    expect(wave.getAttribute('aria-hidden')).toBe('true');
    expect(wave.getAttribute('role')).toBeNull();
    expect(wave.onclick).toBeNull();
  });

  it('uses an icon component rather than an inline svg path', () => {
    // Contract A8: no inline `<svg>` in a section; icons come from
    // `Icon/*Icon.svelte` via `IconBase`, which sets `aria-hidden` itself.
    render({ config: WITH_PLAYER });
    const glyph = document.body.querySelector('.feel-play__glyph');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores a non-numeric previewDuration rather than trusting it', () => {
    // The `number` control has no editor UI (contract A29) and the text
    // fallthrough writes a string, which must fall back to the 480s default.
    render({ config: { ...FLAT, previewTitle: 'x', previewDuration: '999' } });
    expect(
      document.body.querySelector('.feel-taste__time')?.textContent
    ).toContain('8:00');
  });
});

describe('FeelSection — the editable seam', () => {
  it('adds NO edit attributes on the public page', () => {
    render({ config: FLAT });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    render({ config: FLAT, editable: true });
    const h = heading();
    expect(h?.getAttribute('contenteditable')).toBe('true');
    expect(h?.textContent?.trim()).toBe('How it feels.');
    expect(h?.childNodes.length).toBeGreaterThan(0);
  });

  it('writes the eyebrow back to `kicker`, the key the page actually holds', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: FLAT, editable: true, onEdit });
    const el = eyebrow() as HTMLElement;
    el.textContent = 'Edited';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('kicker', 'Edited');
  });
});
