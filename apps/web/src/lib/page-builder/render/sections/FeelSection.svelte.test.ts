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
 *  - AND THE TRANSPORT IS NOT A MOCK (`Codex-scab9`). The five assertions in the
 *    player block were written against the mock and PASSED against it: a play
 *    button existed with no clip, a clock counted towards `8:00`, and
 *    `aria-pressed` followed a local boolean. They are rewritten here to assert
 *    the opposite in each case, so the mock cannot come back without going red.
 *
 * WHAT jsdom CANNOT DO, stated so nothing here overclaims: `HTMLMediaElement`
 * neither decodes nor fires its own media events, so `play()`/`pause()` are spies
 * and `play`/`pause`/`timeupdate`/`loadedmetadata` are DISPATCHED by the test. That
 * is exactly the seam under test — the component must take its state from the
 * ELEMENT's events rather than from its own boolean, and a dispatched event is the
 * only way to prove which of the two it does.
 */

import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, PreviewMedia, SellPreview } from '../types';
import FeelSection from './FeelSection.svelte';

/**
 * The manifests handed to `createHlsPlayer`, in order. The factory is the SHARED
 * one (`$lib/components/VideoPlayer/hls`) that `IntroVideoModal` — which
 * `ReelSection` mounts — and `AudioPlayer` already use; this section deliberately
 * does not have a player of its own, so the mock is the proof of the reuse.
 */
const hlsSources: string[] = [];
const cleanupSpy = vi.fn();
const playSpy = vi.fn();
const pauseSpy = vi.fn();

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    hlsSources.push(src);
    return { hls: null, cleanup: cleanupSpy };
  }),
}));

/** A resolved 30s public preview — what `sellPreview.reel` actually looks like. */
const REEL_CLIP: PreviewMedia = {
  playlistUrl: 'https://cdn.example.test/creator/hls/m1/preview/preview.m3u8',
  durationSeconds: 30,
};
const WITH_CLIP: SellPreview = { intro: null, reel: REEL_CLIP };
const NO_CLIP: SellPreview = { intro: null, reel: null };

/** Force the reduced-motion branch, with a listener surface `onMount` can use. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

const media = () =>
  document.body.querySelector('video.feel-taste__media') as HTMLVideoElement;

/** Fire a media event the element itself would fire in a real browser. */
function fireMedia(name: string, patch?: Record<string, number>) {
  const el = media();
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      Object.defineProperty(el, key, {
        value,
        writable: true,
        configurable: true,
      });
    }
  }
  el.dispatchEvent(new Event(name));
  flushSync();
}

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
  sellPreview: Promise<SellPreview | null> = Promise.resolve(null)
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
    sellPreview,
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

/**
 * The author's switch, with NO `previewDuration`. That absence is the point: it is
 * the default state of the field (contract A29 — the `number` control has no
 * editor UI), and it is the state that used to publish a clock counting towards
 * `8:00`.
 */
const WITH_PLAYER: SectionProps = {
  ...FLAT,
  previewTitle: 'Naming what is here',
  previewSub: 'Practice one',
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
  sellPreview?: Promise<SellPreview | null>;
}) {
  component = mount(FeelSection, {
    target: document.body,
    props: {
      config: props.config ?? FLAT,
      context: context(props.sellPreview),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

/** Mount with a resolved clip and settle the `{#await}` before asserting. */
async function renderWithClip(
  props: Parameters<typeof render>[0] = {}
): Promise<void> {
  render({ ...props, sellPreview: Promise.resolve(WITH_CLIP) });
  await tick();
  flushSync();
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

beforeEach(() => {
  hlsSources.length = 0;
  cleanupSpy.mockClear();
  playSpy.mockClear();
  pauseSpy.mockClear();
  stubReducedMotion(false);
  // jsdom's HTMLMediaElement throws "Not implemented" on play/pause/load.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {
    playSpy();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    pauseSpy();
  });
});

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

describe('FeelSection — the free taste needs BOTH the switch and the clip', () => {
  it('renders no player without previewTitle, which is the author`s switch', async () => {
    await renderWithClip({ config: FLAT });
    expect(document.body.querySelector('.feel-taste')).toBeNull();
  });

  it('renders no player with the switch on and NO clip', async () => {
    // THIS IS THE MOCK'S OWN TEST, INVERTED. It used to assert a labelled play
    // button here, against `sellPreview` resolving to null — a control with
    // nothing behind it, which is precisely the defect (`Codex-scab9`).
    render({ config: WITH_PLAYER, sellPreview: Promise.resolve(NO_CLIP) });
    await tick();
    flushSync();
    expect(document.body.querySelector('.feel-taste')).toBeNull();
    expect(document.body.querySelector('button.feel-play')).toBeNull();
    // The COPY is untouched — the clip gates the transport, never the words.
    expect(heading()?.textContent?.trim()).toBe('How it feels.');
  });

  it('renders no player when the preview read itself failed', async () => {
    render({ config: WITH_PLAYER, sellPreview: Promise.resolve(null) });
    await tick();
    flushSync();
    expect(document.body.querySelector('.feel-taste')).toBeNull();
    expect(heading()).not.toBeNull();
  });

  it('hides the whole section when the player is its only subject and there is no clip', async () => {
    render({
      config: { previewTitle: 'Naming what is here' },
      sellPreview: Promise.resolve(NO_CLIP),
    });
    await tick();
    flushSync();
    // Before: `hasContent` counted `previewTitle`, so this published a bordered
    // card with an aura and a fake transport for a course with no clip at all.
    expect(root()).toBeNull();
  });

  it('keeps the section when the player is its only subject and a clip resolves', async () => {
    await renderWithClip({ config: { previewTitle: 'Naming what is here' } });
    expect(root()).not.toBeNull();
    expect(document.body.querySelector('.feel-taste')).not.toBeNull();
  });
});

describe('FeelSection — the free taste plays the real clip (Codex-scab9)', () => {
  it('mounts a real media element and a labelled transport', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    expect(media()).not.toBeNull();
    // Nothing is fetched before the visitor asks.
    expect(media().getAttribute('preload')).toBe('none');
    expect(hlsSources).toEqual([]);

    const play = document.body.querySelector('button.feel-play');
    expect(play?.getAttribute('aria-label')).toBe('Play preview');
    expect(play?.getAttribute('aria-pressed')).toBe('false');

    const mute = document.body.querySelector('button.feel-mute');
    expect(mute?.getAttribute('aria-label')).toBe('Mute preview');
    expect(mute?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the hidden clip out of the accessibility tree and the tab order', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    expect(media().getAttribute('aria-hidden')).toBe('true');
    expect(media().getAttribute('tabindex')).toBe('-1');
  });

  it('hands the reel`s playlistUrl to the SHARED hls factory on click', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    (
      document.body.querySelector('button.feel-play') as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(hlsSources).toHaveLength(1));
    expect(hlsSources[0]).toBe(REEL_CLIP.playlistUrl);
    // WAIT for `play()` rather than assuming it is synchronous with the source
    // landing: the handle attaches the manifest and only then plays, so asserting
    // straight after `hlsSources` fills is a race. The sibling case below already
    // awaits `playSpy` the same way. This waits on the real signal — it does not
    // weaken the assertion.
    await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('does not rebuild the player on a second play of the same clip', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    const play = document.body.querySelector(
      'button.feel-play'
    ) as HTMLButtonElement;
    play.click();
    await vi.waitFor(() => expect(hlsSources).toHaveLength(1));
    fireMedia('play');
    play.click();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    fireMedia('pause');
    play.click();
    await vi.waitFor(() => expect(playSpy).toHaveBeenCalledTimes(2));
    expect(hlsSources).toHaveLength(1);
  });

  it('takes its pressed state from the ELEMENT, not from a local boolean', async () => {
    // The mock flipped `playing` inside `togglePlay`, so `aria-pressed` went true
    // whether or not anything played — and under reduced motion nothing ever did.
    await renderWithClip({ config: WITH_PLAYER });
    const play = () => document.body.querySelector('button.feel-play');
    expect(play()?.getAttribute('aria-pressed')).toBe('false');
    fireMedia('play');
    expect(play()?.getAttribute('aria-pressed')).toBe('true');
    expect(play()?.getAttribute('aria-label')).toBe('Pause preview');
    fireMedia('pause');
    expect(play()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('drives the clock and the waveform fill from timeupdate', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    expect(document.body.querySelector('.feel-cur')?.textContent?.trim()).toBe(
      '0:00'
    );
    expect(document.body.querySelectorAll('.feel-wave i.is-on')).toHaveLength(
      0
    );

    fireMedia('timeupdate', { currentTime: 15 });

    expect(document.body.querySelector('.feel-cur')?.textContent?.trim()).toBe(
      '0:15'
    );
    // Half of a 30s clip ⇒ half the 56 bars lit. Nothing here advances on a timer.
    expect(document.body.querySelectorAll('.feel-wave i.is-on')).toHaveLength(
      28
    );
  });

  it('lets the element`s own duration outrank every advisory figure', async () => {
    await renderWithClip({ config: { ...WITH_PLAYER, previewDuration: 540 } });
    fireMedia('loadedmetadata', { duration: 27 });
    expect(
      document.body.querySelector('.feel-taste__time')?.textContent
    ).toContain('0:27');
  });

  it('resets to the start when the clip ends', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    fireMedia('play');
    fireMedia('timeupdate', { currentTime: 20 });
    fireMedia('ended');
    expect(
      document.body
        .querySelector('button.feel-play')
        ?.getAttribute('aria-pressed')
    ).toBe('false');
    expect(document.body.querySelector('.feel-cur')?.textContent?.trim()).toBe(
      '0:00'
    );
  });

  it('mutes and unmutes the real element', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    const mute = document.body.querySelector(
      'button.feel-mute'
    ) as HTMLButtonElement;
    mute.click();
    flushSync();
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.getAttribute('aria-label')).toBe('Unmute preview');
    expect(media().muted).toBe(true);
    mute.click();
    flushSync();
    expect(media().muted).toBe(false);
  });
});

describe('FeelSection — the clock counts towards a real number', () => {
  it('takes the total from the clip rather than an invented 8:00', async () => {
    // The mock hard-defaulted `previewDuration` to 480 whenever the field was
    // unset, which is its default state — so "0:00 / 8:00" was what every page
    // published, over a thirty-second clip.
    await renderWithClip({ config: WITH_PLAYER });
    const time = document.body.querySelector('.feel-taste__time')?.textContent;
    expect(time).toContain('0:30');
    expect(time).not.toContain('8:00');
  });

  it('caps the clip`s advisory duration at the 30s the preview actually is', async () => {
    // `packages/access` `toClip()` reports the SOURCE asset's runtime on a fixed
    // 30s preview rendition, so a 30-minute intro arrives as 1800.
    render({
      config: WITH_PLAYER,
      sellPreview: Promise.resolve({
        intro: null,
        reel: { ...REEL_CLIP, durationSeconds: 1800 },
      }),
    });
    await tick();
    flushSync();
    const time = document.body.querySelector('.feel-taste__time')?.textContent;
    expect(time).toContain('0:30');
    expect(time).not.toContain('30:00');
  });

  it('prefers an authored previewDuration over the clip`s advisory figure', async () => {
    await renderWithClip({ config: { ...WITH_PLAYER, previewDuration: 12 } });
    expect(
      document.body.querySelector('.feel-taste__time')?.textContent
    ).toContain('0:12');
  });

  it('ignores a non-numeric previewDuration rather than trusting it', async () => {
    // The `number` control has no editor UI (contract A29) and the text
    // fallthrough writes a string. It now falls to the CLIP, not to 480.
    await renderWithClip({
      config: { ...WITH_PLAYER, previewDuration: '999' },
    });
    const time = document.body.querySelector('.feel-taste__time')?.textContent;
    expect(time).toContain('0:30');
    expect(time).not.toContain('16:39');
  });

  it('prints no total at all when nothing knows one', async () => {
    render({
      config: WITH_PLAYER,
      sellPreview: Promise.resolve({
        intro: null,
        reel: { playlistUrl: REEL_CLIP.playlistUrl, durationSeconds: null },
      }),
    });
    await tick();
    flushSync();
    const time = document.body.querySelector('.feel-taste__time');
    expect(time?.textContent?.trim()).toBe('0:00');
    expect(time?.querySelector('.feel-sep')).toBeNull();
  });
});

describe('FeelSection — the waveform, and what it is honest about', () => {
  it('draws every bar server-side, deterministically', async () => {
    await renderWithClip({ config: WITH_PLAYER });
    expect(document.body.querySelectorAll('.feel-wave i')).toHaveLength(56);
  });

  it('is decoration, with no click handler pretending otherwise', async () => {
    // It used to be an aria-hidden, role="presentation" <div> carrying onclick —
    // a seek control with no keyboard path and no name. It stays decoration now
    // that playback is real: a synthetic envelope is not this clip's amplitude.
    await renderWithClip({ config: WITH_PLAYER });
    const wave = document.body.querySelector('.feel-wave') as HTMLElement;
    expect(wave.getAttribute('aria-hidden')).toBe('true');
    expect(wave.getAttribute('role')).toBeNull();
    expect(wave.onclick).toBeNull();
  });

  it('uses icon components rather than inline svg paths', async () => {
    // Contract A8: no inline `<svg>` in a section; icons come from
    // `Icon/*Icon.svelte` via `IconBase`, which sets `aria-hidden` itself.
    await renderWithClip({ config: WITH_PLAYER });
    for (const cls of ['.feel-play__glyph', '.feel-mute__glyph']) {
      const glyph = document.body.querySelector(cls);
      expect(glyph, cls).not.toBeNull();
      expect(glyph?.getAttribute('aria-hidden'), cls).toBe('true');
    }
  });
});

describe('FeelSection — reduced motion no longer kills the control', () => {
  it('still plays, and the clock still moves', async () => {
    // THE SECOND HALF OF `Codex-scab9`. The rAF ticker bailed on `!enhanced`, and
    // `enhanced` is false under `prefers-reduced-motion: reduce` — so the click
    // flipped the button to "Pause"/`aria-pressed=true` and the clock never moved
    // at all. `enhanced` now gates ANIMATION only, never state.
    stubReducedMotion(true);
    await renderWithClip({ config: WITH_PLAYER });

    const play = document.body.querySelector(
      'button.feel-play'
    ) as HTMLButtonElement;
    expect(play).not.toBeNull();
    play.click();
    await vi.waitFor(() => expect(hlsSources).toHaveLength(1));
    // WAIT for `play()` rather than assuming it is synchronous with the source
    // landing: the handle attaches the manifest and only then plays, so asserting
    // straight after `hlsSources` fills is a race. The sibling case below already
    // awaits `playSpy` the same way. This waits on the real signal — it does not
    // weaken the assertion.
    await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());

    fireMedia('play');
    expect(play.getAttribute('aria-pressed')).toBe('true');
    fireMedia('timeupdate', { currentTime: 9 });
    expect(document.body.querySelector('.feel-cur')?.textContent?.trim()).toBe(
      '0:09'
    );
    // The equaliser animation IS suppressed — that part was always correct.
    expect(
      document.body
        .querySelector('.feel-wave')
        ?.classList.contains('is-playing')
    ).toBe(false);
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
