import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type HeroFacts,
  type HeroOptions,
  type OrgHeroPiece,
  resolveHero,
} from '$lib/org-hero/hero-config';
import { type ReelEntry, reelQualifies } from '$lib/org-hero/reel';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import OrgHero from './OrgHero.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true }));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const { logger } = await import('$lib/observability');

/**
 * An org with everything but a film, so no player mounts, and no reel, so
 * these frames stay the ones they test.
 */
const FACTS: HeroFacts = {
  hasLogo: true,
  hasShader: true,
  hasFilm: false,
  hasFilmLoop: false,
  hasFeatured: true,
  hasLatest: true,
  hasFeaturedImage: true,
  hasLatestImage: true,
  hasFacts: true,
  hasDescription: true,
  canJoin: true,
  hideTitle: false,
  hasReel: false,
};

/** Each test names its own files: a file's failure is logged once per tab. */
const piece = (file: string): OrgHeroPiece => ({
  kind: 'video',
  kicker: 'Featured film',
  title: 'Bone Deep',
  meta: 'A 12-minute film',
  line: null,
  href: '/content/bone-deep',
  imageUrl: `http://localhost:4100/org/media-thumbnails/${file}/lg.webp`,
  previewUrl: null,
  durationSeconds: 720,
  cta: 'Watch the film',
});

/** The props every hero here shares; each test picks its options and piece. */
function props(
  options: HeroOptions,
  spot: OrgHeroPiece,
  logo = 'logo.png',
  reel: readonly ReelEntry[] = []
) {
  return {
    options,
    name: 'Of Blood & Bones',
    description: 'Ancestral healing',
    logoUrl: `http://localhost:4100/org/${logo}`,
    contentKind: 'watch' as const,
    spot,
    shelf: [],
    facts: [],
    hrefs: {
      explore: '/explore',
      consume: '/explore',
      join: '/pricing',
      search: '/explore',
    },
    consumeNote: null,
    film: null,
    filmOpen: false,
    filmPlaying: false,
    following: false,
    followBusy: false,
    onfilm: vi.fn(),
    onfollow: vi.fn(),
    reel,
  };
}

/**
 * OrgHero (Codex-1yd58 WP-0): a picture that fails is dropped and the hero
 * draws what it would without it, and the failure is logged, so a vanished
 * picture never leaves an empty frame or a front page with no name.
 */
describe('OrgHero, when a picture fails', () => {
  let component: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.warn).mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    if (component) unmount(component);
    component = null;
    target?.remove();
  });

  function render(options: HeroOptions, spot: OrgHeroPiece, logo = 'logo.png') {
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(OrgHero, { target, props: props(options, spot, logo) });
    flushSync();
  }

  function fail(selector: string) {
    const img = target.querySelector<HTMLImageElement>(selector);
    expect(img, selector).not.toBeNull();
    img?.dispatchEvent(new Event('error'));
    flushSync();
  }

  const section = () => target.querySelector<HTMLElement>('[data-hero-root]');
  const titleHidden = () =>
    target.querySelector('h1')?.classList.contains('org-hero__title--hidden');

  test('a logo leading alone that fails brings the name back into view', () => {
    render(
      resolveHero('grow', { lead: 'logo' }, FACTS),
      piece('a'),
      'logo-a.png'
    );
    expect(titleHidden()).toBe(true);

    fail('.org-hero__logo');

    expect(target.querySelector('.org-hero__logo')).toBeNull();
    expect(titleHidden()).toBe(false);
    vi.runOnlyPendingTimers();
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({ file: 'logo-a.png' })
    );
  });

  const frameTitle = () =>
    target.querySelector('.org-hero__frame-title')?.textContent;

  test("a spotlight frame whose picture fails shows the brand's plate, still named", () => {
    render(resolveHero('spotlight', {}, FACTS), piece('b'));
    expect(section()?.dataset.comp).toBe('showcase');
    expect(target.querySelector('.org-hero__frame-fallback')).toBeNull();

    fail('.org-hero__frame-art img');

    expect(target.querySelector('.org-hero__frame-art img')).toBeNull();
    // a plate, not a second title: the caption already names the piece
    expect(target.querySelector('.org-hero__frame-fallback')?.textContent).toBe(
      ''
    );
    expect(frameTitle()).toBe('Bone Deep');
  });

  test('a billboard whose picture fails is drawn as the Showcase frame', () => {
    render(resolveHero('spotlight', { comp: 'billboard' }, FACTS), piece('c'));
    expect(section()?.dataset.comp).toBe('billboard');

    fail('.org-hero__bg-media');

    expect(section()?.dataset.comp).toBe('showcase');
    expect(target.querySelector('h1')?.textContent?.trim()).toBe(
      'Of Blood & Bones'
    );
    expect(target.querySelector('.org-hero__frame-fallback')).not.toBeNull();
    expect(frameTitle()).toBe('Bone Deep');
  });

  test('a billboard that falls back takes an alignment the Showcase frame can draw', () => {
    // grow centres its words, which a billboard allows and a Showcase does not
    render(resolveHero('grow', { comp: 'billboard' }, FACTS), piece('e'));
    expect(section()?.dataset.align).toBe('center');

    fail('.org-hero__bg-media');

    expect(section()?.dataset.comp).toBe('showcase');
    expect(section()?.dataset.align).toBe('start');
  });

  test('a split panel whose picture fails keeps its column with a title card', () => {
    render(resolveHero('intro', {}, FACTS), piece('d'));
    expect(section()?.dataset.comp).toBe('split');

    fail('.org-hero__media img');

    const panel = target.querySelector('.org-hero__media');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.org-hero__frame-fallback')?.textContent).toBe(
      'Bone Deep'
    );
  });
});

/**
 * The Showreel (Codex-1yd58.6) is a composition of the hero: chosen with a
 * reel, it draws in the hero's place, its Join top right beside Follow
 * (owner, 2026-11-19); with too little to play, the hero draws as it would
 * without it.
 */
describe('OrgHero, as the Showreel', () => {
  let component: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  const REEL: ReelEntry[] = [
    { type: 'piece', piece: piece('reel-a'), show: 'still' },
    {
      type: 'piece',
      piece: { ...piece('reel-b'), title: 'Ancestral Threads' },
      show: 'still',
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    target?.remove();
    vi.useRealTimers();
  });

  function render(
    reel: readonly ReelEntry[],
    facts: Partial<HeroFacts> = {},
    logo = 'logo-reel.png'
  ) {
    target = document.createElement('div');
    document.body.appendChild(target);
    const options = resolveHero(
      'grow',
      { comp: 'showreel', main: 'join' },
      // As the landing works it out: from the same reel it hands the hero.
      { ...FACTS, ...facts, hasReel: reelQualifies(reel) }
    );
    component = mount(OrgHero, {
      target,
      props: props(options, piece('reel-spot'), logo, reel),
    });
    flushSync();
  }

  test('draws the Showreel in its place, the Join top right', () => {
    render(REEL);
    const root = target.querySelector<HTMLElement>('[data-hero-root]');
    expect(root?.classList.contains('reel')).toBe(true);
    expect(target.querySelectorAll('.reel__item')).toHaveLength(2);
    expect(target.querySelector('.reel__meta a')?.textContent).toBe(
      'Join Of Blood & Bones'
    );
    // The org is still the page's one heading.
    expect(target.querySelectorAll('h1')).toHaveLength(1);
    expect(target.querySelector('h1')?.textContent?.trim()).toBe(
      'Of Blood & Bones'
    );
  });

  test('a logo leading alone that fails brings the name back into view, logged', () => {
    vi.mocked(logger.warn).mockReset();
    render(REEL, { hideTitle: true }, 'logo-reel-fails.png');
    const name = () => target.querySelector('.reel__name');
    expect(name()?.classList.contains('sr-only')).toBe(true);

    target.querySelector('.reel__sig img')?.dispatchEvent(new Event('error'));
    flushSync();

    expect(target.querySelector('.reel__sig img')).toBeNull();
    expect(name()?.classList.contains('sr-only')).toBe(false);
    vi.runOnlyPendingTimers();
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({ file: 'logo-reel-fails.png' })
    );
  });

  test('draws the hero as it would without it, with too little to play', () => {
    // One piece and no film is no reel (reelQualifies).
    render(REEL.slice(0, 1));
    expect(target.querySelector('.reel')).toBeNull();
    const root = target.querySelector<HTMLElement>('[data-hero-root]');
    expect(root?.dataset.comp).toBeDefined();
    expect(root?.dataset.comp).not.toBe('showreel');
  });
});
