import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { VIDEO_COPY } from './copy';
import { VIDEO_PROMPT } from './definition';
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

beforeEach(() => {
  played.length = 0;
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
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
const watch = () =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === VIDEO_COPY.watch
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

  it('opens the shared player with exactly the intro clip', async () => {
    await render(SAMPLE);
    watch()?.click();
    flushSync();
    await tick();
    await Promise.resolve();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(played).toEqual([INTRO.playlistUrl]);
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
});
