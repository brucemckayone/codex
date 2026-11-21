/**
 * The Showreel opens its theatre (Codex-1yd58.8; owner, 2026-11-20: "Open
 * the theatre"): with no full film, "Play the preview" opens it, in the
 * press's own tick so its player keeps the sound; "Watch our film" keeps the
 * page's own film player; any other piece with a preview offers "Preview with
 * sound". While it is open the reel holds, its words step aside and its stage
 * rests (a recording's piece leaves the canvas to the shader); at the
 * preview's end the reel carries on, and a close comes back to the same
 * piece. The player is ReelTheatre's stand-in (ReelTheatreCore.test.svelte).
 */

import type { IntroFilm } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import {
  type HeroFacts,
  type OrgHeroPiece,
  resolveHero,
} from '$lib/org-hero/hero-config';
import type { ReelEntry } from '$lib/org-hero/reel';
import { PIECE_MS } from '$lib/org-hero/showreel/reel-clock.svelte';
import { CUT_TIMING } from '$lib/org-hero/showreel/reel-reveal';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/environment', () => ({ browser: true, dev: true }));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/components/player/load-core', async () => {
  const { default: Stub } = await import(
    '$lib/components/org-hero/showreel/ReelTheatreCore.test.svelte'
  );
  return {
    preloadPlayerOnIntent: () => {},
    loadedPlayerCore: () => Stub,
    loadPlayerCore: async () => Stub,
  };
});
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: vi.fn() })),
}));

// Loaded once up front: the stage's own import then finds the stand-in.
await import('$lib/components/VideoPlayer/hls');
const { resetCore, seen } = await import(
  '$lib/components/org-hero/showreel/theatre-core-stub.svelte'
);
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
  previewUrl: 'http://localhost:4100/org/hls/film/preview/preview.m3u8',
  durationSeconds: 30,
  fullFilm: false,
};
const DRUM_PREVIEW = 'http://localhost:4100/org/hls/drum/preview/preview.m3u8';
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
const reelWith = (film: IntroFilm): ReelEntry[] => [
  { type: 'film', film, show: 'footage' },
  {
    type: 'piece',
    piece: piece('Drum Journey', {
      kind: 'audio',
      previewUrl: DRUM_PREVIEW,
      cta: 'Listen',
    }),
    show: 'still',
  },
  { type: 'piece', piece: piece('The Medicine of Grief'), show: 'still' },
];

let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];
let clock = 0;
let media = { reduced: false, desktop: true };
let onfilm = vi.fn();
/**
 * A cut's fall and a frame: the words, the index and the stage take the next
 * piece at the cut's bottom, with its picture (WP-6, review M4).
 */
const CUT = CUT_TIMING.outMs + 32;

/** Run frames until `ms` has passed, 16 ms apart, then the words' swap. */
function frame(ms: number) {
  flushSync();
  for (let t = 0; t < ms; t += 16) {
    clock += 16;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
  }
  flushSync();
  vi.advanceTimersByTime(300);
  flushSync();
}

function render(film: IntroFilm = FILM) {
  onfilm = vi.fn();
  const options = resolveHero(
    'consume',
    { comp: 'showreel', 'reel-layout': 'corner', 'reel-loop': 'on' },
    FACTS
  );
  app = mount(Showreel, {
    target: document.body,
    props: {
      reel: reelWith(film),
      options,
      name: 'Of Blood & Bones',
      description: 'Ancestral healing.',
      logoUrl: '',
      onlogofail: vi.fn(),
      facts: '',
      action: null,
      exploreHref: '/explore',
      filmDuration: '0:30',
      following: false,
      followBusy: false,
      onfollow: vi.fn(),
      onfilm,
      filmOpen: false,
      filmPlaying: false,
    },
  });
  flushSync();
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const current = () => q('[aria-current="true"] .reel__t')?.textContent;
const title = () => q('.reel__title')?.textContent?.trim();
const go = (i: number) => {
  document
    .querySelectorAll<HTMLButtonElement>('.reel__index .reel__item')
    [i]?.click();
  frame(CUT);
};
const previewButton = () => q<HTMLButtonElement>('.reel__preview');
/** The index's button for the piece now playing, as the owner's decision names it. */
const currentIndexButton = () =>
  q<HTMLButtonElement>('.reel__index .reel__item[aria-current="true"]');
const reelPause = () => q<HTMLButtonElement>('.reel__ctl .reel__round');
const close = () =>
  q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  resetCore();
  frames = [];
  clock = 0;
  media = { reduced: false, desktop: true };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
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
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('The Showreel opens its theatre', () => {
  it("opens it from Play the preview, in the press's own tick, with the film's preview and its sound", () => {
    render();
    q<HTMLButtonElement>('.reel__btn')?.click();
    // No flush here: the press itself mounted it, so the player's play()
    // runs inside the visitor's activation and keeps the sound.
    expect(q('.theatre[role="dialog"]')).not.toBeNull();
    expect(seen.read()).toMatchObject({ src: FILM.previewUrl, start: 'sound' });
    expect(onfilm).not.toHaveBeenCalled();
  });

  it("keeps the page's own player for the full film, and offers the preview beside it", () => {
    render({ ...FILM, fullFilm: true });
    q<HTMLButtonElement>('.reel__btn')?.click();
    flushSync();
    expect(onfilm).toHaveBeenCalledTimes(1);
    expect(q('.theatre')).toBeNull();

    previewButton()?.click();
    expect(q('.theatre')).not.toBeNull();
    expect(seen.read()?.src).toBe(FILM.previewUrl);
  });

  it('offers Preview with sound only where there is a preview the main button does not already play', () => {
    render();
    // The film's main button already plays its preview.
    expect(previewButton()).toBeNull();
    go(1);
    expect(current()).toBe('Drum Journey');
    expect(previewButton()?.getAttribute('aria-label')).toBe(
      'Preview with sound'
    );
    go(2);
    // A pick in the last cut's rise waits for it (a cut never turns round,
    // WCAG 2.3.1); the words come in with the picture (WP-6).
    frame(CUT_TIMING.inMs + CUT);
    // An essay has nothing to hear.
    expect(previewButton()).toBeNull();
  });

  it('holds the reel while it plays, with its words out of reach and its stage at rest', () => {
    render();
    q<HTMLButtonElement>('.reel__btn')?.click();
    frame(PIECE_MS * 2);
    expect(current()).toBe('Of Blood & Bones');
    expect(q('.reel')?.dataset.theatre).toBe('video');
    expect(q('.reel__inner')?.inert).toBe(true);

    // The control: closed, the same frames move it on.
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    frame(PIECE_MS + 100);
    frame(CUT);
    expect(current()).toBe('Drum Journey');
  });

  it("leaves a recording's canvas to the shader alone, behind its cover", () => {
    render();
    go(1);
    const still = q<HTMLImageElement>('.reel-stage__item[data-on] img');
    still?.dispatchEvent(new Event('load'));
    flushSync();
    // The control: before it opens, the canvas shows the piece's still.
    expect(showreelFeed.media).toBe(still);
    previewButton()?.click();
    flushSync();
    expect(q('.reel')?.dataset.theatre).toBe('audio');
    expect(q('.reel-stage')?.hasAttribute('data-withheld')).toBe(true);
    expect(showreelFeed.media).toBeNull();
  });

  it("carries on at the preview's end, and a close comes back to the same piece", () => {
    render();
    q<HTMLButtonElement>('.reel__btn')?.click();
    seen.read()?.onended?.('end');
    frame(CUT);
    expect(q('.theatre')).toBeNull();
    expect(current()).toBe('Drum Journey');

    previewButton()?.click();
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    frame(1);
    expect(q('.theatre')).toBeNull();
    expect(current()).toBe('Drum Journey');
    expect(q('.reel__inner')?.inert).toBe(false);
  });

  /**
   * Every focus call as it lands: on what, and whether that was inside an
   * inert subtree then. Svelte sets `inert` as the property, which the test
   * DOM never reflects to the attribute, so the ancestors' property is read.
   */
  function watchFocus() {
    const inInert = (el: HTMLElement) => {
      for (let at: HTMLElement | null = el; at; at = at.parentElement) {
        if (at.inert) return true;
      }
      return false;
    };
    const calls: { el: HTMLElement; inert: boolean }[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions
    ) {
      const inert = inInert(this);
      calls.push({ el: this, inert });
      // As a browser does: nothing inside an inert subtree takes focus.
      if (!inert) focus.call(this, options);
    });
    return calls;
  }

  it('gives focus back to what opened it only once the reel behind is no longer inert (review H1)', () => {
    const calls = watchFocus();
    render();
    const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    expect(q('.reel__inner')?.inert).toBe(true);
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    frame(1);
    expect(q('.reel__inner')?.inert).toBe(false);
    // Asked while the reel was still inert, a browser drops it to the body.
    const back = calls.filter((call) => call.el === opener);
    expect(back.length).toBeGreaterThan(1);
    expect(back.every((call) => !call.inert)).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('gives it back on Escape too', () => {
    watchFocus();
    render();
    const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    );
    frame(1);
    expect(document.activeElement).toBe(opener);
  });

  for (const [label, active] of [
    ['the body', () => document.body],
    ['the root', () => document.documentElement],
  ] as const) {
    it(`takes ${label} for no opener, as Safari leaves a clicked button (review L5): focus goes to the index`, () => {
      watchFocus();
      render();
      const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
      // Safari focuses no button a click presses.
      const at = vi
        .spyOn(document, 'activeElement', 'get')
        .mockReturnValue(active());
      opener.click();
      at.mockRestore();
      q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
      frame(1);
      // The index's button for the piece, never the reel's pause before it.
      expect(document.activeElement).toBe(currentIndexButton());
    });
  }

  it('lets the keyboard hold go when focus could not come back into the reel (Firefox: no focusout for a removed node)', () => {
    // A browser's :focus-visible for keyboard focus (the hold's own test does the same).
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
    const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    flushSync();
    const before = current();
    // Nothing in the reel takes focus back (as if every stop were gone).
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {});
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    frame(1);
    expect(document.activeElement).toBe(document.body);
    frame(PIECE_MS + 100);
    frame(CUT);
    expect(current()).not.toBe(before);
  });

  it("never takes a press inside the theatre as a tap on the reel (a phone's)", () => {
    media.desktop = false;
    render();
    const press = (at: Element) => {
      for (const type of ['pointerdown', 'pointerup']) {
        at.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            isPrimary: true,
            pointerType: 'touch',
            clientX: 300,
            clientY: 400,
          })
        );
      }
      frame(CUT);
    };
    q<HTMLButtonElement>('.reel__btn')?.click();
    press(q('.theatre__player video') as Element);
    expect(title()).toBe('Of Blood & Bones');
    expect(q('.theatre')).not.toBeNull();

    // The control: closed, the same press on the reel moves it on.
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    frame(1);
    press(q('.reel__scrim-foot') as Element);
    expect(title()).toBe('Drum Journey');
  });

  it('rests its stage footage while the theatre plays its own copy, and plays it again on close: never two films decoding at once', async () => {
    render();
    // hls.js's module, then the players' promises, then what they set.
    await vi.dynamicImportSettled();
    for (let k = 0; k < 10; k++) await Promise.resolve();
    flushSync();
    const video =
      document
        .querySelectorAll('.reel-stage__item')[0]
        ?.querySelector<HTMLVideoElement>('video') ?? null;
    expect(video).not.toBeNull();
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    paused.mockClear();
    q<HTMLButtonElement>('.reel__btn')?.click();
    flushSync();
    expect(q('.theatre')).not.toBeNull();
    expect(paused.mock.contexts).toContain(video);
    play.mockClear();
    q<HTMLButtonElement>('.theatre__round[data-role="close"]')?.click();
    flushSync();
    expect(q('.theatre')).toBeNull();
    expect(play.mock.contexts).toContain(video);
  });
});

/**
 * WP-7 review round 2 (MEDIUM): with no opener to go back to, focus goes to
 * the index's button for the piece the clock is on (the owner's decision,
 * Codex-1yd58.8: "the opener or the current index button"; WCAG 2.4.3),
 * never the reel's pause, which comes first in the tree.
 */
describe('the theatre gives focus to the current index button when its opener cannot take it (owner, 2026-11-20)', () => {
  it("after the preview plays to its end, focus is on the index's button for the piece the reel moved on to, not the reel's pause", () => {
    render();
    const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
    opener.focus();
    opener.click();
    seen.read()?.onended?.('end');
    // The words' swap lands (frame advances past OUT_MS).
    frame(1);
    expect(q('.theatre')).toBeNull();
    expect(current()).toBe('Drum Journey');
    expect(currentIndexButton()).not.toBeNull();
    expect(document.activeElement).not.toBe(reelPause());
    expect(document.activeElement).toBe(currentIndexButton());
  });

  it('with no opener (Safari focuses no clicked button), a close gives focus to the index button of the same piece', () => {
    render();
    const opener = q<HTMLButtonElement>('.reel__btn') as HTMLButtonElement;
    const at = vi
      .spyOn(document, 'activeElement', 'get')
      .mockReturnValue(document.body);
    opener.click();
    at.mockRestore();
    close();
    frame(1);
    expect(current()).toBe('Of Blood & Bones');
    expect(document.activeElement).not.toBe(reelPause());
    expect(document.activeElement).toBe(currentIndexButton());
  });

  it("the same from a recording's Preview with sound", () => {
    render();
    go(1);
    expect(current()).toBe('Drum Journey');
    const at = vi
      .spyOn(document, 'activeElement', 'get')
      .mockReturnValue(document.body);
    previewButton()?.click();
    at.mockRestore();
    close();
    frame(1);
    expect(document.activeElement).not.toBe(reelPause());
    expect(document.activeElement).toBe(currentIndexButton());
  });
});
