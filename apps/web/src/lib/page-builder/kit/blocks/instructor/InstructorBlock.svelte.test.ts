import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../../../render/types';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { INSTRUCTOR_COPY } from './copy';
import { INSTRUCTOR_PROMPT, instructorDefinition } from './definition';
import InstructorBlock from './InstructorBlock.svelte';

const played: string[] = [];

vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async ({ src }: { src: string }) => {
    played.push(src);
    return { hls: null, cleanup: () => {} };
  }),
}));

const MEDIA: Partial<SellPreview> = {
  guidePortraitUrl: '/media/guide/portrait.jpg',
  guideClip: {
    playlistUrl: '/media/guide/hello.m3u8',
    posterUrl: '/media/guide/frame.jpg',
  },
  signatureUrl: '/media/guide/signature.png',
};

const GUIDE = {
  heading: 'Hello, I am Maya',
  body: 'I have taught breath and movement for twelve years.',
  name: 'Maya Linden',
  role: 'Breathwork teacher',
  credentials: ['Twelve years teaching', 'Over 4,000 students'],
  quote: 'You need a better first twenty minutes.',
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

function contextWith(media: Partial<SellPreview>): JourneySalesContext {
  return {
    ...sampleContext(),
    sellPreview: Promise.resolve({ intro: null, reel: null, ...media }),
  };
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    media?: Partial<SellPreview>;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'instructor-1',
    anchor: 'instructor',
    type: 'instructor',
    index: 7,
    layout: options.layout ?? 'split',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(InstructorBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: options.context ?? contextWith(options.media ?? MEDIA),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
}

const text = () => document.body.textContent ?? '';
const portrait = () =>
  document.body.querySelector<HTMLImageElement>('img[alt^="Portrait"]');
const playButton = () =>
  [...document.body.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Hear from')
  );

describe('InstructorBlock', () => {
  it.each(
    SECTION_LAYOUTS.instructor
  )('%s: every field the guide filled, with their portrait', async (layout) => {
    await render(GUIDE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(GUIDE.heading);
    for (const value of [
      GUIDE.body,
      GUIDE.name,
      GUIDE.role,
      ...GUIDE.credentials,
    ]) {
      expect(text()).toContain(value);
    }
    expect(document.body.querySelector('blockquote')?.textContent).toBe(
      GUIDE.quote
    );
    expect(portrait()?.getAttribute('src')).toBe(MEDIA.guidePortraitUrl);
    expect(portrait()?.getAttribute('alt')).toBe(
      INSTRUCTOR_COPY.portraitAlt(GUIDE.name)
    );
  });

  it('takes its heading level from the section', async () => {
    await render(GUIDE, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(GUIDE.heading);
  });

  it('never numbers the credentials', async () => {
    await render(GUIDE);
    expect(document.body.querySelector('ol')).toBeNull();
    expect(document.body.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('steps the heading down when the quote is the centrepiece', async () => {
    await render(GUIDE, { layout: 'quote' });
    expect(document.body.querySelector('h2')?.getAttribute('data-size')).toBe(
      'title'
    );
    unmount(app);
    await render({ ...GUIDE, quote: undefined }, { layout: 'quote' });
    expect(document.body.querySelector('h2')?.getAttribute('data-size')).toBe(
      'heading'
    );
    expect(document.body.querySelector('blockquote')).toBeNull();
  });

  it.each(
    SECTION_LAYOUTS.instructor
  )('%s: plays exactly the guide clip, named for the guide', async (layout) => {
    await render(GUIDE, { layout });
    expect(playButton()?.textContent?.trim()).toBe(
      INSTRUCTOR_COPY.watch(GUIDE.name)
    );
    playButton()?.click();
    flushSync();
    await tick();
    await Promise.resolve();
    expect(played).toEqual([MEDIA.guideClip?.playlistUrl]);
  });

  it('has no play button without a clip, and a generic name without a guide name', async () => {
    await render(GUIDE, {
      media: { guidePortraitUrl: MEDIA.guidePortraitUrl },
    });
    expect(playButton()).toBeUndefined();
    unmount(app);
    await render({ ...GUIDE, name: undefined });
    expect(playButton()?.textContent?.trim()).toBe(INSTRUCTOR_COPY.watch());
  });

  it('falls back to the clip frame when there is no portrait', async () => {
    await render(GUIDE, { media: { guideClip: MEDIA.guideClip } });
    expect(portrait()?.getAttribute('src')).toBe(MEDIA.guideClip?.posterUrl);
  });

  it('signs off with the signature mark only when one was uploaded', async () => {
    await render(GUIDE);
    const mark = document.body.querySelector<HTMLImageElement>('img.sig');
    expect(mark?.getAttribute('src')).toBe(MEDIA.signatureUrl);
    expect(mark?.getAttribute('alt')).toBe('');
    unmount(app);
    await render(GUIDE, {
      media: { guidePortraitUrl: MEDIA.guidePortraitUrl },
    });
    expect(document.body.querySelector('img.sig')).toBeNull();
    expect(text()).toContain(GUIDE.name);
  });

  it.each(
    SECTION_LAYOUTS.instructor
  )('%s: no portrait leaves the story whole on the public page', async (layout) => {
    await render(GUIDE, { layout, media: {} });
    expect(document.body.querySelector('.lp-media')).toBeNull();
    expect(text()).toContain(GUIDE.body);
    expect(text()).not.toContain(INSTRUCTOR_PROMPT);
  });

  it.each(
    SECTION_LAYOUTS.instructor
  )('%s: the canvas asks for the portrait', async (layout) => {
    await render(GUIDE, { layout, media: {}, edit: { commit: () => {} } });
    expect(text()).toContain(INSTRUCTOR_PROMPT);
  });

  it('adds a way to join only when the creator writes one', async () => {
    await render(GUIDE);
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({ ...GUIDE, ctaLabel: 'Learn with Maya' });
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      'Learn with Maya'
    );
  });

  it('starts honest: no name, credentials or quote put in the guide’s mouth', () => {
    const starter = instructorDefinition.starter({
      courseTitle: 'Steady Ground',
    });
    expect(starter.body).toContain('Steady Ground');
    expect(starter).not.toHaveProperty('name');
    expect(starter).not.toHaveProperty('credentials');
    expect(starter).not.toHaveProperty('quote');
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(GUIDE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);

    const edits: [string, string][] = [];
    await render(GUIDE, {
      edit: { commit: (key, value) => edits.push([key, value]) },
    });
    const labelled = (label: string) =>
      document.body.querySelector(`[aria-label="About you — ${label}"]`);
    expect(labelled('Your name')?.textContent).toBe(GUIDE.name);
    expect(labelled('What you do')?.textContent).toBe(GUIDE.role);
    const quote = labelled('A line in your own words');
    expect(quote?.textContent).toBe(GUIDE.quote);
    quote!.textContent = 'Twenty minutes is enough.';
    quote!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['quote', 'Twenty minutes is enough.']]);
  });
});
