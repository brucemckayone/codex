/**
 * IntroVideoSection — the streamed sell-preview, the five compositions, the
 * builder bridge, and the aspect↔scrim rule.
 *
 * The original file locked the shell+stream behaviour only. WT-2 keeps every one
 * of those assertions (they are the SEO-critical contract) and adds the four
 * things this round is accountable for:
 *
 *  - the `coerce.ts` bridge, whose absence was a LIVE copy loss: the golden page
 *    stores `kicker`, `clip` and `duration` and the served HTML contained none of
 *    them (`Codex-tqr51`, `OWED_READS.introVideo`);
 *  - no hardcoded editorial voice — the heading falls back to the creator's own
 *    course title and self-hides when there is nothing (`Codex-i9pzs`);
 *  - the aspect↔scrim rule: text sits ON the media only where the `media` axis
 *    ships a scrim, i.e. `bleed`, and drops below the frame at every other value;
 *  - the `editable`/`onEdit` seam, with real text children (pilot lesson 9) and
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
import IntroVideoSection from './IntroVideoSection.svelte';

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
    // No offer read in this harness — this section shows no prices anyway.
    offer: null,
    sellPreview,
  };
}

const PREVIEW: SellPreview = {
  intro: {
    playlistUrl: '/cdn/x/preview.m3u8',
    posterUrl: null,
    durationSeconds: 90,
  },
  reel: null,
};

/** What the golden page actually stores — the builder's flat vocabulary. */
const GOLDEN: SectionProps = {
  kicker: 'The film',
  heading: 'This is the part that has to do with a video',
  sub: 'never beleive the things you have no idea about',
  clip: 'THIS IS NOT WHAT YOU EXPECTED',
  duration: '1:00',
};

const HEADING = 'Ninety seconds inside the work.';

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
  sellPreview?: Promise<SellPreview | null>;
  courseTitle?: string;
}) {
  component = mount(IntroVideoSection, {
    target: document.body,
    props: {
      config: props.config ?? GOLDEN,
      context: context(props.sellPreview, props.courseTitle),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

const heading = () => document.body.querySelector('h2.iv__heading');
const eyebrow = () => document.body.querySelector('.iv__eyebrow');
const meta = () => document.body.querySelector('.iv__meta');
const root = () => document.body.querySelector('.iv');

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('IntroVideoSection — streamed preview (the shell+stream contract)', () => {
  it('shows the heading immediately and a skeleton while the preview is pending', () => {
    let resolve!: (value: SellPreview | null) => void;
    const pending = new Promise<SellPreview | null>((r) => {
      resolve = r;
    });

    render({ config: { heading: HEADING }, sellPreview: pending });

    // Heading is on the critical path — present before the stream resolves.
    expect(heading()?.textContent?.trim()).toBe(HEADING);
    expect(document.body.querySelector('.section-skeleton')).not.toBeNull();
    expect(document.body.querySelector('.iv__play')).toBeNull();

    resolve(null); // avoid a dangling unhandled promise
  });

  it('replaces the skeleton with the play affordance once the preview resolves', async () => {
    render({
      config: { heading: HEADING },
      sellPreview: Promise.resolve(PREVIEW),
    });
    await tick();
    flushSync();

    expect(document.body.querySelector('.section-skeleton')).toBeNull();
    const play = document.body.querySelector('.iv__play');
    expect(play).not.toBeNull();
    expect(play?.getAttribute('aria-label')).toContain('intro film');
  });

  it('degrades to no skeleton and no play when the preview resolves null', async () => {
    render({
      config: { heading: HEADING },
      sellPreview: Promise.resolve(null),
    });
    await tick();
    flushSync();

    expect(heading()?.textContent?.trim()).toBe(HEADING);
    expect(document.body.querySelector('.section-skeleton')).toBeNull();
    expect(document.body.querySelector('.iv__play')).toBeNull();
    expect(document.body.querySelector('.iv__empty')).not.toBeNull();
  });
});

describe('IntroVideoSection — the builder bridge (Codex-tqr51)', () => {
  it('reads the builder`s `kicker` as the eyebrow', () => {
    render({ config: GOLDEN });
    expect(eyebrow()?.textContent?.trim()).toBe('The film');
  });

  it('prefers `eyebrow` over `kicker` when a page holds both', () => {
    render({ config: { ...GOLDEN, eyebrow: 'Canonical' } });
    expect(eyebrow()?.textContent?.trim()).toBe('Canonical');
  });

  it('renders the authored `clip` as the on-frame tag — OWED_READS', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    expect(document.body.querySelector('.iv__tag')?.textContent?.trim()).toBe(
      'THIS IS NOT WHAT YOU EXPECTED'
    );
  });

  it('prefers the authored `duration` over the computed clip length', async () => {
    render({ sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    // The clip is 90s, so the computed badge would be "1:30".
    expect(document.body.querySelector('.iv__duration')?.textContent).toContain(
      '1:00'
    );
  });

  it('computes the badge from the clip when no duration is authored', async () => {
    render({
      config: { heading: 'H' },
      sellPreview: Promise.resolve(PREVIEW),
    });
    await tick();
    flushSync();
    expect(document.body.querySelector('.iv__duration')?.textContent).toContain(
      '1:30'
    );
  });
});

describe('IntroVideoSection — no hardcoded editorial voice (Codex-i9pzs)', () => {
  it('never serves the old hardcoded sentence', () => {
    render({ config: {}, courseTitle: 'A different brand entirely' });
    expect(document.body.textContent).not.toContain('Ninety seconds inside');
  });

  it('falls back to the creator`s own course title', () => {
    render({ config: {}, courseTitle: 'Bone Deep' });
    expect(heading()?.textContent?.trim()).toBe('Bone Deep');
  });

  it('self-hides the heading when there is no title either', () => {
    render({ config: {}, courseTitle: undefined });
    expect(heading()).toBeNull();
  });
});

describe('IntroVideoSection — compositions', () => {
  for (const id of ['theatre', 'plain', 'split', 'bleed', 'card']) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id });
      expect(root()?.getAttribute('data-iv-composition')).toBe(id);
    });
  }

  it('falls back to theatre for an unknown variant', () => {
    render({ variant: 'cinema' });
    expect(root()?.getAttribute('data-iv-composition')).toBe('theatre');
  });

  it('draws viewfinder brackets only in theatre', () => {
    render({ variant: 'theatre' });
    expect(document.body.querySelectorAll('.iv__corner')).toHaveLength(4);
    reset();
    render({ variant: 'plain' });
    expect(document.body.querySelectorAll('.iv__corner')).toHaveLength(0);
  });
});

describe('IntroVideoSection — the aspect↔scrim rule', () => {
  it('puts the meta row ON the media at media: bleed, the only value with a scrim', async () => {
    render({ design: CANDLELIT, sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    expect(root()?.getAttribute('data-iv-overlay')).toBe('over');
    expect(meta()?.getAttribute('data-iv-meta')).toBe('over');
  });

  for (const media of ['frame', 'mask', 'inset'] as const) {
    it(`drops the meta row BELOW the frame at media: ${media} (no scrim)`, async () => {
      render({
        design: { ...CANDLELIT, media },
        sellPreview: Promise.resolve(PREVIEW),
      });
      await tick();
      flushSync();
      expect(root()?.getAttribute('data-iv-overlay')).toBe('below');
      expect(meta()?.getAttribute('data-iv-meta')).toBe('below');
    });
  }

  it('renders no media box at all at media: none', () => {
    render({ design: { ...CANDLELIT, media: 'none' } });
    expect(document.body.querySelector('.iv__media')).toBeNull();
    // …and the copy still stands.
    expect(heading()).not.toBeNull();
  });

  it('keeps card`s meta below the frame even at media: bleed', async () => {
    render({ variant: 'card', sellPreview: Promise.resolve(PREVIEW) });
    await tick();
    flushSync();
    expect(root()?.getAttribute('data-iv-overlay')).toBe('below');
  });
});

describe('IntroVideoSection — the accent-dependent play plate', () => {
  for (const accent of ['fill', 'glow', 'none'] as const) {
    it(`paints a solid plate at accent: ${accent}`, async () => {
      render({
        design: { ...CANDLELIT, accent },
        sellPreview: Promise.resolve(PREVIEW),
      });
      await tick();
      flushSync();
      expect(
        document.body.querySelector('.iv__play')?.getAttribute('data-iv-plate')
      ).toBe('solid');
    });
  }

  for (const accent of ['text', 'edge'] as const) {
    it(`falls back to a hollow ringed plate at accent: ${accent}, where the fill is transparent`, async () => {
      render({
        design: { ...CANDLELIT, accent },
        sellPreview: Promise.resolve(PREVIEW),
      });
      await tick();
      flushSync();
      expect(
        document.body.querySelector('.iv__play')?.getAttribute('data-iv-plate')
      ).toBe('hollow');
    });
  }
});

describe('IntroVideoSection — the editable seam', () => {
  it('adds NO edit attributes on the public page', () => {
    render({ config: GOLDEN });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    // Pilot lesson 9: `EditableText` renders an empty element and fills
    // `textContent` from an action, and actions do not run during SSR — so the
    // public page would serve an empty heading. The text must be a real child.
    render({ config: GOLDEN, editable: true });
    const h = heading();
    expect(h?.getAttribute('contenteditable')).toBe('true');
    expect(h?.textContent?.trim()).toBe(GOLDEN.heading);
    expect(h?.childNodes.length).toBeGreaterThan(0);
  });

  it('writes an eyebrow edit back to `kicker` on a page that stores `kicker`', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: GOLDEN, editable: true, onEdit });
    const el = eyebrow() as HTMLElement;
    el.textContent = 'Edited';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('kicker', 'Edited');
  });

  it('writes an eyebrow edit back to `eyebrow` on a page that stores `eyebrow`', () => {
    // Contract A60: always writing the canonical key would leave a page holding
    // BOTH, with the alias list's winner unchanged — so the creator's edit would
    // render as nothing while the data grew a second copy.
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({
      config: { eyebrow: 'Canonical', heading: 'H' },
      editable: true,
      onEdit,
    });
    const el = eyebrow() as HTMLElement;
    el.textContent = 'Edited';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('eyebrow', 'Edited');
  });
});
