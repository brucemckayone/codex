/**
 * HeroSection — the six compositions, the nine axes and the read boundary
 * (`docs/design/journey-sections/02-axis-contract.md` A9/A28, `05-bridge-table.md`).
 *
 * WHAT THIS FILE IS FOR, and what it deliberately leaves to the browser.
 *
 * The axes are CSS custom properties resolved on an ANCESTOR (`.jp-sec`), so jsdom —
 * which does not implement `container-type`, `cqw`, `aspect-ratio` resolution or
 * `getAnimations()` — cannot say anything true about what an axis PAINTS. Geometry,
 * contrast and the reduced-motion kill switch are therefore verified by measurement
 * in a real browser and recorded in the WP report (contract A10).
 *
 * What jsdom CAN pin down, and what this file exists to pin down, is everything the
 * component decides in MARKUP:
 *
 *  - which composition renders, and where the media plate sits inside it — the three
 *    image-led compositions differ by DOM POSITION, not by CSS, so a regression here
 *    is invisible to any attribute-level check;
 *  - the two axes read in markup (`media: none`, `motion: none`);
 *  - the read boundary: the three bridged aliases (`sub`/`button`/`quiet`) and the
 *    three keys this worktree owed (`accent`/`felt`/`bg`);
 *  - that the headline is real server-rendered TEXT rather than an element some
 *    client-side action fills in later, which is the SEO contract of this section.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import HeroSection from './HeroSection.svelte';

const CHECKOUT = 'http://lvh.me:3000/journeys/demo/checkout';
const DASHBOARD = 'http://lvh.me:3000/journeys/demo/dashboard';

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
    checkoutUrl: CHECKOUT,
    dashboardUrl: DASHBOARD,
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
  component = mount(HeroSection, {
    target: document.body,
    props: {
      config: props.config ?? { headline: 'A headline' },
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

/** The `.hero__inner` children, by their first class — the composition's skeleton. */
function innerChildren(): string[] {
  const inner = document.body.querySelector('.hero__inner');
  return [...(inner?.children ?? [])].map(
    (c) => String(c.className).split(' ')[0]
  );
}

afterEach(() => {
  if (component) {
    unmount(component);
    component = undefined;
  }
  document.body.innerHTML = '';
});

describe('HeroSection — compositions', () => {
  it('defaults to `stage`: copy only, no media plate, scroll cue present', () => {
    render({ variant: 'stage', config: { headline: 'A headline' } });

    expect(
      document.body.querySelector('.hero')?.getAttribute('data-hero')
    ).toBe('stage');
    expect(document.body.querySelector('.hero__media')).toBeNull();
    expect(document.body.querySelector('.hero__cue')).not.toBeNull();
    // `stage` is the flat copy stack — no column wrapper, no meta row.
    expect(innerChildren()).not.toContain('hero__meta');
  });

  it('falls back to `stage` for a variant the catalogue does not declare', () => {
    // `resolveVariant` maps every retired id forward, so this can only come from a
    // client older than the catalogue. It must still render the creator's copy.
    render({ variant: 'no-such-composition' });

    expect(
      document.body.querySelector('.hero')?.getAttribute('data-hero')
    ).toBe('stage');
    expect(
      document.body.querySelector('.hero__headline')?.textContent
    ).toContain('A headline');
  });

  it('`split-media` puts the plate AFTER the copy column, inside the inner grid', () => {
    render({ variant: 'split-media' });

    expect(innerChildren()).toEqual(['hero__col', 'hero__media']);
    // The cue points below the fold; the split composition has never shown one.
    expect(document.body.querySelector('.hero__cue')).toBeNull();
  });

  it('`poster` puts the plate BEFORE the copy column', () => {
    render({ variant: 'poster' });

    expect(innerChildren()).toEqual(['hero__media', 'hero__col']);
    expect(document.body.querySelector('.hero__cue')).toBeNull();
  });

  it('`full-bleed` hoists the plate out of the inner column, to fill the section', () => {
    render({ variant: 'full-bleed' });

    const media = document.body.querySelector('.hero__media');
    // A DIRECT child of `.hero` — this is what lets `inset: 0` fill the section
    // rather than the content column, and it is a DOM-position difference no
    // attribute-level check would catch.
    expect(media?.parentElement?.classList.contains('hero')).toBe(true);
    expect(document.body.querySelector('.hero__inner .hero__media')).toBeNull();
    // Text over media: the scrim node is mandatory (research §5.1).
    expect(document.body.querySelector('.hero__scrim')).not.toBeNull();
    expect(document.body.querySelector('.hero__cue')).not.toBeNull();
  });

  it('`banner` and `oversized` group the lead copy so it is ONE grid item', () => {
    // Emitting eyebrow / headline / meta as three siblings put the headline in
    // banner's second grid column and the meta on a second row (measured).
    for (const variant of ['banner', 'oversized']) {
      render({
        variant,
        config: {
          eyebrow: 'Kicker',
          headline: 'A headline',
          sub: 'A sub-line',
        },
      });

      expect(innerChildren()).toEqual(['hero__col', 'hero__meta']);
      expect(
        document.body.querySelector('.hero__meta .hero__sub')
      ).not.toBeNull();
      expect(document.body.querySelector('.hero__media')).toBeNull();
      expect(document.body.querySelector('.hero__cue')).toBeNull();

      if (component) unmount(component);
      component = undefined;
      document.body.innerHTML = '';
    }
  });
});

describe('HeroSection — the axes read in markup', () => {
  it('`media: none` degrades an image-led composition to a single column', () => {
    render({
      variant: 'split-media',
      config: { headline: 'A headline', sub: 'A sub-line' },
      design: { ...CANDLELIT, media: 'none' },
    });

    expect(document.body.querySelector('.hero__media')).toBeNull();
    // There is nothing left to split, so the copy is a flat stack rather than a
    // one-sided grid with an empty cell.
    expect(innerChildren()).not.toContain('hero__col');
    expect(innerChildren()).toContain('hero__actions');
    expect(document.body.querySelector('.hero__headline')).not.toBeNull();
  });

  it('`motion: none` marks the section still and drops the scroll cue', () => {
    render({ variant: 'stage', design: { ...CANDLELIT, motion: 'none' } });

    const hero = document.body.querySelector('.hero');
    expect(hero?.classList.contains('hero--still')).toBe(true);
    expect(document.body.querySelector('.hero__cue')).toBeNull();
  });

  it('keeps the atmosphere markup mounted so the `--jp-sec-atmos` gate can zero it', () => {
    // Research §2.3 chose an opacity gate over conditional rendering. That only
    // holds if the markup is unconditional.
    render({ variant: 'stage', design: { ...CANDLELIT, surface: 'bare' } });

    expect(document.body.querySelector('.hero__atmos')).not.toBeNull();
    expect(document.body.querySelector('.hero__glow')).not.toBeNull();
    expect(document.body.querySelectorAll('.hero__mote')).toHaveLength(12);
    expect(document.body.querySelector('.hero__vignette')).not.toBeNull();
  });
});

describe('HeroSection — the read boundary', () => {
  it('reads the three BRIDGED aliases the builder actually writes', () => {
    // `05-bridge-table.md` WT-3. `button` was the confirmed live loss: the golden
    // page stored "Get started" and the served page said "Begin the journey".
    render({
      config: {
        headline: 'A headline',
        sub: 'The stored sub-line',
        button: 'The stored button',
        quiet: 'The stored quiet link',
        secondaryHref: '/somewhere',
      },
    });

    expect(document.body.querySelector('.hero__sub')?.textContent).toContain(
      'The stored sub-line'
    );
    const ctas = [...document.body.querySelectorAll('.cta')].map((c) =>
      c.textContent?.trim()
    );
    expect(ctas).toContain('The stored button');
    expect(ctas).toContain('The stored quiet link');
  });

  it('reads `accent`, `felt` and `bg` — this worktree’s OWED_READS entry', () => {
    render({
      config: {
        headline: 'A headline',
        accent: 'the accent ending',
        sub: 'A sub-line',
        felt: 'the emphasis line',
        bg: 'still',
      },
    });

    expect(document.body.querySelector('.hero__accent')?.textContent).toBe(
      'the accent ending'
    );
    expect(document.body.querySelector('.hero__felt')?.textContent).toBe(
      'the emphasis line'
    );
    expect(
      document.body.querySelector('.hero')?.getAttribute('data-hero-bg')
    ).toBe('still');
  });

  it('defaults `bg` to ember rather than emitting an empty attribute', () => {
    render({ config: { headline: 'A headline' } });

    expect(
      document.body.querySelector('.hero')?.getAttribute('data-hero-bg')
    ).toBe('ember');
  });

  it('falls back to the course’s OWN words, never to invented prose', () => {
    render({
      config: {},
      context: context({
        course: {
          ...context().course,
          title: 'The creator’s title',
          kicker: 'The creator’s kicker',
          lede: 'The creator’s lede',
        },
      }),
    });

    expect(
      document.body.querySelector('.hero__headline')?.textContent
    ).toContain('The creator’s title');
    expect(
      document.body.querySelector('.hero__eyebrow')?.textContent
    ).toContain('The creator’s kicker');
    expect(document.body.querySelector('.hero__sub')?.textContent).toContain(
      'The creator’s lede'
    );
  });
});

describe('HeroSection — the CTA', () => {
  it('sends an anonymous viewer to checkout under a neutral i18n label', () => {
    render({ config: { headline: 'A headline' } });

    const cta = document.body.querySelector('.cta[data-variant="primary"]');
    expect(cta?.getAttribute('href')).toBe(CHECKOUT);
    // The label must no longer be the hardcoded "Begin the journey" — one brand's
    // editorial voice compiled into every org's page (Codex-i9pzs).
    expect(cta?.textContent).not.toContain('Begin the journey');
    expect(cta?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('sends an enrolled viewer to the dashboard under a different label', () => {
    render({
      config: { headline: 'A headline', button: 'Authored label' },
      context: context({ enrolled: true }),
    });

    const cta = document.body.querySelector('.cta[data-variant="primary"]');
    expect(cta?.getAttribute('href')).toBe(DASHBOARD);
    // An enrolled member is not buying, so the authored sales label is NOT used.
    expect(cta?.textContent).not.toContain('Authored label');
  });

  it('omits the secondary CTA unless BOTH a label and an href are authored', () => {
    render({ config: { headline: 'A headline', quiet: 'Label only' } });

    expect(
      document.body.querySelectorAll('.cta[data-variant="secondary"]')
    ).toHaveLength(0);
  });
});

describe('HeroSection — the streamed hero still', () => {
  it('shows the synthetic plate while the sell-preview is pending', () => {
    let resolve!: (value: SellPreview | null) => void;
    const pending = new Promise<SellPreview | null>((r) => {
      resolve = r;
    });

    render({ variant: 'poster', context: context({ sellPreview: pending }) });

    // The plate IS the pending state — same box as the image, so no layout shift.
    expect(document.body.querySelector('.hero__plate')).not.toBeNull();
    expect(document.body.querySelector('.hero__img')).toBeNull();
    resolve(null);
  });

  it('swaps in the creator’s still once it resolves', async () => {
    render({
      variant: 'poster',
      context: context({
        sellPreview: Promise.resolve({
          intro: null,
          reel: null,
          heroImageUrl: 'https://cdn.example/still.jpg',
        }),
      }),
    });
    await tick();
    flushSync();

    const img = document.body.querySelector('.hero__img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/still.jpg');
    // Decorative: the headline carries the meaning, so an empty alt is correct.
    expect(img?.getAttribute('alt')).toBe('');
    expect(document.body.querySelector('.hero__plate')).toBeNull();
  });

  it('keeps the plate when the course has no hero media (the common case)', async () => {
    render({
      variant: 'poster',
      context: context({
        sellPreview: Promise.resolve({
          intro: null,
          reel: null,
          heroImageUrl: null,
        }),
      }),
    });
    await tick();
    flushSync();

    expect(document.body.querySelector('.hero__img')).toBeNull();
    expect(document.body.querySelector('.hero__plate')).not.toBeNull();
  });
});

describe('HeroSection — the edit seam', () => {
  it('renders the headline as REAL TEXT, with no edit attributes, on the public page', () => {
    render({ config: { headline: 'Server rendered words' } });

    const h1 = document.body.querySelector('.hero__headline');
    // The SEO contract of this section. The deleted `render-edit/EditableText.svelte` renders an
    // EMPTY element and fills `textContent` from a Svelte ACTION, and actions do not
    // run during SSR — so using it here would serve `<h1></h1>` and paint the
    // headline in only after hydration.
    expect(h1?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Server rendered words'
    );
    expect(h1?.querySelectorAll('.hero__word')).toHaveLength(3);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
  });

  it('layers contenteditable on the same real text when the canvas asks for it', () => {
    const edits: Array<[string, string]> = [];
    render({
      config: { headline: 'Editable words', eyebrow: 'Kicker' },
      editable: true,
      onEdit: (key, value) => edits.push([key, value]),
    });

    const eyebrow = document.body.querySelector('.hero__eyebrow');
    expect(eyebrow?.getAttribute('contenteditable')).toBe('true');
    expect(eyebrow?.getAttribute('data-field')).toBe('eyebrow');
    // Text is still present — the seam adds attributes, it does not empty the node.
    expect(eyebrow?.textContent?.trim()).toBe('Kicker');

    // The kinetic word split is skipped, so the caret has one text node to sit in.
    expect(document.body.querySelectorAll('.hero__word')).toHaveLength(0);

    const target = document.body.querySelector(
      '.hero__headline [contenteditable]'
    ) as HTMLElement;
    target.textContent = 'Typed in the canvas';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['headline', 'Typed in the canvas']]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA MODES (`Codex-uj4jc`)
//
// Before this, the hero drew media on three of its six compositions and could
// only ever draw a STILL, because the projection reduced `courses.heroMediaId`
// to a poster frame through `toStill` and discarded the manifest. These cases
// pin the two decisions that replaced it: WHAT appears (the `mediaMode` field,
// overruled by the `media` axis) and WHERE it appears (a plate on the three
// layouts that have one, an invitation beside the CTAs on the three that do not).
//
// Playback itself is not asserted here and cannot be: jsdom has no MSE, so
// `createHlsPlayer` could never construct a real player. What IS assertable — and
// what actually regressed historically — is which ELEMENT the component chose.
// ─────────────────────────────────────────────────────────────────────────────

const HERO_CLIP = {
  playlistUrl: 'https://cdn.test/hero/preview.m3u8',
  posterUrl: 'https://cdn.test/hero/poster.jpg',
  durationSeconds: 30,
};

const HERO_STILL = 'https://cdn.test/hero/still.jpg';

function sellPreview(over: Partial<SellPreview> = {}): SellPreview {
  return { intro: null, reel: null, ...over };
}

/**
 * Let both media reads land: the plate's own `{#await}` and the `$effect` that
 * mirrors the same promise into state for the modal / affordance / atmosphere.
 * Two microtask turns, because the mirror resolves a `.then` off the promise the
 * await block is already consuming.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  await tick();
}

describe('HeroSection — media modes', () => {
  it('with no stored mode, a page showing a still today keeps showing it', async () => {
    // The forward-compat case, and the one that matters most: seven live journey
    // pages have no `mediaMode`. Absence is not intent (A33), so it must resolve
    // to today's appearance rather than to a nicer default.
    render({
      variant: 'split-media',
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroImageUrl: HERO_STILL })),
      }),
    });
    await settle();

    expect(document.body.querySelector('.hero__img')?.getAttribute('src')).toBe(
      HERO_STILL
    );
    expect(document.body.querySelector('.hero-loop__video')).toBeNull();
  });

  it('with no stored mode and no still, draws the synthetic plate', async () => {
    render({ variant: 'split-media' });
    await settle();

    expect(document.body.querySelector('.hero__plate')).not.toBeNull();
    expect(document.body.querySelector('.hero__img')).toBeNull();
  });

  it('`loop` renders the silent backdrop rather than the still', async () => {
    render({
      variant: 'full-bleed',
      config: { headline: 'A headline', mediaMode: 'loop' },
      context: context({
        sellPreview: Promise.resolve(
          sellPreview({ heroImageUrl: HERO_STILL, heroClip: HERO_CLIP })
        ),
      }),
    });
    await settle();

    expect(document.body.querySelector('.hero-loop__video')).not.toBeNull();
    expect(document.body.querySelector('.hero__img')).toBeNull();
  });

  it('`loop` degrades to the still when the worker omits `heroClip`', async () => {
    // `heroClip` is OPTIONAL-additive, so an older worker deployment answers with
    // no clip at all. The authored mode must not produce an empty plate: the mode
    // is authored, the clip is a fact, and the fact wins.
    render({
      variant: 'full-bleed',
      config: { headline: 'A headline', mediaMode: 'loop' },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroImageUrl: HERO_STILL })),
      }),
    });
    await settle();

    expect(document.body.querySelector('.hero-loop__video')).toBeNull();
    expect(document.body.querySelector('.hero__img')?.getAttribute('src')).toBe(
      HERO_STILL
    );
  });

  it('`click` puts the invitation ON the plate, over the media', async () => {
    render({
      variant: 'poster',
      config: { headline: 'A headline', mediaMode: 'click' },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroClip: HERO_CLIP })),
      }),
    });
    await settle();

    const play = document.body.querySelector('.hero__play');
    expect(play).not.toBeNull();
    // Inside the media box, not loose in the copy column.
    expect(play?.closest('.hero__media')).not.toBeNull();
    expect(document.body.querySelector('.hero__watch')).toBeNull();
  });

  it('a plate-less composition offers the film beside the CTAs instead', async () => {
    // `stage` has nowhere to put a backdrop, so the author's intent to feature a
    // video becomes an invitation rather than being silently dropped.
    render({
      variant: 'stage',
      config: { headline: 'A headline', mediaMode: 'loop' },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroClip: HERO_CLIP })),
      }),
    });
    await settle();

    const watch = document.body.querySelector('.hero__watch');
    expect(watch).not.toBeNull();
    expect(watch?.closest('.hero__actions')).not.toBeNull();
    expect(document.body.querySelector('.hero__media')).toBeNull();
  });

  it('`mediaLabel` words the invitation, since the hero does not own the clip', async () => {
    render({
      variant: 'stage',
      config: {
        headline: 'A headline',
        mediaMode: 'click',
        mediaLabel: 'See the practice',
      },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroClip: HERO_CLIP })),
      }),
    });
    await settle();

    expect(document.body.querySelector('.hero__watch')?.textContent).toContain(
      'See the practice'
    );
  });

  it('`media: none` overrules any authored mode, plate and invitation alike', async () => {
    // The axis governs treatment, the field governs content, and a content choice
    // must not overturn a design decision. The builder greys the control to say so
    // (`section-editor-controls.svelte.test.ts`); here the renderer must agree.
    render({
      variant: 'full-bleed',
      design: { ...CANDLELIT, media: 'none' },
      config: { headline: 'A headline', mediaMode: 'loop' },
      context: context({
        sellPreview: Promise.resolve(
          sellPreview({ heroImageUrl: HERO_STILL, heroClip: HERO_CLIP })
        ),
      }),
    });
    await settle();

    expect(document.body.querySelector('.hero__media')).toBeNull();
    expect(document.body.querySelector('.hero-loop__video')).toBeNull();
    expect(document.body.querySelector('.hero__watch')).toBeNull();
  });

  it('the atmosphere recedes when media is actually painted', async () => {
    render({
      variant: 'full-bleed',
      config: { headline: 'A headline', mediaMode: 'loop' },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroClip: HERO_CLIP })),
      }),
    });
    await settle();

    expect(
      document.body
        .querySelector('.hero')
        ?.classList.contains('hero--media-present')
    ).toBe(true);
  });

  it('the atmosphere holds when the film is merely OFFERED', async () => {
    // `stage` has no plate, so nothing is painted and the ember is still doing
    // the whole job of carrying the mood. Dimming it here would leave the hero
    // flatter than before the author added a video, which is the opposite of the
    // intent. Split from the case above rather than sharing a mount: two mounts
    // in one `it` needed a manual `unmount(component!)`, and a non-null assertion
    // is a poor trade for a saved test block.
    render({
      variant: 'stage',
      config: { headline: 'A headline', mediaMode: 'click' },
      context: context({
        sellPreview: Promise.resolve(sellPreview({ heroClip: HERO_CLIP })),
      }),
    });
    await settle();

    expect(
      document.body
        .querySelector('.hero')
        ?.classList.contains('hero--media-present')
    ).toBe(false);
  });
});
