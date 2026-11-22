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
 * OrgHero (Codex-1yd58 WP-0, keep-the-box rule): a picture that fails is
 * hidden and keeps its box, so nothing moves after first paint (a failure the
 * browser saw before hydration is replayed at hydration). The composition
 * holds, the brand's plate or the box's own ground shows in the picture's
 * place, a logo leading alone draws the name in its own box, and the failure
 * is logged, so a vanished picture never leaves an empty frame or a front
 * page with no name.
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

  function render(
    options: HeroOptions,
    spot: OrgHeroPiece,
    logo = 'logo.png',
    more: Partial<ReturnType<typeof props>> = {}
  ) {
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(OrgHero, {
      target,
      props: { ...props(options, spot, logo), ...more },
    });
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
  /** The picture is still in its box, hidden: FallbackImage's or a logo's. */
  const hiddenInBox = (selector: string) => {
    const img = target.querySelector<HTMLImageElement>(selector);
    expect(img, selector).not.toBeNull();
    return img?.style.display === 'none' || img?.style.visibility === 'hidden';
  };

  test('a logo leading alone that fails keeps its box and draws the name in it', () => {
    render(
      resolveHero('grow', { lead: 'logo' }, FACTS),
      piece('a'),
      'logo-a.png'
    );
    const box = target.querySelector('.org-hero__logo');
    expect(titleHidden()).toBe(true);
    expect(target.querySelector('.org-hero__logo-name')).toBeNull();

    fail('img[src$="logo-a.png"]');

    expect(target.querySelector('.org-hero__logo')).toBe(box);
    expect(hiddenInBox('img[src$="logo-a.png"]')).toBe(true);
    const drawn = target.querySelector('.org-hero__logo .org-hero__logo-name');
    expect(drawn?.textContent).toBe('Of Blood & Bones');
    expect(drawn?.getAttribute('aria-hidden')).toBe('true');
    // the h1 stays in the page for screen readers, out of the flow
    expect(titleHidden()).toBe(true);
    vi.runOnlyPendingTimers();
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({ file: 'logo-a.png' })
    );
  });

  test('a logo leading with the name that fails keeps its box, empty', () => {
    render(
      resolveHero('grow', { lead: 'both' }, FACTS),
      piece('a2'),
      'logo-a2.png'
    );
    const box = target.querySelector('.org-hero__logo');
    expect(box).not.toBeNull();
    expect(titleHidden()).toBe(false);

    fail('img[src$="logo-a2.png"]');

    expect(target.querySelector('.org-hero__logo')).toBe(box);
    expect(hiddenInBox('img[src$="logo-a2.png"]')).toBe(true);
    // the name is already in view: it is not drawn twice
    expect(target.querySelector('.org-hero__logo-name')).toBeNull();
    expect(titleHidden()).toBe(false);
  });

  const frameTitle = () =>
    target.querySelector('.org-hero__frame-title')?.textContent;

  test("a spotlight frame whose picture fails shows the brand's plate, still named", () => {
    render(resolveHero('spotlight', {}, FACTS), piece('b'));
    expect(section()?.dataset.comp).toBe('showcase');
    expect(target.querySelector('.org-hero__frame-fallback')).toBeNull();

    fail('.org-hero__frame-art img');

    expect(hiddenInBox('.org-hero__frame-art img')).toBe(true);
    // a plate, not a second title: the caption already names the piece
    expect(target.querySelector('.org-hero__frame-fallback')?.textContent).toBe(
      ''
    );
    expect(frameTitle()).toBe('Bone Deep');
  });

  test("a billboard whose picture fails stays a billboard, over the brand's plate", () => {
    render(resolveHero('spotlight', { comp: 'billboard' }, FACTS), piece('c'));
    expect(section()?.dataset.comp).toBe('billboard');
    expect(target.querySelector('.org-hero__plate')).toBeNull();

    fail('.org-hero__bg img');

    expect(section()?.dataset.comp).toBe('billboard');
    expect(section()?.dataset.bg).toBe('picture');
    expect(hiddenInBox('.org-hero__bg img')).toBe(true);
    expect(
      target.querySelector('.org-hero__bg-media .org-hero__plate')
    ).not.toBeNull();
    // its words are the piece's still, and no Showcase frame is drawn
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Bone Deep');
    expect(target.querySelector('.org-hero__frame')).toBeNull();
  });

  test('a billboard whose picture fails keeps its alignment', () => {
    // grow centres its words, which a billboard allows and a Showcase does not
    render(resolveHero('grow', { comp: 'billboard' }, FACTS), piece('e'));
    expect(section()?.dataset.align).toBe('center');

    fail('.org-hero__bg img');

    expect(section()?.dataset.comp).toBe('billboard');
    expect(section()?.dataset.align).toBe('center');
  });

  test("a billboard's logo beside the name that fails keeps its place, hidden", () => {
    render(
      resolveHero('spotlight', { comp: 'billboard' }, FACTS),
      piece('f'),
      'logo-f.png'
    );
    const id = target.querySelector('.org-hero__id');

    fail('.org-hero__id img');

    expect(target.querySelector('.org-hero__id')).toBe(id);
    expect(hiddenInBox('.org-hero__id img')).toBe(true);
    expect(id?.textContent?.trim()).toBe('Of Blood & Bones');
  });

  test('a split panel whose picture fails keeps its column with a title card', () => {
    render(resolveHero('intro', {}, FACTS), piece('d'));
    expect(section()?.dataset.comp).toBe('split');
    const panel = target.querySelector('.org-hero__media');

    fail('.org-hero__media img');

    expect(target.querySelector('.org-hero__media')).toBe(panel);
    expect(hiddenInBox('.org-hero__media img')).toBe(true);
    expect(panel?.querySelector('.org-hero__frame-fallback')?.textContent).toBe(
      'Bone Deep'
    );
  });

  test("a shelf piece's thumbnail that fails keeps its tile", () => {
    const shelf = [
      piece('g'),
      { ...piece('h'), href: '/content/h', title: 'Ancestral Threads' },
    ];
    render(
      resolveHero('grow', { proof: 'shelf' }, FACTS),
      piece('g0'),
      'logo.png',
      { shelf }
    );
    const thumbs = target.querySelectorAll('.org-hero__shelf-thumb');
    expect(thumbs).toHaveLength(2);

    fail('.org-hero__shelf-thumb img');

    expect(target.querySelectorAll('.org-hero__shelf-thumb')).toHaveLength(2);
    expect(target.querySelector('.org-hero__shelf-thumb')).toBe(thumbs[0]);
    // the failed one, not the next tile's
    expect(thumbs[0]?.querySelector('img')).not.toBeNull();
    expect(hiddenInBox('.org-hero__shelf-thumb img')).toBe(true);
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
