/**
 * ReelSection — the tree's largest section, newly wired to the nine axes.
 *
 * This file is NEW: `ReelSection` had no test at all, which is part of why five
 * blend layers, 32 hand-authored SVG rects, two raw-px breakpoints and a
 * hardcoded editorial sentence all survived in it.
 *
 * What is pinned here, in the order it matters:
 *
 *  - THE ASPECT↔SCRIM RULE. `media: bleed` is the only axis value shipping a
 *    scrim, so it is the only one where the caption, meta and transport may sit
 *    ON the media. At every other value they drop below the frame. This section
 *    is the reason the rule exists: it used to flip `aspect-ratio` at two raw-px
 *    breakpoints against a scrim fixed at 62%.
 *  - THE BRIDGE. `coerce.ts` has declared `reel: { eyebrow: ['eyebrow','kicker'],
 *    tag: ['tag','clip'] }` for two rounds and this renderer consumed neither —
 *    zero `asStringFrom`, zero `aliasKeys`. The golden page stores `kicker` and
 *    `clip`; the served HTML had no eyebrow and the hardcoded word "Preview".
 *  - NO HARDCODED EDITORIAL VOICE (`Codex-i9pzs`): "This is what a descent looks
 *    like." is gone, and the generic rec tag takes the existing i18n key.
 *  - `strip` IS DESCOPED (contract A27) and must fall back, not render blank.
 *  - The waveform's 32 bars are generated, and the geometry is byte-identical to
 *    the hand-authored rects.
 *  - The `editable`/`onEdit` seam: real text children (pilot lesson 9) and
 *    write-back to the key the value was READ from (contract A60).
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import ReelSection from './ReelSection.svelte';

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

function context(
  sellPreview: Promise<SellPreview | null> = Promise.resolve(null),
  title = 'The course title'
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'demo',
      title,
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
    // Required since the field stopped meaning "undefined is true". This section
    // has no conversion affordance, so the value only has to be stated.
    purchasable: true,
    sellPreview,
  };
}

const PREVIEW: SellPreview = {
  intro: null,
  reel: {
    playlistUrl: '/cdn/x/reel.m3u8',
    posterUrl: null,
    durationSeconds: 45,
  },
};

/** What the golden page actually stores — the builder's flat vocabulary. */
const GOLDEN: SectionProps = {
  kicker: 'In motion',
  heading: 'See it in motion',
  sub: 'A real practice, unhurried — exactly as you would meet it.',
  clip: 'Practice preview',
  duration: '0:30',
};

/** The 32 bar heights the section shipped as hand-authored `<rect>` elements. */
const SHIPPED_HEIGHTS = [
  10, 14, 20, 26, 22, 16, 12, 18, 28, 34, 30, 22, 14, 10, 16, 24, 32, 28, 20,
  12, 16, 22, 30, 26, 18, 12, 10, 16, 22, 18, 12, 8,
];

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
  sellPreview?: Promise<SellPreview | null>;
  courseTitle?: string;
  /**
   * What the PAGE has decided this section may use for its heading. Absent is the
   * real default for four of the five fallback-capable sections on any page — only
   * one of them claims the course title (`claimTitleFallback`).
   */
  titleFallback?: string;
}) {
  component = mount(ReelSection, {
    target: document.body,
    props: {
      config: props.config ?? GOLDEN,
      context: context(props.sellPreview, props.courseTitle),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
      titleFallback: props.titleFallback,
    },
  });
  flushSync();
  return document.body;
}

const root = () => document.body.querySelector('.reel');
const title = () => document.body.querySelector('h2.reel__title');
const eyebrow = () => document.body.querySelector('.reel__eyebrow');
const tag = () => document.body.querySelector('.reel__tag');
const topmeta = () => document.body.querySelector('.reel__topmeta');
const lower = () => document.body.querySelector('.reel__lower');

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('ReelSection — the aspect↔scrim rule', () => {
  it('puts the meta and lower block ON the media at media: bleed', () => {
    render({ design: CANDLELIT });
    expect(root()?.getAttribute('data-reel-overlay')).toBe('over');
    expect(topmeta()?.getAttribute('data-reel-at')).toBe('over');
    expect(lower()?.getAttribute('data-reel-at')).toBe('over');
  });

  for (const media of ['frame', 'mask', 'inset'] as const) {
    it(`drops them BELOW the frame at media: ${media}, which ships no scrim`, () => {
      render({ design: { ...CANDLELIT, media } });
      expect(root()?.getAttribute('data-reel-overlay')).toBe('below');
      expect(lower()?.getAttribute('data-reel-at')).toBe('below');
    });
  }

  it('renders no letterbox at all at media: none, and keeps the copy', () => {
    render({ design: { ...CANDLELIT, media: 'none' } });
    expect(document.body.querySelector('.reel__frame')).toBeNull();
    expect(title()).not.toBeNull();
  });

  it('always keeps the waveform composition below, since it has no poster', () => {
    render({ variant: 'waveform', design: CANDLELIT });
    expect(root()?.getAttribute('data-reel-overlay')).toBe('below');
    expect(document.body.querySelector('.reel__frame')).toBeNull();
    expect(document.body.querySelector('.reel__audio')).not.toBeNull();
  });
});

describe('ReelSection — compositions, and the descoped strip', () => {
  for (const id of ['theatre', 'plain', 'split', 'waveform']) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id });
      expect(root()?.getAttribute('data-reel-composition')).toBe(id);
    });
  }

  it('falls back to theatre for `strip`, which is DESCOPED per contract A27', () => {
    // Declared in the catalogue, deliberately unbuilt: it needs 3–5 clips against
    // a single scalar `previewVideoMediaId`. It must fall back to a real
    // composition rather than render an empty section.
    render({ variant: 'strip' });
    expect(root()?.getAttribute('data-reel-composition')).toBe('theatre');
    expect(document.body.querySelector('.reel__frame')).not.toBeNull();
  });

  it('falls back to theatre for the retired `cinema` id', () => {
    render({ variant: 'cinema' });
    expect(root()?.getAttribute('data-reel-composition')).toBe('theatre');
  });

  it('draws viewfinder corners in theatre and split, not in plain', () => {
    render({ variant: 'theatre' });
    expect(document.body.querySelectorAll('.reel__corner')).toHaveLength(4);
    reset();
    render({ variant: 'plain' });
    expect(document.body.querySelectorAll('.reel__corner')).toHaveLength(0);
  });
});

describe('ReelSection — the builder bridge (Codex-tqr51)', () => {
  it('reads the builder`s `kicker` as the eyebrow', () => {
    render({ config: GOLDEN });
    expect(eyebrow()?.textContent?.trim()).toBe('In motion');
  });

  it('reads the builder`s `clip` as the rec tag', () => {
    render({ config: GOLDEN });
    expect(tag()?.textContent).toContain('Practice preview');
  });

  it('prefers `tag` over `clip` when a page holds both', () => {
    render({ config: { ...GOLDEN, tag: 'Canonical' } });
    expect(tag()?.textContent).toContain('Canonical');
  });

  it('falls back to the existing i18n key for the rec tag — generic chrome', () => {
    render({ config: { heading: 'H' } });
    expect(tag()?.textContent).toContain('Preview');
  });

  it('prefers the authored `duration` over the computed clip length', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    // The clip is 45s, so the computed badge would be "0:45".
    expect(document.body.querySelector('.reel__dur')?.textContent).toContain(
      '0:30'
    );
  });

  it('computes the badge from the clip when no duration is authored', async () => {
    render({ config: { heading: 'H' }, sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    expect(document.body.querySelector('.reel__dur')?.textContent).toContain(
      '0:45'
    );
  });
});

describe('ReelSection — no hardcoded editorial voice (Codex-i9pzs)', () => {
  it('never serves the old hardcoded sentence', () => {
    render({ config: {}, courseTitle: 'A different brand entirely' });
    expect(document.body.textContent).not.toContain(
      'what a descent looks like'
    );
  });

  it('falls back to the course title WHEN THE PAGE HAS CLAIMED IT HERE', () => {
    render({
      config: {},
      courseTitle: 'Bone Deep',
      titleFallback: 'Bone Deep',
    });
    expect(title()?.textContent?.trim()).toBe('Bone Deep');
  });

  /*
   * THE AGGREGATE DEFECT, at this section's end of it. Five sections each fell back
   * to `context.course.title` on their own, so a page with the hero filled and the
   * section headings blank served `<h1>Bone Deep</h1>` and four `<h2>Bone Deep</h2>`.
   */
  it('does NOT print the course title when the page claimed it elsewhere', () => {
    render({ config: {}, courseTitle: 'Bone Deep' });
    expect(title()).toBeNull();
    expect(document.body.textContent).not.toContain('Bone Deep');
  });

  it('self-hides the heading when there is no title either', () => {
    /*
     * `courseTitle: ''`, not `undefined`. Passing `undefined` through a
     * DEFAULTED parameter (`title = 'The course title'`) selects the default, so
     * the assertion would have been testing the opposite of what it says — and
     * it failed loudly rather than passing vacuously, which is the good outcome.
     * An empty title is the real shape of "this course has nothing to lend the
     * heading", and it exercises the same `{#if}` guard.
     */
    render({ config: {}, courseTitle: '' });
    expect(title()).toBeNull();
  });
});

describe('ReelSection — the streamed transport', () => {
  it('shows a pending skeleton, never a dead play button', () => {
    let resolve!: (value: SellPreview | null) => void;
    const pending = new Promise<SellPreview | null>((r) => {
      resolve = r;
    });
    render({ sellPreview: pending });
    expect(document.body.querySelector('.reel__skeleton')).not.toBeNull();
    expect(document.body.querySelector('button.reel__play')).toBeNull();
    resolve(null);
  });

  it('renders a real play BUTTON once a playlist resolves', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    const play = document.body.querySelector('button.reel__play');
    expect(play).not.toBeNull();
    expect(play?.getAttribute('aria-label')).toContain('practice preview');
  });

  /*
   * THE ASSERTION THIS REPLACES IS THE DEFECT, RECORDED. It read
   * `expect(document.body.querySelector('.reel__rest-rail')).not.toBeNull()` and
   * it PASSED — the section's contract was that a course with no preview clip
   * publishes a full letterbox frame containing a dimmed `PlayIcon` and a scrub
   * rail, neither of which is a control or could become one. That is the hollow
   * shell, asserted as intended behaviour.
   */
  it('renders NO frame and no dead transport when there is no preview', async () => {
    render({ sellPreview: Promise.resolve(null) });
    await tick();
    flushSync();
    expect(document.body.querySelector('button.reel__play')).toBeNull();
    expect(document.body.querySelector('.reel__play--empty')).toBeNull();
    expect(document.body.querySelector('.reel__rest-rail')).toBeNull();
    expect(document.body.querySelector('.reel__frame')).toBeNull();
    expect(document.body.querySelector('.reel__stage')).toBeNull();
    // The heading still stands — the copy never depends on the stream.
    expect(title()).not.toBeNull();
  });

  it('keeps the frame for an authored poster with no clip', async () => {
    render({
      config: { ...GOLDEN, posterUrl: 'https://cdn.example/still.webp' },
      sellPreview: Promise.resolve(null),
    });
    await tick();
    flushSync();
    // A real still is content; what it must NOT carry is a play affordance.
    expect(document.body.querySelector('.reel__frame')).not.toBeNull();
    expect(document.body.querySelector('.reel__image')).not.toBeNull();
    expect(document.body.querySelector('button.reel__play')).toBeNull();
  });

  it('renders NOTHING when the section has neither copy nor a clip', async () => {
    render({ config: {}, sellPreview: Promise.resolve(null) });
    await tick();
    flushSync();
    expect(root()).toBeNull();
  });

  it('self-hides `waveform` entirely when there is no clip to transport', async () => {
    render({
      config: {},
      variant: 'waveform',
      sellPreview: Promise.resolve(null),
    });
    await tick();
    flushSync();
    // Its whole subject is the transport, so an authored poster cannot save it.
    expect(document.body.querySelector('.reel__audio')).toBeNull();
    expect(root()).toBeNull();
  });
});

describe('ReelSection — the generated waveform', () => {
  it('draws 32 bars whose geometry is byte-identical to the hand-authored rects', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    const rects = [...document.body.querySelectorAll('.reel__wave--base rect')];
    expect(rects).toHaveLength(32);
    rects.forEach((r, i) => {
      const h = SHIPPED_HEIGHTS[i];
      expect(r.getAttribute('height')).toBe(String(h));
      expect(r.getAttribute('x')).toBe(String(4 + i * 15));
      expect(r.getAttribute('y')).toBe(String((40 - h) / 2));
      expect(r.getAttribute('width')).toBe('7');
      expect(r.getAttribute('rx')).toBe('3');
    });
  });

  it('reuses the bars through a <use> reference rather than drawing them twice', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    expect(
      document.body.querySelectorAll('.reel__wave--fill rect')
    ).toHaveLength(0);
    expect(document.body.querySelector('.reel__wave--fill use')).not.toBeNull();
  });

  it('carries no emoji or textual play glyph', () => {
    render({ config: GOLDEN });
    // U+25B6 and U+25B7 both carry emoji presentation on Apple platforms.
    expect(document.body.textContent).not.toMatch(/[▶▷✦]/);
  });
});

describe('ReelSection — the editable seam', () => {
  it('adds NO edit attributes on the public page', () => {
    render({ config: GOLDEN });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    render({ config: GOLDEN, editable: true });
    const h = title();
    expect(h?.getAttribute('contenteditable')).toBe('true');
    expect(h?.textContent?.trim()).toBe(GOLDEN.heading);
    expect(h?.childNodes.length).toBeGreaterThan(0);
  });

  it('writes a tag edit back to `clip` on a page that stores `clip`', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: GOLDEN, editable: true, onEdit });
    const el = document.body.querySelector(
      '.reel__tag [contenteditable]'
    ) as HTMLElement;
    el.textContent = 'Edited';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('clip', 'Edited');
  });

  it('writes a tag edit back to `tag` on a page that stores `tag`', () => {
    // Contract A60: always writing the canonical key would leave a page holding
    // BOTH, with the alias list's winner unchanged — so the creator's edit would
    // render as nothing while the data grew a second copy.
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({
      config: { heading: 'H', tag: 'Canonical' },
      editable: true,
      onEdit,
    });
    const el = document.body.querySelector(
      '.reel__tag [contenteditable]'
    ) as HTMLElement;
    el.textContent = 'Edited';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('tag', 'Edited');
  });

  it('keeps the decorative rec dot out of the editable region', () => {
    render({ config: GOLDEN, editable: true });
    const dot = document.body.querySelector('.reel__dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.hasAttribute('contenteditable')).toBe(false);
  });
});
