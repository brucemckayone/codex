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
import type { JourneySalesContext, SellPreview } from '../../../render/types';
import { DEFAULT_PAGE_STYLE, SECTION_LAYOUTS } from '../../model/ids';
import { featuredScheme } from '../../model/resolve';
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

  it.each([
    ['split', 'portrait'],
    ['centered', 'portrait'],
    ['quote', 'theatre'],
  ] as const)('%s: the guide clip plays in the %s', async (layout, where) => {
    await render(GUIDE, { layout });
    playButton()?.click();
    const dialog = document.body.querySelector('[role="dialog"]');
    const inPortrait = document.body.querySelector(
      '.guide__portrait .clip > .lp-film video'
    );
    if (where === 'portrait') {
      expect(inPortrait).not.toBeNull();
      expect(dialog).toBeNull();
    } else {
      // The quote has no frame to play in: the theatre, the same player.
      expect(inPortrait).toBeNull();
      expect(dialog?.querySelector('.player video')).not.toBeNull();
    }
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

  it('quote: signs off with the signature mark only when there is one', async () => {
    await render(GUIDE, { layout: 'quote' });
    const mark = document.body.querySelector<HTMLImageElement>('img.sig');
    expect(mark?.getAttribute('src')).toBe(MEDIA.signatureUrl);
    expect(mark?.getAttribute('alt')).toBe('');
    unmount(app);
    await render(GUIDE, {
      layout: 'quote',
      media: { guidePortraitUrl: MEDIA.guidePortraitUrl },
    });
    expect(document.body.querySelector('img.sig')).toBeNull();
    expect(text()).toContain(GUIDE.name);
  });

  // 03 X57, the reference plan's round 3: the "signature" a film stands in
  // for was a tiny landscape thumbnail above the guide's name.
  const face = () => document.body.querySelector('.signoff__face');

  it.each([
    'split',
    'centered',
  ])('%s: signs off with a round portrait beside the name, never the mark', async (layout) => {
    await render(GUIDE, { layout });
    expect(document.body.querySelector('img.sig')).toBeNull();
    const photo = face();
    expect(photo?.tagName).toBe('IMG');
    expect(photo?.getAttribute('src')).toBe(MEDIA.guidePortraitUrl);
    // Decorative: the name beside it is what reads.
    expect(photo?.getAttribute('alt')).toBe('');
    const signoff = photo?.closest('.signoff');
    expect(signoff?.querySelector('.signoff__name')?.textContent).toBe(
      GUIDE.name
    );
    expect(signoff?.querySelector('.signoff__role')?.textContent).toBe(
      GUIDE.role
    );
  });

  it('signs off with the clip’s frame when that is the only picture of the guide', async () => {
    await render(GUIDE, { media: { guideClip: MEDIA.guideClip } });
    expect(face()?.getAttribute('src')).toBe(MEDIA.guideClip?.posterUrl);
  });

  it('signs off with the guide’s initials when there is no picture', async () => {
    await render(GUIDE, { media: { signatureUrl: MEDIA.signatureUrl } });
    const initials = face();
    expect(initials?.tagName).toBe('SPAN');
    expect(initials?.textContent).toBe('ML');
    expect(initials?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.querySelector('img.sig')).toBeNull();
  });

  it('holds the circle’s place while the stream is out, so the name never moves', async () => {
    let settle: (preview: SellPreview) => void = () => {};
    const sellPreview = new Promise<SellPreview>((resolve) => {
      settle = resolve;
    });
    await render(GUIDE, { context: { ...sampleContext(), sellPreview } });
    const held = face();
    expect(held).not.toBeNull();
    expect(held?.textContent).toBe('');
    settle({
      intro: null,
      reel: null,
      guidePortraitUrl: MEDIA.guidePortraitUrl,
    });
    await tick();
    await Promise.resolve();
    flushSync();
    expect(face()?.getAttribute('src')).toBe(MEDIA.guidePortraitUrl);
  });

  it('with neither a name nor a picture, signs off with no face at all', async () => {
    const { name: _, ...nameless } = GUIDE;
    await render(nameless, { media: {} });
    expect(face()).toBeNull();
    expect(text()).toContain(GUIDE.role);
  });

  // Codex-61zsk.37 (C1): with no portrait, split left about 40% of the band
  // empty. The guide's initials hold the portrait's place instead.
  it.each([
    'split',
    'centered',
  ])('%s with no portrait: the guide’s initials hold its place, on the filled scheme', async (layout) => {
    await render(GUIDE, { layout, media: {} });
    const medallion = document.body.querySelector(
      '.guide__portrait .lp-media[data-mark]'
    );
    expect(medallion?.textContent?.trim()).toBe('ML');
    expect(medallion?.getAttribute('data-lp-scheme')).toBe(
      featuredScheme(DEFAULT_PAGE_STYLE, 'base')
    );
    expect(document.body.querySelector('.lp-media__plate')).toBeNull();
    expect(text()).toContain(GUIDE.body);
    expect(text()).not.toContain(INSTRUCTOR_PROMPT);
  });

  it.each([
    'split',
    'centered',
  ])('%s: the canvas draws the same medallion and asks for the photo over it', async (layout) => {
    await render(GUIDE, { layout, media: {}, edit: { commit: () => {} } });
    expect(
      document.body.querySelector('.lp-media[data-mark]')?.textContent?.trim()
    ).toBe('ML');
    expect(
      document.body.querySelector('[data-lp-edit-only]')?.textContent
    ).toContain(INSTRUCTOR_PROMPT);
  });

  it.each(
    SECTION_LAYOUTS.instructor
  )('%s: no portrait and no name to draw leaves the story whole on the public page', async (layout) => {
    await render({ ...GUIDE, name: undefined }, { layout, media: {} });
    expect(document.body.querySelector('.lp-media')).toBeNull();
    expect(text()).toContain(GUIDE.body);
    expect(text()).not.toContain(INSTRUCTOR_PROMPT);
  });

  it('quote signs off with the name alone when there is no portrait', async () => {
    await render(GUIDE, { layout: 'quote', media: {} });
    expect(document.body.querySelector('.lp-media')).toBeNull();
    expect(text()).toContain(GUIDE.name);
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

describe('InstructorBlock: every size the portrait has (Codex-61zsk.66)', () => {
  const STILL = 'https://cdn.test/c1/media-thumbnails/m1/lg.webp';
  const SET = ['sm.webp 200w', 'md.webp 400w', 'lg.webp 800w']
    .map((size) => `https://cdn.test/c1/media-thumbnails/m1/${size}`)
    .join(', ');

  it.each([
    ['split', '(min-width: 52rem) 50vw, 100vw'],
    ['centered', 'min(100vw, 26rem)'],
    ['quote', '6rem'],
  ])('%s: offers the three sizes its URL names, at its drawn width', async (layout, sizes) => {
    await render(GUIDE, { layout, media: { guidePortraitUrl: STILL } });
    const img = [...document.body.querySelectorAll('img')].find(
      (el) =>
        el.getAttribute('src') === STILL &&
        !el.classList.contains('signoff__face')
    );
    expect(img?.getAttribute('srcset')).toBe(SET);
    expect(img?.getAttribute('sizes')).toBe(sizes);
  });

  it('the round sign-off face takes the smallest file the still has', async () => {
    await render(GUIDE, {
      layout: 'split',
      media: { guidePortraitUrl: STILL },
    });
    const face = document.body.querySelector('img.signoff__face');
    expect(face).not.toBeNull();
    expect(face?.getAttribute('srcset')).toBe(SET);
    expect(face?.getAttribute('sizes')).toBe('4.5rem');
  });

  it('a still whose URL names no sizes offers none', async () => {
    await render(GUIDE, { layout: 'split' });
    const img = document.body.querySelector(
      `img[src="${MEDIA.guidePortraitUrl}"]`
    );
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('srcset')).toBe(false);
  });
});
