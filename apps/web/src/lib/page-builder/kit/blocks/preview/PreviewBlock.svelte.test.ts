import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, PreviewMedia } from '../../../render/types';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
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

beforeEach(() => {
  played.length = 0;
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
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
    expect(document.body.querySelector('figcaption')?.textContent).toBe(
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

  it('keeps a plate and a play button for a clip with no poster', async () => {
    await render(SAMPLE, { reel: { playlistUrl: REEL.playlistUrl } });
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.querySelector('.lp-media')).not.toBeNull();
    expect(play()).toBeDefined();
  });

  it.each(
    SECTION_LAYOUTS.preview
  )('%s: no clip leaves the words, and only the words, on the public page', async (layout) => {
    await render(SAMPLE, { layout, reel: null });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(document.body.querySelector('figure')).toBeNull();
    expect(text()).not.toContain(SAMPLE.caption);
  });

  it('asks for the clip on the canvas', async () => {
    await render(SAMPLE, { reel: null, edit: { commit: () => {} } });
    expect(text()).toContain(PREVIEW_PROMPT);
    expect(play()).toBeUndefined();
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
    await render(SAMPLE, { edit: { commit: () => {} } });
    expect(
      document.body.querySelector('figcaption')?.getAttribute('aria-label')
    ).toBe('Sneak peek — Caption');
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
  });
});
