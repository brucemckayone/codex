/**
 * The Showreel (Codex-1yd58.6) as a visitor meets it, on its DOM path: the
 * layouts, the clock and what stops it, the phone's taps, the static and
 * Save-Data paths, what it tells the window's shader, and the iOS decode
 * error's restart. Frames are driven by hand (`frame(ms)`); the HLS player,
 * the observers and the media elements' play are stand-ins.
 */

import type { IntroFilm } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import {
  PUSH_DEPTH,
  PUSH_SECONDS,
  pushZoom,
} from '$lib/components/ui/ShaderHero/compositor/stage';
import { shaderTone } from '$lib/components/ui/ShaderHero/shader-tone';
import {
  type HeroFacts,
  type OrgHeroPiece,
  resolveHero,
} from '$lib/org-hero/hero-config';
import type { ReelEntry } from '$lib/org-hero/reel';
import { PIECE_MS } from '$lib/org-hero/showreel/reel-clock.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true }));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/components/player/load-core', () => ({
  preloadPlayerOnIntent: () => {},
}));
const hls = vi.hoisted(() => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: vi.fn() })),
}));
vi.mock('$lib/components/VideoPlayer/hls', () => hls);

const { logger } = await import('$lib/observability');
// Loaded once up front: the component's own import then finds the stand-in
// in the module cache, never the real player.
await import('$lib/components/VideoPlayer/hls');
const { default: Showreel } = await import('./Showreel.svelte');

const FACTS: HeroFacts = {
  hasLogo: true,
  hasShader: true,
  hasFilm: true,
  hasFilmLoop: true,
  hasFeatured: true,
  hasLatest: true,
  hasFeaturedImage: true,
  hasLatestImage: true,
  hasFacts: true,
  hasDescription: true,
  canJoin: true,
  hideTitle: false,
  hasReel: true,
};
const FILM: IntroFilm = {
  title: 'Our film',
  posterUrl: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
  previewUrl: 'http://localhost:4100/org/hls/film/index.m3u8',
  durationSeconds: 30,
  fullFilm: false,
};
const piece = (
  title: string,
  over: Partial<OrgHeroPiece> = {}
): OrgHeroPiece => ({
  kind: 'article',
  kicker: 'Featured essay',
  title,
  meta: 'An essay',
  line: null,
  href: `/content/${title.toLowerCase().replace(/\s+/g, '-')}`,
  imageUrl: `http://localhost:4100/org/thumbnails/${title.length}/thumb.jpg`,
  previewUrl: null,
  durationSeconds: null,
  cta: 'Read the essay',
  ...over,
});
const REEL: ReelEntry[] = [
  { type: 'film', film: FILM, show: 'footage' },
  { type: 'piece', piece: piece('The Medicine of Grief'), show: 'still' },
  { type: 'piece', piece: piece('Fire Ceremony at Dusk'), show: 'still' },
];

let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];
let clock = 0;
let media = { reduced: false, desktop: true };
let intersecting: ((entries: { isIntersecting: boolean }[]) => void) | null =
  null;

/** Run frames until `ms` has passed, 16 ms apart, then the words' swap. */
function frame(ms: number) {
  // What the last event changed first: a hold that ends restarts the loop.
  flushSync();
  for (let t = 0; t < ms; t += 16) {
    clock += 16;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
  }
  // The effects first: the words' swap sets its timer when they run.
  flushSync();
  vi.advanceTimersByTime(300);
  flushSync();
}

/**
 * Mount it as the landing does. The props are live: a test hands over a new
 * reel (the landing's data refreshing) or flips `filmPlaying`, as the page
 * would.
 */
function render(
  layout: 'corner' | 'wide' | 'name' = 'corner',
  over: {
    reel?: ReelEntry[];
    loop?: 'on' | 'off';
    filmOpen?: boolean;
    facts?: Partial<HeroFacts>;
    logoUrl?: string;
    peek?: 'on' | 'off';
    push?: 'on' | 'off';
  } = {}
) {
  const options = resolveHero(
    'consume',
    {
      comp: 'showreel',
      'reel-layout': layout,
      'reel-loop': over.loop ?? 'on',
      ...(over.peek ? { 'reel-peek': over.peek } : {}),
      ...(over.push ? { 'reel-push': over.push } : {}),
    },
    { ...FACTS, ...over.facts }
  );
  const props = $state({
    reel: over.reel ?? REEL,
    options,
    name: 'Of Blood & Bones',
    description: 'Ancestral healing.',
    logoUrl: over.logoUrl ?? '',
    onlogofail: vi.fn(),
    facts: '4 portals and 15 essays',
    action: { href: '/pricing', label: 'Join Of Blood & Bones' },
    exploreHref: '/explore',
    filmDuration: '0:30',
    following: false,
    followBusy: false,
    onfollow: vi.fn(),
    onfilm: vi.fn(),
    filmOpen: over.filmOpen ?? false,
    filmPlaying: over.filmOpen ?? false,
  });
  app = mount(Showreel, { target: document.body, props });
  flushSync();
  return props;
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const current = () => q('[aria-current="true"] .reel__t')?.textContent;
const title = () => q('.reel__title')?.textContent?.trim();
const pointer = (type: string, target: Element, init: PointerEventInit) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, isPrimary: true, ...init })
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames = [];
  clock = 0;
  media = { reduced: false, desktop: true };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // A cancelAnimationFrame that cancels, as a browser's does.
  const queued = new Map<number, FrameRequestCallback>();
  let rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++rafId;
    const run: FrameRequestCallback = (now) => {
      queued.delete(id);
      callback(now);
    };
    queued.set(id, run);
    frames.push(run);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const run = queued.get(id);
    queued.delete(id);
    frames = frames.filter((queuedRun) => queuedRun !== run);
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion')
      ? media.reduced
      : query.includes('min-width')
        ? media.desktop
        : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersecting = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 390,
    height: 844,
    right: 390,
    bottom: 844,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.mocked(logger.warn).mockClear();
  hls.createHlsPlayer.mockClear();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Showreel layouts', () => {
  it('draws Corner: the playing piece lower left, the index with every entry, the org as the page heading', () => {
    render('corner');
    expect(q('.reel')?.dataset.layout).toBe('corner');
    expect(document.querySelectorAll('.reel__index .reel__item')).toHaveLength(
      3
    );
    expect(q('.reel__strip')).toBeNull();
    expect(q('h1')?.textContent).toBe('Of Blood & Bones');
    expect(current()).toBe('Of Blood & Bones');
    expect(q('.reel__kicker')?.textContent).toContain('Our film, 0:30');
    // Join sits top right, beside Follow (owner, 2026-11-19).
    expect(q('.reel__meta a')?.textContent).toBe('Join Of Blood & Bones');
  });

  it('draws Wide and the Name window with the strip along the foot', () => {
    render('wide');
    expect(document.querySelectorAll('.reel__strip .reel__item')).toHaveLength(
      3
    );
    expect(q('.reel__index')).toBeNull();
    unmount(app!);
    app = null;

    render('name');
    // The name is the window, and the page's one heading.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(q('h1')?.classList.contains('reel__window')).toBe(true);
    // The film's slide carries the org's line: the name is already the headline.
    expect(title()).toBe('Ancestral healing.');
  });

  it("labels the film's button by what a press plays (Codex-0hkkt)", () => {
    render('corner');
    expect(q('.reel__btn')?.textContent?.trim()).toBe('Play the preview');
    unmount(app!);
    app = null;
    render('corner', {
      reel: [
        { type: 'film', film: { ...FILM, fullFilm: true }, show: 'footage' },
        REEL[1],
      ],
    });
    expect(q('.reel__btn')?.textContent?.trim()).toBe('Watch our film, 0:30');
  });
});

describe('Showreel clock', () => {
  it('moves on after a piece, the words a beat behind', () => {
    render();
    frame(PIECE_MS - 100);
    expect(current()).toBe('Of Blood & Bones');
    frame(200);
    expect(current()).toBe('The Medicine of Grief');
    expect(title()).toBe('The Medicine of Grief');
  });

  it('pauses everything, the shader included, and plays again (WCAG 2.2.2)', () => {
    render();
    const pause = q<HTMLButtonElement>('.reel__ctl .reel__round');
    expect(pause?.getAttribute('aria-label')).toBe('Pause the reel');
    pause?.click();
    flushSync();
    // The label says what a press does next; a toggle's pressed state on
    // top would read "Play the reel, pressed" (WP-5 plan).
    expect(pause?.hasAttribute('aria-pressed')).toBe(false);
    expect(pause?.getAttribute('aria-label')).toBe('Play the reel');
    expect(shaderTone.held).toBe(true);
    frame(PIECE_MS * 2);
    expect(current()).toBe('Of Blood & Bones');
    pause?.click();
    flushSync();
    expect(shaderTone.held).toBe(false);
    frame(PIECE_MS + 100);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('holds while the mouse is over the words, never for a touch or the film', () => {
    render();
    const words = q('.reel__words') as HTMLElement;
    pointer('pointerenter', words, { pointerType: 'touch' });
    frame(PIECE_MS + 100);
    expect(current()).toBe('The Medicine of Grief');

    pointer('pointerenter', words, { pointerType: 'mouse' });
    frame(PIECE_MS * 2);
    expect(current()).toBe('The Medicine of Grief');
    pointer('pointerleave', words, { pointerType: 'mouse' });
    frame(PIECE_MS + 100);
    expect(current()).toBe('Fire Ceremony at Dusk');
  });

  it('holds while keyboard focus is inside, and while the hero is off screen', () => {
    // jsdom's :focus-visible tracks its own events; give the focused element
    // the verdict a browser gives keyboard focus. The e2e proves the real one.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string
    ) {
      return selector === ':focus-visible'
        ? this === document.activeElement
        : matches.call(this, selector);
    });
    render();
    q<HTMLButtonElement>('.reel__index .reel__item')?.focus();
    flushSync();
    frame(PIECE_MS * 2);
    expect(current()).toBe('Of Blood & Bones');
    q<HTMLButtonElement>('.reel__index .reel__item')?.blur();
    flushSync();

    intersecting?.([{ isIntersecting: false }]);
    flushSync();
    frame(PIECE_MS * 2);
    expect(current()).toBe('Of Blood & Bones');
  });

  it("never holds for a click's focus, or Play would wait for a click elsewhere", () => {
    render();
    const pause = q<HTMLButtonElement>(
      '.reel__ctl .reel__round'
    ) as HTMLButtonElement;
    // A mouse click focuses the button without :focus-visible.
    pause.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    frame(PIECE_MS + 100);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('holds while the mouse rests on the pause, as over the index it sits by', () => {
    render();
    const pause = pauseButton() as HTMLElement;
    pointer('pointerenter', pause, { pointerType: 'mouse' });
    frame(PIECE_MS + 100);
    expect(current()).toBe('Of Blood & Bones');
    pointer('pointerleave', pause, { pointerType: 'mouse' });
    frame(PIECE_MS + 100);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('plays the piece its index names', () => {
    render();
    document
      .querySelectorAll<HTMLButtonElement>('.reel__index .reel__item')[2]
      ?.click();
    frame(16);
    expect(current()).toBe('Fire Ceremony at Dusk');
  });
});

describe('Showreel on a phone', () => {
  const tap = (x: number, moveBy = 0, holdMs = 0) => {
    const at = q('.reel__scrim-foot') as HTMLElement;
    pointer('pointerdown', at, {
      pointerType: 'touch',
      clientX: x,
      clientY: 400,
    });
    if (moveBy)
      pointer('pointermove', at, {
        pointerType: 'touch',
        clientX: x + moveBy,
        clientY: 400,
      });
    vi.advanceTimersByTime(holdMs);
    pointer('pointerup', at, {
      pointerType: 'touch',
      clientX: x + moveBy,
      clientY: 400,
    });
    frame(16);
  };

  beforeEach(() => {
    media.desktop = false;
  });

  it('moves on with a tap on the right, back with one on the left third', () => {
    render();
    tap(300);
    expect(title()).toBe('The Medicine of Grief');
    tap(60);
    expect(title()).toBe('Of Blood & Bones');
  });

  it('takes a sideways swipe for the pointer, never as a tap', () => {
    render();
    tap(300, 40);
    expect(title()).toBe('Of Blood & Bones');
  });

  it('holds while pressed and held, and the release is no tap', () => {
    render();
    const at = q('.reel__scrim-foot') as HTMLElement;
    pointer('pointerdown', at, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    vi.advanceTimersByTime(400);
    frame(PIECE_MS * 2);
    expect(title()).toBe('Of Blood & Bones');
    pointer('pointerup', at, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    frame(16);
    expect(title()).toBe('Of Blood & Bones');
    frame(PIECE_MS + 100);
    expect(title()).toBe('The Medicine of Grief');
  });

  it('never takes a press on a button as a tap', () => {
    render();
    const button = q('.reel__btn') as HTMLElement;
    pointer('pointerdown', button, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    pointer('pointerup', button, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    frame(16);
    expect(title()).toBe('Of Blood & Bones');
  });
});

describe('Showreel paths', () => {
  it('reduced motion: stills, no video, no moving on, the shader held; the index still changes piece', () => {
    media.reduced = true;
    render();
    expect(q('.reel')?.dataset.mode).toBe('static');
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(shaderTone.held).toBe(true);
    frame(PIECE_MS * 2);
    expect(current()).toBe('Of Blood & Bones');
    document
      .querySelectorAll<HTMLButtonElement>('.reel__index .reel__item')[1]
      ?.click();
    frame(16);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('loop off is the static path too (owner Q6)', () => {
    render('corner', { loop: 'off' });
    expect(q('.reel')?.dataset.mode).toBe('static');
    expect(shaderTone.held).toBe(true);
  });

  it('Save-Data: stills that still move on (owner, 2026-11-19)', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      connection: { saveData: true },
    });
    render();
    flushSync();
    expect(q('.reel')?.dataset.mode).toBe('stills');
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(shaderTone.held).toBe(false);
    frame(PIECE_MS + 100);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('keeps the source film in the page, invisible to assistive tech, muted and CORS-clean', () => {
    render();
    const video = q<HTMLVideoElement>('.reel-stage video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.getAttribute('crossorigin')).toBe('anonymous');
    expect(video?.closest('[aria-hidden="true"]')).not.toBeNull();
    // The first still is in the server HTML, for the first paint.
    expect(
      q<HTMLImageElement>('.reel-stage img')?.getAttribute('fetchpriority')
    ).toBe('high');
  });
});

describe('Showreel and the window’s shader', () => {
  it("tells it the layout's film frame, the stage, and the still once it loads", () => {
    render('corner');
    // The band at its default: the film gives way at its foot (owner, V1),
    // and no surface over it (owner, 2026-11-21, 5b).
    expect(showreelFeed.look).toMatchObject({
      frame: 'film-fill',
      band: 'fade',
      surface: 'none',
    });
    expect(showreelFeed.stage).not.toBeNull();
    const still = q<HTMLImageElement>('.reel-stage__item[data-on] img');
    still?.dispatchEvent(new Event('load'));
    flushSync();
    expect(showreelFeed.media).toBe(still);
  });

  it('asks for the film through the name in the Name window', () => {
    render('name');
    expect(showreelFeed.look).toMatchObject({
      frame: 'film-name',
      band: 'fade',
    });
  });

  it('hands it the video once it has a frame, and lets go of everything on unmount', async () => {
    render();
    await vi.dynamicImportSettled();
    const video = q<HTMLVideoElement>(
      '.reel-stage__item[data-on] video'
    ) as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    flushSync();
    expect(showreelFeed.media).toBe(video);
    unmount(app!);
    app = null;
    expect(showreelFeed.media).toBeNull();
    expect(showreelFeed.stage).toBeNull();
    expect(showreelFeed.look).toBeNull();
    expect(showreelFeed.mask).toBeNull();
  });

  it('builds no player for a film torn down while hls.js loads', async () => {
    render();
    // Gone before the player's module arrives: a cut or a restart re-runs
    // the attachment on the same element, and a late player would fight it.
    unmount(app!);
    app = null;
    await vi.dynamicImportSettled();
    expect(hls.createHlsPlayer).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('restarts the film after iOS’s decode error, the poster meanwhile; twice, then the still for good', async () => {
    render();
    await vi.dynamicImportSettled();
    const fail = () => {
      const video = q<HTMLVideoElement>('.reel-stage__item[data-on] video');
      if (!video) return false;
      Object.defineProperty(video, 'error', {
        configurable: true,
        value: { code: 3 },
      });
      video.dispatchEvent(new Event('error'));
      flushSync();
      return true;
    };
    const still = q<HTMLImageElement>('.reel-stage__item[data-on] img');
    still?.dispatchEvent(new Event('load'));
    const video = q<HTMLVideoElement>(
      '.reel-stage__item[data-on] video'
    ) as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    flushSync();
    expect(showreelFeed.media).toBe(video);

    expect(fail()).toBe(true);
    // The poster meanwhile, and a new player.
    expect(showreelFeed.media).toBe(still);
    await vi.dynamicImportSettled();
    expect(hls.createHlsPlayer).toHaveBeenCalledTimes(2);
    const restarted = vi
      .mocked(logger.warn)
      .mock.calls.filter(([e]) => e === 'showreel.footage_restarted');
    expect(restarted).toHaveLength(1);

    fail();
    await vi.dynamicImportSettled();
    fail();
    expect(
      vi
        .mocked(logger.warn)
        .mock.calls.filter(([e]) => e === 'showreel.footage_failed')
    ).toHaveLength(1);
    expect(q('.reel-stage__item[data-on] video')).toBeNull();
    expect(showreelFeed.media).toBe(still);
  });
});

const LOGO = 'http://localhost:4100/org/logo.png';
const footage = (title: string): ReelEntry => ({
  type: 'piece',
  piece: piece(title, {
    kind: 'video',
    previewUrl: `http://localhost:4100/org/hls/${title.length}/index.m3u8`,
  }),
  show: 'footage',
});
const FOOTAGE: ReelEntry[] = [
  { type: 'film', film: FILM, show: 'footage' },
  footage('Bone Deep'),
  footage('River Songs'),
];
const videoOf = (i: number) =>
  document
    .querySelectorAll('.reel-stage__item')
    [i]?.querySelector<HTMLVideoElement>('video') ?? null;
const pauseButton = () => q<HTMLButtonElement>('.reel__ctl .reel__round');
const pick = (i: number) => {
  document
    .querySelectorAll<HTMLButtonElement>('.reel__index .reel__item')
    [i]?.click();
  frame(16);
};
/**
 * Two films attach at once here (the one on show and the next), and vitest
 * hands the second lazy `import()` of the mocked hls module the REAL one
 * (proven: the first player came from the stand-in, the second set the
 * element's own `src`). In jsdom the real one finds no MediaSource and
 * fails; with native HLS to fall back on, either path plays.
 */
function playersOnEitherPath() {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
}
/** hls.js's module, then the players' promises, then what they set. */
async function settle() {
  await vi.dynamicImportSettled();
  for (let k = 0; k < 10; k++) await Promise.resolve();
  flushSync();
}

describe('Showreel keeps what the visitor chose', () => {
  it('keeps a pause, a hold and the piece on show when the page hands the same reel over anew (WCAG 2.2.2)', () => {
    const props = render();
    pick(1);
    const index = q('.reel__index') as HTMLElement;
    pointer('pointerenter', index, { pointerType: 'mouse' });
    pauseButton()?.click();
    flushSync();

    // A tab return, or the activity poll: the landing's data again, a new array.
    props.reel = [...props.reel];
    flushSync();
    expect(pauseButton()?.getAttribute('aria-label')).toBe('Play the reel');
    expect(shaderTone.held).toBe(true);
    expect(current()).toBe('The Medicine of Grief');

    // Played again, the pointer still holds it; gone, the reel moves on.
    pauseButton()?.click();
    frame(PIECE_MS * 2);
    expect(current()).toBe('The Medicine of Grief');
    pointer('pointerleave', index, { pointerType: 'mouse' });
    frame(PIECE_MS + 100);
    expect(current()).toBe('Fire Ceremony at Dusk');
  });

  it('follows a changed reel by its pieces: the one on show plays on where it now is', () => {
    const props = render();
    pick(1);
    // Reordered: a fresh clock would start the first, Fire Ceremony at Dusk.
    props.reel = [...props.reel].reverse();
    frame(16);
    expect(current()).toBe('The Medicine of Grief');
  });

  it('shows the same piece, its film playing on, when a refresh adds one before it', async () => {
    playersOnEitherPath();
    const props = render('corner', { reel: FOOTAGE });
    await settle();
    pick(2);
    await settle();
    expect(title()).toBe('River Songs');
    const playing = videoOf(2) as HTMLVideoElement;
    let at = 7;
    Object.defineProperty(playing, 'currentTime', {
      configurable: true,
      get: () => at,
      set: (value: number) => {
        at = value;
      },
    });
    // Newly featured between the visit's load and a tab return.
    props.reel = [
      FOOTAGE[0] as ReelEntry,
      footage('A New Film'),
      FOOTAGE[1] as ReelEntry,
      FOOTAGE[2] as ReelEntry,
    ];
    flushSync();
    expect(title()).toBe('River Songs');
    expect(q('.reel__words')?.dataset.swap).not.toBe('out');
    // The stage keeps its element for it, on show, and never restarts it.
    expect(videoOf(3)).toBe(playing);
    expect(q('.reel-stage__item[data-on] video')).toBe(playing);
    frame(16);
    expect(at).toBe(7);
  });

  it('keys entries that share an href apart, so the stage can tell them apart', () => {
    render('corner', {
      reel: [REEL[1] as ReelEntry, REEL[1] as ReelEntry, REEL[2] as ReelEntry],
    });
    expect(document.querySelectorAll('.reel-stage__item')).toHaveLength(3);
  });

  it('brings the words back after two quick picks, there and back', () => {
    render();
    const items = document.querySelectorAll<HTMLButtonElement>(
      '.reel__index .reel__item'
    );
    items[1]?.click();
    flushSync();
    // Within the 200 ms the words take to go out.
    items[0]?.click();
    flushSync();
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(q('.reel__words')?.dataset.swap).not.toBe('out');
  });

  it("starts a picked piece's bar from 0 while the pointer holds the reel", () => {
    render();
    frame(PIECE_MS / 2);
    const root = q('.reel') as HTMLElement;
    const progress = () => Number(root.style.getPropertyValue('--_progress'));
    expect(progress()).toBeGreaterThan(0.4);
    pointer('pointerenter', q('.reel__index') as HTMLElement, {
      pointerType: 'mouse',
    });
    pick(2);
    expect(progress()).toBe(0);
  });

  it('puts the one pause first in the tab order, in every layout', () => {
    for (const layout of ['corner', 'wide', 'name'] as const) {
      render(layout);
      const stops = q('.reel__inner')?.querySelectorAll('button, a[href]');
      expect(stops?.[0], layout).toBe(pauseButton());
      expect(document.querySelectorAll('.reel__round'), layout).toHaveLength(1);
      unmount(app!);
      app = null;
      document.body.innerHTML = '';
    }
  });
});

describe('Showreel and the film playing', () => {
  it("holds on a phone while the film plays in the pop-up, so the page's focus goes back to its button", () => {
    media.desktop = false;
    // "Watch our film": the page's own player, IntroVideoModal on a phone
    // (filmOpen stays false). A preview with no full film is the reel's own
    // theatre's (Codex-1yd58.8).
    const props = render('corner', {
      reel: [
        { type: 'film', film: { ...FILM, fullFilm: true }, show: 'footage' },
        ...REEL.slice(1),
      ],
    });
    vi.mocked(props.onfilm).mockImplementation(() => {
      props.filmPlaying = true;
    });
    const button = q<HTMLButtonElement>('.reel__words .reel__btn');
    button?.click();
    frame(PIECE_MS + 100);
    expect(button?.isConnected).toBe(true);
    expect(title()).toBe('Of Blood & Bones');

    // Closed, the reel moves on again.
    props.filmPlaying = false;
    frame(PIECE_MS + 100);
    expect(title()).toBe('The Medicine of Grief');
  });
});

describe('Showreel names the org as the hero says', () => {
  it('keeps the name for screen readers only while the logo leads alone', () => {
    render('corner', { facts: { hideTitle: true }, logoUrl: LOGO });
    const name = q('.reel__name');
    expect(name?.classList.contains('sr-only')).toBe(true);
    expect(name?.textContent).toBe('Of Blood & Bones');
    expect(q('.reel__sig img')?.getAttribute('src')).toBe(LOGO);
  });

  it("hands a logo that fails to the hero's own handler, and leads with the name once it goes", () => {
    const props = render('corner', {
      facts: { hideTitle: true },
      logoUrl: LOGO,
    });
    q('.reel__sig img')?.dispatchEvent(new Event('error'));
    expect(props.onlogofail).toHaveBeenCalledTimes(1);
    // OrgHero's answer to it: no logo.
    props.logoUrl = '';
    flushSync();
    expect(q('.reel__sig img')).toBeNull();
    expect(q('.reel__name')?.classList.contains('sr-only')).toBe(false);
  });

  it('shows the name with the logo, and alone when there is no logo to lead', () => {
    render('corner', { logoUrl: LOGO });
    expect(q('.reel__name')?.classList.contains('sr-only')).toBe(false);
    unmount(app!);
    app = null;
    document.body.innerHTML = '';
    render('corner', { facts: { hideTitle: true }, logoUrl: '' });
    expect(q('.reel__name')?.classList.contains('sr-only')).toBe(false);
  });

  it("draws the Name window's letters in ink for a piece with no still", () => {
    render('name', {
      reel: [
        ...REEL.slice(0, 2),
        {
          type: 'piece',
          piece: piece('No Picture', { imageUrl: null }),
          show: 'still',
        },
      ],
    });
    const window = () => q('.reel__window');
    expect(window()?.hasAttribute('data-still')).toBe(true);
    document
      .querySelectorAll<HTMLButtonElement>('.reel__strip .reel__item')[2]
      ?.click();
    frame(16);
    expect(window()?.hasAttribute('data-still')).toBe(false);
  });
});

describe('Showreel on a phone: the press', () => {
  it('pauses the footage and the shader while a press holds, as the owner chose', async () => {
    media.desktop = false;
    render();
    await settle();
    const video = videoOf(0) as HTMLVideoElement;
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);
    paused.mockClear();
    const foot = q('.reel__scrim-foot') as HTMLElement;
    pointer('pointerdown', foot, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    vi.advanceTimersByTime(400);
    flushSync();
    expect(shaderTone.held).toBe(true);
    expect(paused.mock.contexts).toContain(video);
    pointer('pointerup', foot, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    flushSync();
    expect(shaderTone.held).toBe(false);
    expect(title()).toBe('Of Blood & Bones');
  });
});

describe('Showreel stage: the films', () => {
  it('keeps the film it preloaded for the cut: no teardown, no rebuild', async () => {
    playersOnEitherPath();
    render('corner', { reel: FOOTAGE });
    await settle();
    const ahead = videoOf(1) as HTMLVideoElement;
    // The next piece's film has its first frame before the cut.
    ahead.dispatchEvent(new Event('loadeddata'));
    flushSync();
    expect(ahead.hasAttribute('data-framed')).toBe(true);

    frame(PIECE_MS + 100);
    await settle();
    expect(current()).toBe('Bone Deep');
    // A teardown would have dropped its frame; it is what the canvas shows.
    expect(ahead.hasAttribute('data-framed')).toBe(true);
    expect(showreelFeed.media).toBe(ahead);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('shows the still, never a frozen first frame, when the browser refuses to play', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValue(
      new DOMException('Low Power Mode', 'NotAllowedError')
    );
    vi.mocked(logger.debug).mockClear();
    render();
    await settle();
    const still = q<HTMLImageElement>('.reel-stage__item[data-on] img');
    still?.dispatchEvent(new Event('load'));
    const video = videoOf(0) as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    await settle();
    expect(showreelFeed.media).toBe(still);
    expect(video.hasAttribute('data-framed')).toBe(false);
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      'showreel.footage_refused',
      { reason: 'NotAllowedError' }
    );
  });

  it('plays a refused film from a tap, on a reel with nothing else to tap on to', async () => {
    media.desktop = false;
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValue(
      new DOMException('Low Power Mode', 'NotAllowedError')
    );
    render('corner', { reel: [FOOTAGE[0] as ReelEntry] });
    await settle();
    const video = videoOf(0) as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    await settle();
    expect(video.hasAttribute('data-framed')).toBe(false);

    play.mockClear();
    play.mockResolvedValue(undefined);
    const at = q('.reel__scrim-foot') as HTMLElement;
    pointer('pointerdown', at, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    pointer('pointerup', at, {
      pointerType: 'touch',
      clientX: 300,
      clientY: 400,
    });
    // Within the tap's own handler, the gesture the refusal waits for.
    expect(play).toHaveBeenCalledTimes(1);
    await settle();
    expect(video.hasAttribute('data-framed')).toBe(true);
  });

  it('keeps the film for a play cut short by a pause or a cut, which refused nothing', async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValue(new DOMException('Interrupted', 'AbortError'));
    render();
    await settle();
    const video = videoOf(0) as HTMLVideoElement;
    video.dispatchEvent(new Event('loadeddata'));
    await settle();
    expect(showreelFeed.media).toBe(video);
  });

  it('starts a piece reached while paused from its start, once play comes', async () => {
    playersOnEitherPath();
    render('corner', { reel: FOOTAGE });
    await settle();
    const next = videoOf(1) as HTMLVideoElement;
    // Mid-film from its last time round.
    let at = 5;
    Object.defineProperty(next, 'currentTime', {
      configurable: true,
      get: () => at,
      set: (value: number) => {
        at = value;
      },
    });
    pauseButton()?.click();
    pick(1);
    expect(at).toBe(5);
    pauseButton()?.click();
    flushSync();
    expect(at).toBe(0);
  });
});

describe('Showreel and the peek (owner, 2026-11-21: on by default)', () => {
  it('stops the hero a lift short of the screen by default, so the featured row rises above the fold', () => {
    render();
    expect(q('.reel')?.hasAttribute('data-peek')).toBe(true);
  });

  it('fills the screen when the org has no featured row to rise', () => {
    render('corner', { facts: { hasFeatured: false } });
    expect(q('.reel')?.hasAttribute('data-peek')).toBe(false);
  });

  it('fills the screen when the creator turns the peek off', () => {
    render('corner', { peek: 'off' });
    expect(q('.reel')?.hasAttribute('data-peek')).toBe(false);
  });
});

describe('Showreel stage: the push-in where the page draws the film (WP-5b)', () => {
  it("pushes the still on show in by default, by the compositor's numbers, on the reel's clock", () => {
    render();
    const stage = q('.reel-stage');
    expect(stage?.hasAttribute('data-push')).toBe(true);
    expect(stage?.style.getPropertyValue('--_push-depth')).toBe(
      String(PUSH_DEPTH)
    );
    // A push takes one piece: the reel's progress through it, as it is.
    expect(Number(stage?.style.getPropertyValue('--_push-rate'))).toBe(
      PIECE_MS / 1000 / PUSH_SECONDS
    );
    expect(Number(stage?.style.getPropertyValue('--_push-rate'))).toBe(1);
  });

  it('pushes no still in with the reel held still (reduced motion)', () => {
    media.reduced = true;
    render();
    expect(q('.reel-stage')?.hasAttribute('data-push')).toBe(false);
  });

  it('pushes no still in when the creator turns the push-in off', () => {
    render('corner', { push: 'off' });
    expect(q('.reel-stage')?.hasAttribute('data-push')).toBe(false);
  });
});

describe('Showreel push-in follows the piece on show (WP-5b review r2, M1r2)', () => {
  /**
   * Save-Data: every entry shows its still and the reel still moves on, so
   * every piece pushes in. Then 16 ms frames, the words' timer advancing
   * alongside as a browser runs them, through the first piece's end and the
   * beat (OUT_MS) the words and the stage take to follow the clock.
   */
  function throughTheCut(read: () => { el: unknown; at: number }) {
    vi.stubGlobal('navigator', {
      ...navigator,
      connection: { saveData: true },
    });
    render();
    flushSync();
    expect(q('.reel')?.dataset.mode).toBe('stills');
    for (const img of document.querySelectorAll<HTMLImageElement>(
      '.reel-stage img'
    )) {
      img.dispatchEvent(new Event('load'));
    }
    flushSync();
    const one = () => {
      flushSync();
      clock += 16;
      const due = frames;
      frames = [];
      for (const callback of due) callback(clock);
      flushSync();
      vi.advanceTimersByTime(16);
      flushSync();
    };
    let last: { el: unknown; at: number } | null = null;
    const backwards: string[] = [];
    let cut = false;
    for (let t = 0; t < PIECE_MS + 600; t += 16) {
      one();
      const now = read();
      if (now.el && last && last.el === now.el && now.at < last.at - 1e-9) {
        backwards.push(
          `${t} ms: ${last.at.toFixed(4)} -> ${now.at.toFixed(4)}`
        );
      }
      if (last && last.el !== now.el) cut = true;
      last = now;
    }
    // The cut came, and the next piece starts near 0, never a held full push.
    expect(cut).toBe(true);
    expect(last?.at ?? 1).toBeLessThan(0.5);
    return backwards;
  }

  it('never zooms the canvas still back out while that same still is on show', () => {
    const backwards = throughTheCut(() => ({
      el: showreelFeed.media,
      // What the compositor reads each frame (media-pass.ts `planMedia`).
      at: pushZoom(showreelFeed.look?.push?.() ?? 0) - 1,
    }));
    // Before: ['7008 ms: 0.0800 -> 0.0004'] or near: the old still snapped
    // back out for OUT_MS before the cut.
    expect(backwards).toEqual([]);
  });

  it("never draws the page's own still back out while it is on show", () => {
    const backwards = throughTheCut(() => ({
      el: q('.reel-stage__item[data-on] img'),
      // What the stage's push-in reads (ReelStage: `--_push-progress`).
      at: Number(q('.reel')?.style.getPropertyValue('--_push-progress') || 0),
    }));
    expect(backwards).toEqual([]);
  });
});

describe('Showreel and a webfont that lands late', () => {
  it('fits again when a face finishes loading after fonts.ready, and marks the fit after the fonts', async () => {
    // A page's FontFaceSet whose `ready` resolved before the brand's face had
    // begun to load (a fast hydration): the face then lands on its own.
    const faces = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
      status: 'loaded',
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: faces,
    });
    try {
      paintable({ ground: '#0F0000', ink: WHITE });
      render('corner');
      await faces.ready;
      await Promise.resolve();
      frame(32);
      const reel = q('.reel');
      expect(reel?.hasAttribute('data-fit')).toBe(true);
      // Calibration: some other font event asks for no fit.
      const settled = frames.length;
      faces.dispatchEvent(new Event('loading'));
      expect(frames.length).toBe(settled);
      // The late face: one fit asked for, in the next frame.
      faces.dispatchEvent(new Event('loadingdone'));
      expect(frames.length).toBe(settled + 1);
      // Unmounted, a late face asks for nothing.
      if (app) unmount(app);
      app = null;
      const gone = frames.length;
      faces.dispatchEvent(new Event('loadingdone'));
      expect(frames.length).toBe(gone);
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });
});

describe('Showreel and a film playing over it', () => {
  it('pauses its own footage while the film plays, and plays it again after, so a page never decodes two films at once', async () => {
    media.desktop = false;
    const props = render();
    await settle();
    const video = videoOf(0) as HTMLVideoElement;
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    paused.mockClear();
    props.filmPlaying = true;
    flushSync();
    expect(paused.mock.contexts).toContain(video);
    play.mockClear();
    props.filmPlaying = false;
    flushSync();
    expect(play.mock.contexts).toContain(video);
  });
});

/**
 * The fit as a browser runs it, in jsdom: a 2d context that parses `rgb()`
 * and `#hex` as a canvas does (the fit's colour probe), and each element's
 * computed colour as a browser cascades it here: its own inline colour first
 * (a lift's `!important`), then a brand colour by selector, then the reel's
 * ink; the root's `--color-background` is the brand's ground, and its `--_gy`
 * the ground's luminance when given (unset, it reads dark, as CSS's
 * `var(--_gy, 0)` does).
 *
 * `easeFrom(nodes)` starts each node's colour easing back from what it wears
 * now, as a link's `--transition-colors` would once its lift comes off: it
 * reads as that start value until it lands, as Chrome does (calibrated
 * 2026-11-21), listed meanwhile by `getAnimations({ subtree })` as a colour
 * transition, which `finish()` lands. `eases()` counts the eases still running.
 */
function paintable({
  ground,
  ink,
  brand = {},
  groundY = '',
}: {
  ground: string;
  ink: string;
  brand?: Record<string, string>;
  groundY?: string;
}) {
  const easing = new Map<Element, string>();
  const parse = (css: string): [number, number, number, number] | null => {
    const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
    if (hex?.[1]) {
      const n = Number.parseInt(hex[1], 16);
      return [n >> 16, (n >> 8) & 255, n & 255, 1];
    }
    const fn =
      /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
        css.trim()
      );
    if (!fn) return null;
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Number(fn[4] ?? 1)];
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let fill = '#010203';
    let px: [number, number, number, number] = [0, 0, 0, 0];
    const context = {
      clearRect() {},
      get fillStyle() {
        return fill;
      },
      set fillStyle(value: string) {
        if (parse(value)) fill = value;
      },
      fillRect() {
        px = parse(fill) ?? px;
      },
      getImageData: () => ({
        data: [px[0], px[1], px[2], Math.round(px[3] * 255)],
      }),
      measureText: () => ({ width: 100 }),
      font: '',
    };
    return context as unknown as CanvasRenderingContext2D;
  });
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    const colour = () => {
      const inline = (el as HTMLElement).style?.getPropertyValue('color');
      if (inline) return inline;
      const from = easing.get(el);
      if (from) return from;
      for (const [selector, value] of Object.entries(brand)) {
        if (el.matches(selector)) return value;
      }
      return ink;
    };
    return new Proxy(style, {
      get(target, prop) {
        if (prop === 'color') return colour();
        if (prop === 'getPropertyValue') {
          return (name: string) => {
            if (el.matches('.reel')) {
              if (name === '--color-background') return ground;
              if (name === '--_gy' && groundY) return groundY;
            }
            return target.getPropertyValue(name);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  // jsdom has no Web Animations: the colour eases alone, as CSSTransitions.
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value(this: Element, options?: GetAnimationsOptions) {
      return [...easing.keys()]
        .filter(
          (node) => node === this || (options?.subtree && this.contains(node))
        )
        .map((node) => ({
          transitionProperty: 'color',
          finish: () => easing.delete(node),
        }));
    },
  });
  return {
    easeFrom(nodes: Iterable<Element>) {
      for (const node of nodes) {
        const now = (node as HTMLElement).style.getPropertyValue('color');
        if (now) easing.set(node, now);
      }
    },
    eases: () => easing.size,
  };
}

/** One more fit, as a colour landing asks for one. */
function refit() {
  const reel = q('.reel');
  const landed = new Event('transitionend', { bubbles: true });
  Object.defineProperty(landed, 'propertyName', { value: 'color' });
  reel?.dispatchEvent(landed);
  frame(32);
}

/** The reel's solved tint and pool as it last wrote them. */
const solved = () => {
  const reel = q('.reel');
  return {
    scrim: reel?.style.getPropertyValue('--_scrim') ?? '',
    pool: reel?.style.getPropertyValue('--_pool') ?? '',
  };
};

const RED = 'rgb(203, 33, 60)';
const WHITE = 'rgb(255, 255, 255)';

describe("Showreel's fit over the film", () => {
  for (const [label, ground] of [
    ["OBB's dark", '#0F0000'],
    ['a navy', '#1E285A'],
  ] as const) {
    it(`is the same fit every time on ${label}, its own lifts never read as the brand's colour`, async () => {
      paintable({
        ground,
        ink: WHITE,
        brand: { '.reel__name, .reel__kicker, .reel__kicker *': RED },
      });
      render('corner');
      await Promise.resolve();
      frame(32);
      const first = solved();
      expect(first.scrim).not.toBe('');
      for (let n = 2; n <= 5; n++) {
        refit();
        expect(solved()).toEqual(first);
      }
      // A word was lifted, so the pool holds what the lifted words need:
      // never a solid scrim taken silently for the red.
      expect(document.querySelector('[data-lifted]')).not.toBeNull();
      expect(first.pool).not.toBe('1');
    });
  }

  it("rescues a brand colour that IS the reel's ink: lifted toward the pole, never toward itself", async () => {
    // The creator set the player's text to the brand's red: the reel's own
    // ink is the red, so a lift toward the ink would go nowhere. Its soft
    // ink stays the player's white at 80% (the next test drops even that).
    paintable({
      ground: '#0F0000',
      ink: RED,
      brand: { '.reel__line, .reel__kicker span': 'rgba(255, 255, 255, 0.8)' },
    });
    render('corner');
    await Promise.resolve();
    frame(32);
    const name = q('.reel__name');
    const lifted = name?.style.getPropertyValue('color') ?? '';
    expect(lifted).not.toBe('');
    // Toward white: every channel at least the red's, and lighter overall.
    const [r = 0, g = 0, b = 0] = (lifted.match(/[\d.]+/g) ?? []).map(Number);
    expect(r).toBeGreaterThanOrEqual(203);
    expect(g).toBeGreaterThan(33);
    expect(b).toBeGreaterThan(60);
    // The controls' own labels too. Follow's (4.5:1) red is more than any
    // fill of the dark can carry: lifted. The pause icon's (3:1) red its fill
    // can carry (3.82:1 on the dark): kept. Nothing reported as drawn solid.
    const follow = q('.reel__ghost');
    const pause = q('.reel__round');
    expect(follow?.hasAttribute('data-lifted')).toBe(true);
    expect(follow?.style.getPropertyValue('color')).not.toBe(RED);
    expect(pause?.hasAttribute('data-lifted')).toBe(false);
    expect(pause?.style.getPropertyValue('--_halo')).not.toBe('');
    // Whether the shades then carry each word is the probes' (review R4): this
    // DOM lays every word over the whole box, where no corner reaches, and the
    // once-a-page-load report for this ground may already have gone.
    expect(solved().pool).not.toBe('1');
  });

  /** An element's colour as the fit wrote it inline: its channels. */
  const channels = (el: Element) =>
    ((el as HTMLElement).style.getPropertyValue('color').match(/[\d.]+/g) ?? [])
      .slice(0, 3)
      .map(Number);
  const scrimChannels = () =>
    (solved().scrim.match(/[\d.]+/g) ?? []).map(Number);

  it('keeps a dark veil when EVERY ink is the red (#CB213C on #0F0000), and lifts every word that fails toward white (owner, 2026-11-21)', async () => {
    // The player text is the red, and nothing gives any word another colour:
    // every word, control and soft ink is the red. Read from the inks, the
    // veil paled toward white for it; read from the ground, it stays dark.
    paintable({ ground: '#0F0000', ink: RED });
    render('corner');
    await Promise.resolve();
    frame(32);
    const [sr = 255, sg = 255, sb = 255] = scrimChannels();
    expect(sr).toBeLessThanOrEqual(15);
    expect(sg).toBe(0);
    expect(sb).toBe(0);
    // Every body word fails as the red (3.82:1 even on black): each one is
    // lifted, and toward white, every channel at least the red's.
    const words = [...document.querySelectorAll('.reel [data-ink="body"]')];
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.hasAttribute('data-lifted'), word.className).toBe(true);
      const [r = 0, g = 0, b = 0] = channels(word);
      expect(r).toBeGreaterThanOrEqual(203);
      expect(g).toBeGreaterThan(33);
      expect(b).toBeGreaterThan(60);
    }
    // Nothing anywhere is lifted toward anything but white.
    for (const lifted of document.querySelectorAll('[data-lifted]')) {
      const [r = 0, g = 0, b = 0] = channels(lifted);
      expect(r).toBeGreaterThanOrEqual(203);
      expect(g).toBeGreaterThanOrEqual(33);
      expect(b).toBeGreaterThanOrEqual(60);
    }
    // Whether the shades then carry each word is the probes' (review R4), as
    // in the rescue above.
    expect(solved().pool).not.toBe('1');
  });

  it('keeps a pale veil when every ink is white on a light brand, and lifts every word toward black: the mirror', async () => {
    paintable({ ground: '#F5F0E6', ink: WHITE, groundY: '0.87' });
    render('corner');
    await Promise.resolve();
    frame(32);
    // The brand's own pale ground, or paler: never deepened for the white.
    const [sr = 0, sg = 0, sb = 0] = scrimChannels();
    expect(sr).toBeGreaterThanOrEqual(245);
    expect(sg).toBeGreaterThanOrEqual(240);
    expect(sb).toBeGreaterThanOrEqual(230);
    const words = [...document.querySelectorAll('.reel [data-ink="body"]')];
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(word.hasAttribute('data-lifted'), word.className).toBe(true);
      const [r = 255, g = 255, b = 255] = channels(word);
      // Toward black: one grey, darker than the white it was.
      expect(r).toBeLessThan(255);
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
    // Whether the shades then carry each word is the probes' (Tide, grey):
    // this DOM lays every word over the whole box, where no corner reaches.
    expect(solved().pool).not.toBe('1');
  });

  it('never takes a link still easing back from its lift for the brand colour: it lands the ease, keeps the lift, and the fit holds (review R1)', async () => {
    const paint = paintable({
      ground: '#0F0000',
      ink: WHITE,
      brand: { a: RED },
    });
    render('corner');
    await Promise.resolve();
    frame(32);
    const first = solved();
    const links = [...document.querySelectorAll('.reel a[data-lifted]')];
    expect(links.length).toBeGreaterThan(0);
    const lifts = links.map((a) =>
      (a as HTMLElement).style.getPropertyValue('color')
    );
    for (let n = 0; n < 3; n++) {
      // The lift comes off, and the link reads as it still: its ease's start.
      paint.easeFrom(links);
      refit();
      // Landed at once, so the fit read the brand's red, and lifted it again.
      expect(paint.eases()).toBe(0);
      expect(solved()).toEqual(first);
      expect(links.every((a) => a.hasAttribute('data-lifted'))).toBe(true);
      expect(
        links.map((a) => (a as HTMLElement).style.getPropertyValue('color'))
      ).toEqual(lifts);
    }
  });

  it("fits again when a colour lands, never when a lift's own does: no fit asks for the next (review R1)", async () => {
    paintable({ ground: '#0F0000', ink: WHITE, brand: { a: RED } });
    render('corner');
    await Promise.resolve();
    frame(32);
    const link = q('.reel a[data-lifted]');
    expect(link).not.toBeNull();
    const fits = vi.spyOn(window, 'requestAnimationFrame');
    const lands = (target: Element | null) => {
      const landed = new Event('transitionend', { bubbles: true });
      Object.defineProperty(landed, 'propertyName', { value: 'color' });
      target?.dispatchEvent(landed);
    };
    const before = fits.mock.calls.length;
    lands(link);
    expect(fits.mock.calls.length).toBe(before);
    lands(q('.reel'));
    expect(fits.mock.calls.length).toBe(before + 1);
  });

  it('counts a shade that falls short as no solve: the word wears the pole, and the report comes once a page load (review R4, R6)', async () => {
    // Every word white on a light brand: lifted toward black. This DOM lays
    // each word over the whole box, out of every corner shade's reach, so
    // none is carried by its shades: each wears the pole outright.
    paintable({ ground: '#F2EDE4', ink: WHITE, groundY: '0.85' });
    render('corner');
    await Promise.resolve();
    frame(32);
    const words = [...document.querySelectorAll('.reel [data-ink="body"]')];
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(channels(word), word.className).toEqual([0, 0, 0]);
    }
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    // Every fit of the same brand finds the same: it says so once.
    for (let n = 0; n < 3; n++) refit();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
  });

  it('marks data-fit only when the fit has run: never on a page it could not read', async () => {
    paintable({ ground: '', ink: WHITE });
    render('corner');
    await Promise.resolve();
    frame(32);
    expect(q('.reel')?.hasAttribute('data-fit')).toBe(false);
    expect(solved().scrim).toBe('');
  });
});
