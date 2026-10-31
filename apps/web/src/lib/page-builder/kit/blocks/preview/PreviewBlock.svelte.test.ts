import { tick } from 'svelte';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { loadPlayerCore } from '$lib/components/player/load-core';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type {
  JourneySalesContext,
  PreviewMedia,
  SellPreview,
} from '../../../render/types';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext, samplePage } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import PageRenderer from '../../PageRenderer.svelte';
import type { PageEdit } from '../../page-context';
import { FILM_COPY } from '../../primitives/film-copy';
import { PREVIEW_COPY } from './copy';
import { PREVIEW_PROMPT } from './definition';
import PreviewBlock from './PreviewBlock.svelte';

const played: string[] = [];

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    played.push(src);
    return { hls: null, cleanup: () => {} };
  }),
}));

const REEL: PreviewMedia = {
  playlistUrl: '/media/reel/preview.m3u8',
  posterUrl: '/media/reel/poster.jpg',
};

let app: ReturnType<typeof mount> | null = null;

// The player's code is fetched before any press, as the page's first sight
// of a play button fetches it (`preloadPlayer`).
beforeAll(async () => {
  await loadPlayerCore();
});

beforeEach(() => {
  played.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    reel?: PreviewMedia | null;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'preview-1',
    anchor: 'preview',
    type: 'preview',
    index: 6,
    layout: options.layout ?? 'feature',
    scheme: 'contrast',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(PreviewBlock, {
    target: document.body,
    props: {
      props,
      section,
      context:
        options.context ??
        sampleContext({
          media: { reel: options.reel === undefined ? REEL : options.reel },
        }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
}

const text = () => document.body.textContent ?? '';
const play = () =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === PREVIEW_COPY.watch
  );
const SAMPLE = {
  heading: 'Try the first practice',
  body: 'Thirty seconds from week one.',
  caption: 'From week one, “Arriving”.',
};

describe('PreviewBlock', () => {
  it.each(
    SECTION_LAYOUTS.preview
  )('%s: the clip, its caption and the words', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain(SAMPLE.body);
    // The caption is the line's (Codex-61zsk.73): this clip names no kind,
    // as an older payload's does not, so the line is the caption alone.
    expect(document.body.querySelector('.preview__line')?.textContent).toBe(
      SAMPLE.caption
    );
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      REEL.posterUrl
    );
    expect(play()).toBeDefined();
  });

  it('shows the clip before the words in the feature layout', async () => {
    await render(SAMPLE, { layout: 'feature' });
    const figure = document.body.querySelector('figure');
    const heading = document.body.querySelector('h2');
    expect(
      figure!.compareDocumentPosition(heading!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('takes its heading level from the section', async () => {
    await render(SAMPLE, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(SAMPLE.heading);
  });

  it('plays exactly the reel, never the intro film', async () => {
    const context = sampleContext({
      media: {
        reel: REEL,
        intro: { playlistUrl: '/media/intro/preview.m3u8' },
      },
    });
    await render(SAMPLE, { context });
    play()?.click();
    flushSync();
    await tick();
    await Promise.resolve();
    expect(played).toEqual([REEL.playlistUrl]);
  });

  it.each(
    SECTION_LAYOUTS.preview
  )('%s: plays in its own frame, which keeps its shape', async (layout) => {
    await render(SAMPLE, { layout });
    const frame = document.body.querySelector('.preview__clip .clip');
    play()?.click();
    // The player lies over the picture, beside it rather than inside it, so
    // a Style's mask on the picture never reaches the controls.
    expect(frame?.querySelector(':scope > .lp-film video')).not.toBeNull();
    expect(frame?.querySelector('.lp-media .lp-film')).toBeNull();
    expect(frame?.querySelector(':scope > .lp-media')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps a plate and a play button for a clip with no poster', async () => {
    await render(SAMPLE, { reel: { playlistUrl: REEL.playlistUrl } });
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.querySelector('.lp-media')).not.toBeNull();
    expect(play()).toBeDefined();
  });

  // Codex-61zsk.37 (C1): the public page kept the words, so a visitor read
  // "Try the first practice" above nothing.
  it.each(
    SECTION_LAYOUTS.preview
  )('%s: with no clip the public page draws no section at all', async (layout) => {
    await render(SAMPLE, { layout, reel: null });
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text().trim()).toBe('');
    expect(document.body.querySelector('.lp-media')).toBeNull();
    // The band is told to fold away (by the rule the parity test checks).
    expect(document.body.querySelector('.preview-none')).not.toBeNull();
  });

  it('holds the frame while the clip is on its way, as the server sends it, and folds away once there is none', async () => {
    let settle: (value: SellPreview | null) => void = () => {};
    const context = {
      ...sampleContext(),
      sellPreview: new Promise<SellPreview | null>((resolve) => {
        settle = resolve;
      }),
    };
    await render(SAMPLE, { context });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(
      document.body.querySelector('.lp-media[data-pending]')
    ).not.toBeNull();
    expect(document.body.querySelector('.preview-none')).toBeNull();
    settle({ intro: null, reel: null });
    await tick();
    await Promise.resolve();
    flushSync();
    expect(document.body.querySelector('h2')).toBeNull();
    expect(document.body.querySelector('.preview-none')).not.toBeNull();
  });

  // Codex-61zsk.40: the awaited course view says whether a clip can come.
  // With none, the band folds from the first paint instead of drawing whole
  // and then vanishing once the stream settles.
  describe('with the awaited view saying which clip can come', () => {
    const awaiting = (
      attached: boolean
    ): {
      context: JourneySalesContext;
      settle: (value: SellPreview | null) => void;
    } => {
      let settle: (value: SellPreview | null) => void = () => {};
      const context = {
        ...sampleContext({
          course: {
            filmsAttached: { hero: false, intro: true, reel: attached },
          },
        }),
        sellPreview: new Promise<SellPreview | null>((resolve) => {
          settle = resolve;
        }),
      };
      return { context, settle };
    };

    it.each(
      SECTION_LAYOUTS.preview
    )('%s: with no clip attached the public page folds from the first paint', async (layout) => {
      await render(SAMPLE, { layout, context: awaiting(false).context });
      expect(document.body.querySelector('h2')).toBeNull();
      expect(document.body.querySelector('.lp-media')).toBeNull();
      expect(document.body.querySelector('.preview-none')).not.toBeNull();
    });

    it('with one attached, holds its place while it is on its way', async () => {
      await render(SAMPLE, { context: awaiting(true).context });
      expect(document.body.querySelector('h2')?.textContent).toBe(
        SAMPLE.heading
      );
      expect(
        document.body.querySelector('.lp-media[data-pending]')
      ).not.toBeNull();
      expect(document.body.querySelector('.preview-none')).toBeNull();
    });

    it('a clip that arrives although none was attached still shows', async () => {
      const { context, settle } = awaiting(false);
      await render(SAMPLE, { context });
      settle({ reel: REEL, intro: null });
      await tick();
      await Promise.resolve();
      flushSync();
      expect(document.body.querySelector('h2')?.textContent).toBe(
        SAMPLE.heading
      );
      expect(document.body.querySelector('.preview-none')).toBeNull();
    });

    it('with none attached the canvas still keeps the words and the plate', async () => {
      await render(SAMPLE, {
        context: awaiting(false).context,
        edit: { commit: () => {} },
      });
      expect(document.body.querySelector('h2')?.textContent).toBe(
        SAMPLE.heading
      );
      expect(document.body.querySelector('.lp-media')).not.toBeNull();
    });
  });

  it.each(
    SECTION_LAYOUTS.preview
  )('%s: the canvas keeps the words and the plate, and asks for the clip', async (layout) => {
    await render(SAMPLE, { layout, reel: null, edit: { commit: () => {} } });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(document.body.querySelector('.lp-media__plate')).not.toBeNull();
    expect(text()).toContain(PREVIEW_PROMPT);
    expect(play()).toBeUndefined();
  });

  it('draws the section once the clip is there, with nothing to fold it away', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('.preview-none')).toBeNull();
    expect(document.body.querySelector('[data-lp-edit-only]')).toBeNull();
  });

  it('never plays on the canvas', async () => {
    await render(SAMPLE, { edit: { commit: () => {} } });
    play()?.click();
    flushSync();
    await tick();
    expect(played).toEqual([]);
  });

  it('adds a way to join only when the creator writes one', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({ ...SAMPLE, ctaLabel: 'Try it' });
    expect(document.body.querySelector('a')?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render(SAMPLE, {
      edit: { commit: () => {} },
      reel: { ...REEL, mediaType: 'video', previewSeconds: 30 },
    });
    // On the caption alone, never the whole line: an edit there would take
    // "A 30-second watch" into the caption (Codex-61zsk.73).
    const caption = document.body.querySelector(
      '[aria-label="Sneak peek — Caption"]'
    );
    expect(caption?.textContent).toBe(SAMPLE.caption);
    expect(caption?.getAttribute('contenteditable')).toBe('true');
    expect(caption?.closest('.preview__line')?.textContent).toBe(
      `A 30-second watch · ${SAMPLE.caption}`
    );
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
  });

  describe('its line: what it is and how long a press plays (Codex-61zsk.73)', () => {
    const VIDEO: PreviewMedia = {
      ...REEL,
      mediaType: 'video',
      durationSeconds: 124,
      previewSeconds: 30,
    };
    const line = () =>
      document.body.querySelector('.preview__line')?.textContent ?? null;

    it('feature: under the frame, the kind and length, then the caption', async () => {
      await render(SAMPLE, { reel: VIDEO });
      const caption = document.body.querySelector('figcaption');
      expect(caption?.textContent).toBe(
        `A 30-second watch · ${SAMPLE.caption}`
      );
      expect(caption?.closest('.preview__clip')).not.toBeNull();
    });

    it('split: under the words, above the buttons, and none under the frame', async () => {
      await render(
        { ...SAMPLE, ctaLabel: 'Try it' },
        { layout: 'split', reel: VIDEO }
      );
      const words = document.body.querySelector('.preview-split__words');
      const under = words?.querySelector('.preview__line');
      expect(under?.textContent).toBe(`A 30-second watch · ${SAMPLE.caption}`);
      const actions = words?.querySelector('.preview__actions');
      expect(
        under &&
          actions &&
          under.compareDocumentPosition(actions) &
            Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(document.body.querySelector('figcaption')).toBeNull();
    });

    it('with no caption, the kind and length alone', async () => {
      await render({ heading: SAMPLE.heading }, { reel: VIDEO });
      expect(line()).toBe('A 30-second watch');
    });

    it('a short one when its length is not known', async () => {
      await render(SAMPLE, { reel: { ...VIDEO, previewSeconds: null } });
      expect(line()).toBe(`A short watch · ${SAMPLE.caption}`);
    });

    it("the preview's length where the page cannot ask for the full film", async () => {
      // On its own the block has no `requestFilm`, so a press plays the cut.
      await render(SAMPLE, { reel: { ...VIDEO, fullFilm: true } });
      expect(line()).toBe(`A 30-second watch · ${SAMPLE.caption}`);
      expect(play()).toBeDefined();
    });

    // The button says what a press plays, as the line does: the whole film,
    // on the page that can ask for it and on the canvas alike.
    it.each([
      ['the page', null],
      ['the canvas', { commit: () => {} }],
    ] as [
      string,
      PageEdit | null,
    ][])('on %s, a clip that plays in full says "Watch the film", never the preview', async (_, edit) => {
      app = mount(PageRenderer, {
        target: document.body,
        props: {
          page: samplePage('clean', ['preview']),
          context: sampleContext({
            media: { reel: { ...VIDEO, fullFilm: true } },
          }),
          edit,
          requestFilm: vi.fn(async () => null),
        },
      });
      flushSync();
      await tick();
      await Promise.resolve();
      flushSync();
      expect(line()).toContain('A 2-minute watch');
      const labels = [...document.body.querySelectorAll('button')].map(
        (button) => button.textContent?.trim()
      );
      expect(labels).toContain(FILM_COPY.watch);
      expect(labels).not.toContain(PREVIEW_COPY.watch);
    });
  });

  describe('an audio clip: the listening card (Codex-61zsk.73)', () => {
    const AUDIO: PreviewMedia = {
      playlistUrl: '/media/reel-audio/preview.m3u8',
      posterUrl: null,
      mediaType: 'audio',
      durationSeconds: 300,
      previewSeconds: 30,
    };
    const card = () => document.body.querySelector<HTMLElement>('.listen');
    const button = () =>
      card()?.querySelector<HTMLButtonElement>('.listen__play');
    const time = () => card()?.querySelector('.listen__time')?.textContent;
    const audio = () => card()?.querySelector('video');
    /** How full the strip is: set on the fill alone, so a tick restyles nothing else. */
    const strip = () =>
      card()
        ?.querySelector<HTMLElement>('.listen__fill')
        ?.style.getPropertyValue('--_played');

    async function press() {
      button()?.click();
      flushSync();
      await tick();
      await Promise.resolve();
      flushSync();
    }

    /** The stream reports where it is, as the element's own events do. */
    function at(element: HTMLVideoElement, seconds: number, length: number) {
      Object.defineProperty(element, 'duration', {
        configurable: true,
        get: () => length,
      });
      element.dispatchEvent(new Event('durationchange'));
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: () => seconds,
      });
      element.dispatchEvent(new Event('timeupdate'));
      flushSync();
    }

    it.each(
      SECTION_LAYOUTS.preview
    )('%s: a card on the panel, not an empty dark frame, holding the line', async (layout) => {
      await render(SAMPLE, { layout, reel: AUDIO });
      expect(card()).not.toBeNull();
      expect(document.body.querySelector('.clip')).toBeNull();
      expect(document.body.querySelector('figcaption')).toBeNull();
      expect(card()?.querySelector('.listen__line')?.textContent).toBe(
        `A 30-second listen · ${SAMPLE.caption}`
      );
      // Before the press: the length, an empty strip, a labelled play button.
      expect(time()).toBe('0:30');
      expect(strip()).toBe('0');
      expect(card()?.style.getPropertyValue('--_played')).toBe('');
      expect(button()?.getAttribute('aria-label')).toBe(PREVIEW_COPY.watch);
      expect(audio()).toBeNull();
    });

    it('a press plays the reel through the shared player, its picture unseen', async () => {
      await render(SAMPLE, { reel: AUDIO });
      await press();
      // Mounted in the press's own tick, so its play() keeps the sound.
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
      expect(played).toEqual([AUDIO.playlistUrl]);
      const player = card()?.querySelector('.listen__player');
      expect(player?.getAttribute('aria-hidden')).toBe('true');
      expect(player?.querySelector('video')).not.toBeNull();
      // The card's own button, not the player's: it kept the focus it had.
      expect(card()?.querySelector('.player__bar')).toBeNull();
    });

    it('playing, it offers pause, the strip fills and the time counts', async () => {
      await render(SAMPLE, { reel: AUDIO });
      await press();
      const element = audio();
      if (!element) throw new Error('no player');
      // Its first sound: until then the time says it is loading.
      expect(time()).toBe(PREVIEW_COPY.loading);
      for (const name of ['loadeddata', 'play', 'playing'])
        element.dispatchEvent(new Event(name));
      at(element, 6, 30);
      expect(button()?.getAttribute('aria-label')).toBe(PREVIEW_COPY.pause);
      expect(time()).toBe('0:06 / 0:30');
      expect(Number(strip())).toBeCloseTo(0.2);

      // A press now pauses it, as the player's own button would.
      Object.defineProperty(element, 'paused', {
        configurable: true,
        get: () => false,
      });
      const pause = vi
        .spyOn(HTMLMediaElement.prototype, 'pause')
        .mockImplementation(() => {});
      await press();
      expect(pause.mock.contexts).toEqual([element]);
    });

    it('once it ends the player stays at its end and the button replays it in place', async () => {
      await render(SAMPLE, { reel: AUDIO });
      await press();
      const element = audio();
      if (!element) throw new Error('no player');
      at(element, 30, 30);
      element.dispatchEvent(new Event('ended'));
      flushSync();
      expect(audio()).toBe(element);
      expect(button()?.getAttribute('aria-label')).toBe(PREVIEW_COPY.again);
      expect(time()).toBe('0:30 / 0:30');
      expect(Number(strip())).toBe(1);

      // The replay seeks the same element to the start: no second stream.
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        writable: true,
        value: 30,
      });
      vi.mocked(HTMLMediaElement.prototype.play).mockClear();
      await press();
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
      expect(element.currentTime).toBe(0);
      expect(played).toEqual([AUDIO.playlistUrl]);
      expect(button()?.getAttribute('aria-label')).not.toBe(PREVIEW_COPY.again);
    });

    it('with its sound refused, the button asks for it and a press takes it', async () => {
      vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
        Object.assign(new Error('refused'), { name: 'NotAllowedError' })
      );
      await render(SAMPLE, { reel: AUDIO });
      await press();
      for (let i = 0; i < 4; i++) await Promise.resolve();
      flushSync();
      const element = audio();
      if (!element) throw new Error('no player');
      expect(element.muted).toBe(true);
      expect(button()?.getAttribute('aria-label')).toBe(PREVIEW_COPY.sound);
      await press();
      expect(element.muted).toBe(false);
    });

    it('sets the course still at its leading edge: the clip poster, else the hero', async () => {
      await render(SAMPLE, {
        reel: { ...AUDIO, posterUrl: '/media/reel-audio/poster.jpg' },
      });
      expect(card()?.querySelector('.listen__still')?.getAttribute('src')).toBe(
        '/media/reel-audio/poster.jpg'
      );
      unmount(app);
      await render(SAMPLE, {
        context: sampleContext({
          media: { reel: AUDIO, heroImageUrl: '/media/hero.jpg' },
        }),
      });
      expect(card()?.querySelector('.listen__still')?.getAttribute('src')).toBe(
        '/media/hero.jpg'
      );
      unmount(app);
      await render(SAMPLE, { reel: AUDIO });
      expect(card()?.querySelector('.listen__still')).toBeNull();
    });

    it('draws the still from the file its small square needs, poster or hero alike', async () => {
      const POSTER = 'https://cdn.example/c1/media-thumbnails/m1/lg.webp';
      const HERO = 'https://cdn.example/c1/courses/k1/hero/lg.webp';
      const still = () =>
        card()?.querySelector<HTMLImageElement>('.listen__still');
      for (const [media, dir] of [
        [
          { reel: { ...AUDIO, posterUrl: POSTER } },
          'https://cdn.example/c1/media-thumbnails/m1',
        ],
        [
          { reel: AUDIO, heroImageUrl: HERO },
          'https://cdn.example/c1/courses/k1/hero',
        ],
      ] as const) {
        await render(SAMPLE, { context: sampleContext({ media }) });
        expect(still()?.getAttribute('src')).toBe(`${dir}/md.webp`);
        expect(still()?.getAttribute('srcset')).toBe(
          `${dir}/sm.webp 200w, ${dir}/md.webp 400w, ${dir}/lg.webp 800w`
        );
        // A 16:9 still cropped to a square, 4rem on a phone, 10rem wider.
        expect(still()?.getAttribute('sizes')).toBe(
          '(min-width: 40rem) calc(10rem * 1.78), calc(4rem * 1.78)'
        );
        unmount(app);
      }
      // An address with no sized files is drawn as it is.
      await render(SAMPLE, {
        reel: { ...AUDIO, posterUrl: '/media/reel-audio/poster.jpg' },
      });
      expect(still()?.hasAttribute('srcset')).toBe(false);
      expect(still()?.hasAttribute('sizes')).toBe(false);
    });

    it('never plays on the canvas', async () => {
      await render(SAMPLE, { reel: AUDIO, edit: { commit: () => {} } });
      await press();
      expect(played).toEqual([]);
      expect(audio()).toBeNull();
    });

    it('a video clip keeps its frame', async () => {
      await render(SAMPLE, { reel: { ...REEL, mediaType: 'video' } });
      expect(card()).toBeNull();
      expect(
        document.body.querySelector('.preview__clip .clip')
      ).not.toBeNull();
    });
  });
});
