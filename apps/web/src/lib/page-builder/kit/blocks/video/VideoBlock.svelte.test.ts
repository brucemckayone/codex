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
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS, type SectionTypeId } from '../../model/ids';
import {
  type SampleOfferState,
  sampleContext,
  samplePage,
} from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import PageRenderer from '../../PageRenderer.svelte';
import type { PageEdit } from '../../page-context';
import { FILM_COPY } from '../../primitives/film-copy';
import { instructorDefinition } from '../instructor/definition';
import { VIDEO_PROMPT, videoDefinition } from './definition';
import VideoBlock from './VideoBlock.svelte';

/** The manifests the shared player was asked to stream, in order. */
const played: string[] = [];

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    played.push(src);
    return { hls: null, cleanup: () => {} };
  }),
}));

// A 30-second public preview of a 30-minute film: the upstream duration is
// the SOURCE's runtime, so no badge may be drawn from it.
const INTRO: PreviewMedia = {
  playlistUrl: '/media/intro/preview.m3u8',
  posterUrl: '/media/intro/poster.jpg',
  durationSeconds: 1800,
};

let app: ReturnType<typeof mount> | null = null;

// The player's code is fetched before any press, as the page's first sight
// of a play button fetches it (`preloadPlayer`): a press then mounts it in
// its own tick. `InlineFilm.first-press.svelte.test.ts` covers a press that
// beats it.
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

function section(layout: string, headingLevel: 1 | 2 = 2): ResolvedSection {
  return {
    id: 'video-1',
    anchor: 'video',
    type: 'video',
    index: 1,
    layout,
    scheme: 'base',
    spacing: 'regular',
    headingLevel,
  };
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    intro?: PreviewMedia | null;
    offer?: SampleOfferState;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  app = mount(VideoBlock, {
    target: document.body,
    props: {
      props,
      section: section(options.layout ?? 'theatre', options.headingLevel),
      context:
        options.context ??
        sampleContext({
          offer: options.offer ?? 'buy',
          media: { intro: options.intro === undefined ? INTRO : options.intro },
        }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  // Let the streamed sell-preview resolve.
  await tick();
  await Promise.resolve();
  flushSync();
}

const text = () => document.body.textContent ?? '';
/** A press on a block mounted on its own (no `requestFilm`) plays the preview. */
const watch = () =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === FILM_COPY.preview
  );
const labels = () =>
  [...document.body.querySelectorAll('button')].map((button) =>
    button.textContent?.trim()
  );
const SAMPLE = {
  heading: 'Two minutes, from me to you',
  body: 'How the six weeks are built.',
  caption: 'Filmed on the first morning.',
};

describe('VideoBlock', () => {
  it.each(
    SECTION_LAYOUTS.video
  )('%s: the words, the poster, the caption and a way to watch', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain(SAMPLE.body);
    expect(document.body.querySelector('figcaption')?.textContent).toBe(
      SAMPLE.caption
    );
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      INTRO.posterUrl
    );
    expect(watch()).toBeDefined();
  });

  it('takes its heading level from the section', async () => {
    await render(SAMPLE, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(SAMPLE.heading);
  });

  it('never draws a duration from the source runtime', async () => {
    await render(SAMPLE);
    expect(text()).not.toMatch(/\d+:\d\d|30 min|minutes long/);
  });

  it.each(
    SECTION_LAYOUTS.video
  )('%s: plays exactly the intro clip in its own screen, not a pop-up', async (layout) => {
    await render(SAMPLE, { layout });
    watch()?.click();
    // Mounted in the press's own tick, so its play() keeps the sound.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    const screen = document.body.querySelector('.video__screen');
    expect(screen?.querySelector('.clip > .lp-film video')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(played).toEqual([INTRO.playlistUrl]);
    // The press's button has gone; the player's play button has the focus.
    expect(watch()).toBeUndefined();
    expect(document.activeElement?.classList.contains('player__play')).toBe(
      true
    );
    // The poster stays under the player, for when the film stops.
    expect(screen?.querySelector('img')?.getAttribute('src')).toBe(
      INTRO.posterUrl
    );
  });

  it('when the film ends the poster comes back with "Watch again", and no buy button', async () => {
    await render(SAMPLE);
    watch()?.click();
    document.querySelector('.lp-film video')?.dispatchEvent(new Event('ended'));
    flushSync();
    expect(document.body.querySelector('.lp-film')).toBeNull();
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      INTRO.posterUrl
    );
    const again = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === FILM_COPY.again
    );
    expect(again).toBeDefined();
    // The player had the focus, so "Watch again" takes it.
    expect(document.activeElement).toBe(again);
    expect(document.body.querySelector('a')).toBeNull();
    again?.click();
    expect(document.body.querySelector('.lp-film video')).not.toBeNull();
    expect(played).toEqual([INTRO.playlistUrl, INTRO.playlistUrl]);
  });

  it('holds the screen while the film is on its way, as the server sends it, and folds away once there is none', async () => {
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
    expect(document.body.querySelector('figcaption')?.textContent).toBe(
      SAMPLE.caption
    );
    expect(document.body.querySelector('.video-none')).toBeNull();
    settle({ intro: null, reel: null });
    await tick();
    await Promise.resolve();
    flushSync();
    expect(document.body.querySelector('h2')).toBeNull();
    expect(document.body.querySelector('.video-none')).not.toBeNull();
  });

  // Codex-61zsk.40: the awaited course view says whether a film can come.
  // With none, the band folds from the first paint instead of drawing whole
  // and then vanishing once the stream settles.
  describe('with the awaited view saying which film can come', () => {
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
            filmsAttached: { hero: false, reel: true, intro: attached },
          },
        }),
        sellPreview: new Promise<SellPreview | null>((resolve) => {
          settle = resolve;
        }),
      };
      return { context, settle };
    };

    it.each(
      SECTION_LAYOUTS.video
    )('%s: with no film attached the public page folds from the first paint', async (layout) => {
      await render(SAMPLE, { layout, context: awaiting(false).context });
      expect(document.body.querySelector('h2')).toBeNull();
      expect(document.body.querySelector('.lp-media')).toBeNull();
      expect(document.body.querySelector('.video-none')).not.toBeNull();
    });

    it('with one attached, holds its place while it is on its way', async () => {
      await render(SAMPLE, { context: awaiting(true).context });
      expect(document.body.querySelector('h2')?.textContent).toBe(
        SAMPLE.heading
      );
      expect(
        document.body.querySelector('.lp-media[data-pending]')
      ).not.toBeNull();
      expect(document.body.querySelector('.video-none')).toBeNull();
    });

    it('a film that arrives although none was attached still shows', async () => {
      const { context, settle } = awaiting(false);
      await render(SAMPLE, { context });
      settle({ intro: INTRO, reel: null });
      await tick();
      await Promise.resolve();
      flushSync();
      expect(document.body.querySelector('h2')?.textContent).toBe(
        SAMPLE.heading
      );
      expect(document.body.querySelector('.video-none')).toBeNull();
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

  // Codex-61zsk.37 (C1): the public page kept the words and dropped the
  // screen, so a visitor read "Two minutes, from me to you" above nothing.
  it.each(
    SECTION_LAYOUTS.video
  )('%s: with no film the public page draws no section at all', async (layout) => {
    await render(SAMPLE, { layout, intro: null });
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text().trim()).toBe('');
    expect(document.body.querySelector('.lp-media')).toBeNull();
    expect(watch()).toBeUndefined();
    // The band is told to fold away (by the rule the parity test checks).
    expect(document.body.querySelector('.video-none')).not.toBeNull();
  });

  it.each(
    SECTION_LAYOUTS.video
  )('%s: the canvas keeps the words and the plate, asks for the film, and keeps the caption editable', async (layout) => {
    await render(SAMPLE, { layout, intro: null, edit: { commit: () => {} } });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(document.body.querySelector('.lp-media__plate')).not.toBeNull();
    expect(text()).toContain(VIDEO_PROMPT);
    expect(
      document.body.querySelector('figcaption')?.getAttribute('contenteditable')
    ).toBe('true');
    expect(watch()).toBeUndefined();
  });

  it('draws the section once the film is there, with nothing to fold it away', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('.video-none')).toBeNull();
    expect(document.body.querySelector('[data-lp-edit-only]')).toBeNull();
  });

  it('draws the play button on the canvas but never plays there', async () => {
    await render(SAMPLE, { edit: { commit: () => {} } });
    watch()?.click();
    flushSync();
    await tick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('video')).toBeNull();
    expect(watch()).toBeDefined();
    expect(played).toEqual([]);
  });

  it('adds a way to join only when the creator writes one', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({
      ...SAMPLE,
      ctaLabel: 'Start the course',
      note: 'Start any time.',
    });
    const join = document.body.querySelector('a');
    expect(join?.textContent?.trim()).toBe('Start the course');
    expect(join?.getAttribute('href')).toBe('/journeys/steady-ground/checkout');
    expect(text()).toContain('Start any time.');
  });

  it('turns that way in into "Continue" for a member', async () => {
    await render({ ...SAMPLE, ctaLabel: 'Buy' }, { offer: 'enrolled' });
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      COPY.cta.continue
    );
  });

  it('renders only its own words', async () => {
    await render({});
    const course = sampleContext().course;
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text()).not.toContain(course.title);
    expect(text()).not.toContain(String(course.lede));
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);

    const edits: [string, string][] = [];
    await render(SAMPLE, {
      edit: { commit: (key, value) => edits.push([key, value]) },
    });
    const caption = document.body.querySelector('figcaption');
    expect(caption?.getAttribute('aria-label')).toBe(
      'Video — Caption under the film'
    );
    caption!.textContent = 'Filmed in spring.';
    caption!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['caption', 'Filmed in spring.']]);
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
  });

  describe('its line: who speaks, and for how long (Codex-61zsk.73)', () => {
    // A 2:04 film whose preview runs 30 seconds.
    const FILM: PreviewMedia = {
      ...INTRO,
      durationSeconds: 124,
      previewSeconds: 30,
      mediaType: 'video',
    };
    const line = () =>
      document.body.querySelector('.video__line')?.textContent ?? null;

    it('names the speaker the creator wrote, beside the preview it plays', async () => {
      await render({ ...SAMPLE, speaker: 'Ada Okafor' }, { intro: FILM });
      expect(line()).toBe('Ada Okafor · 0:30 preview');
    });

    it('hidden, the length alone, though a speaker is written', async () => {
      await render(
        { ...SAMPLE, speaker: 'Ada Okafor', hideSpeaker: true },
        { intro: FILM }
      );
      expect(line()).toBe('0:30 preview');
    });

    it('with a speaker and no length known, the speaker alone', async () => {
      await render(
        { ...SAMPLE, speaker: 'Ada Okafor' },
        { intro: { ...FILM, previewSeconds: null } }
      );
      expect(line()).toBe('Ada Okafor');
    });

    it('with neither, no line at all', async () => {
      // An older payload (no preview length, and the film plays its
      // preview), and on its own the block has no guide to name.
      await render(SAMPLE);
      expect(document.body.querySelector('.video__line')).toBeNull();
    });

    it('theatre: under the screen, above its caption', async () => {
      await render({ ...SAMPLE, speaker: 'Ada Okafor' }, { intro: FILM });
      const under = document.body.querySelector(
        '.video__screen > .video__line'
      );
      const caption = document.body.querySelector(
        '.video__screen > figcaption'
      );
      expect(under).not.toBeNull();
      expect(
        under &&
          caption &&
          under.compareDocumentPosition(caption) &
            Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('split: under the words, above the buttons', async () => {
      await render(
        {
          ...SAMPLE,
          ctaLabel: 'Join',
          speaker: 'Ada Okafor',
        },
        { layout: 'split', intro: FILM }
      );
      const words = document.body.querySelector('.video-split__words');
      const under = words?.querySelector('.video__line');
      const actions = words?.querySelector('.video__actions');
      expect(under?.textContent).toBe('Ada Okafor · 0:30 preview');
      expect(
        under &&
          actions &&
          under.compareDocumentPosition(actions) &
            Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        document.body.querySelector('.video__screen .video__line')
      ).toBeNull();
    });

    describe('on the page, the guide speaks by default', () => {
      const requestFilm = vi.fn(async () => null);

      async function page(
        types: readonly SectionTypeId[],
        options: {
          edit?: PageEdit | null;
          video?: Record<string, unknown>;
        } = {}
      ) {
        const kit = samplePage('clean', types);
        const video = kit.sections.find((s) => s.type === 'video');
        if (video && options.video)
          video.props = { ...video.props, ...options.video };
        app = mount(PageRenderer, {
          target: document.body,
          props: {
            page: kit,
            context: sampleContext({
              media: { intro: { ...FILM, fullFilm: true } },
            }),
            edit: options.edit ?? null,
            requestFilm,
          },
        });
        flushSync();
        await tick();
        await Promise.resolve();
        flushSync();
      }

      // The sample sets no switch, as a section saved before it existed.
      it("names the About you section's guide, beside the whole film it plays", async () => {
        await page(['instructor', 'video']);
        expect(line()).toBe(`${instructorDefinition.sample.name} · 2:04`);
      });

      it('the canvas says the same as the visitor’s page', async () => {
        await page(['instructor', 'video'], { edit: { commit: () => {} } });
        expect(line()).toBe(`${instructorDefinition.sample.name} · 2:04`);
      });

      it("the creator's speaker overrides the guide", async () => {
        await page(['instructor', 'video'], {
          video: { speaker: 'Ada Okafor' },
        });
        expect(line()).toBe('Ada Okafor · 2:04');
      });

      it('hidden, the guide is not named', async () => {
        await page(['instructor', 'video'], { video: { hideSpeaker: true } });
        expect(line()).toBe('2:04');
      });

      it('with no guide on the page, the length alone', async () => {
        await page(['video']);
        expect(line()).toBe('2:04');
      });

      // The button says what a press plays, as the line does: never "the
      // preview" for the whole film, on the page or the canvas.
      it.each([
        ['the page', null],
        ['the canvas', { commit: () => {} }],
      ] as [
        string,
        PageEdit | null,
      ][])('on %s, the whole film’s button says "Watch the film"', async (_, edit) => {
        await page(['video'], { edit });
        expect(labels()).toContain(FILM_COPY.watch);
        expect(labels()).not.toContain(FILM_COPY.preview);
      });

      it('a new section names who speaks without writing a switch', () => {
        expect(
          videoDefinition.starter({ courseTitle: 'Steady Ground' })
        ).not.toHaveProperty('hideSpeaker');
      });
    });
  });
});
