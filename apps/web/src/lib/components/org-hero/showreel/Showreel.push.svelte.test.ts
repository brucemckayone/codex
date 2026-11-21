/**
 * The Showreel's push-in restarts only when the piece on show CHANGES
 * (Codex-1yd58.6, WP-5b review r3 M1r3). A reel of one, the intro film alone
 * (it qualifies the reel by itself, `reelQualifies`), shows its still under
 * Save-Data, with a poster and no preview, when Low Power Mode refuses to
 * play it, or after a decode fails for good. At its piece's end the clock
 * goes round to the SAME piece (`go(0)`), and the push read the clock's 0
 * there: the still fell from 1.08 back to 1.00 every 7 s, on the canvas and
 * on the page, with no cut. A visitor re-picking the piece on show from the
 * index did the same. Both readers are `pushOnShow`: the canvas through
 * `pieceSeconds`, the page through `--_push-progress`.
 */

import type { IntroFilm } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import { pushZoom } from '$lib/components/ui/ShaderHero/compositor/stage';
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
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: vi.fn() })),
}));

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
const piece = (title: string): OrgHeroPiece => ({
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
});
const ONE: ReelEntry[] = [{ type: 'film', film: FILM, show: 'footage' }];
const THREE: ReelEntry[] = [
  ...ONE,
  { type: 'piece', piece: piece('The Medicine of Grief'), show: 'still' },
  { type: 'piece', piece: piece('Fire Ceremony at Dusk'), show: 'still' },
];

let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];
let clock = 0;

/** Mount it as the landing does, under Save-Data: every entry its still, still moving on (owner Q3). */
function render(reel: ReelEntry[]) {
  vi.stubGlobal('navigator', {
    ...navigator,
    connection: { saveData: true },
  });
  const options = resolveHero(
    'consume',
    { comp: 'showreel', 'reel-layout': 'corner', 'reel-loop': 'on' },
    FACTS
  );
  app = mount(Showreel, {
    target: document.body,
    props: {
      reel,
      options,
      name: 'Of Blood & Bones',
      description: 'Ancestral healing.',
      logoUrl: '',
      onlogofail: vi.fn(),
      facts: '4 portals and 15 essays',
      action: { href: '/pricing', label: 'Join Of Blood & Bones' },
      exploreHref: '/explore',
      filmDuration: '0:30',
      following: false,
      followBusy: false,
      onfollow: vi.fn(),
      onfilm: vi.fn(),
      filmOpen: false,
      filmPlaying: false,
    },
  });
  flushSync();
  expect(q('.reel')?.dataset.mode).toBe('stills');
  for (const img of document.querySelectorAll<HTMLImageElement>(
    '.reel-stage img'
  )) {
    img.dispatchEvent(new Event('load'));
  }
  flushSync();
  expect(showreelFeed.look?.push).toBeTypeOf('function');
  expect(showreelFeed.media).toBeInstanceOf(HTMLImageElement);
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

/** One 16 ms frame, the words' timer advancing alongside, as a browser runs them. */
function one() {
  flushSync();
  clock += 16;
  const due = frames;
  frames = [];
  for (const callback of due) callback(clock);
  flushSync();
  vi.advanceTimersByTime(16);
  flushSync();
}

type Reading = { el: unknown; at: number };
/** What the compositor reads each frame (media-pass.ts `planMedia`). */
const onCanvas = (): Reading => ({
  el: showreelFeed.media,
  at: pushZoom(showreelFeed.look?.push?.() ?? 0) - 1,
});
/** What the stage's push-in reads (ReelStage: `--_push-progress`). */
const onPage = (): Reading => ({
  el: q('.reel-stage__item[data-on] img'),
  at: Number(q('.reel')?.style.getPropertyValue('--_push-progress') || 0),
});

/** `ms` of frames; every frame the same still drew back out, as `t: from -> to`. */
function backwardsOver(
  ms: number,
  read: () => Reading,
  from: Reading | null = null
): string[] {
  let last = from;
  const backwards: string[] = [];
  for (let t = 0; t < ms; t += 16) {
    one();
    const now = read();
    if (now.el && last && last.el === now.el && now.at < last.at - 1e-9) {
      backwards.push(`${t} ms: ${last.at.toFixed(4)} -> ${now.at.toFixed(4)}`);
    }
    last = now;
  }
  return backwards;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames = [];
  clock = 0;
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
    matches: query.includes('min-width'),
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
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Showreel push-in on a reel of one (WP-5b review r3, M1r3)', () => {
  it('never zooms the canvas still back out when the reel comes round to it again', () => {
    render(ONE);
    // Before: ['7008 ms: 0.0800 -> 0.0000', '14016 ms: …'] or near.
    expect(backwardsOver(PIECE_MS * 2 + 200, onCanvas)).toEqual([]);
  });

  it("never draws the page's own still back out when the reel comes round to it again", () => {
    render(ONE);
    expect(backwardsOver(PIECE_MS * 2 + 200, onPage)).toEqual([]);
  });
});

describe('Showreel push-in when the visitor re-picks the piece on show (WP-5b review r3, M1r3)', () => {
  /** Halfway into the first piece, then its own index item pressed again. */
  function rePick(read: () => Reading): { held: Reading; backwards: string[] } {
    render(THREE);
    for (let t = 0; t < PIECE_MS / 2; t += 16) one();
    const held = read();
    expect(held.at).toBeGreaterThan(0.01);
    const onShow = q<HTMLButtonElement>('.reel__item[aria-current="true"]');
    expect(onShow).not.toBeNull();
    onShow?.click();
    return { held, backwards: backwardsOver(600, read, held) };
  }

  it('keeps the canvas still where its push had reached', () => {
    const { held, backwards } = rePick(onCanvas);
    // Before: ['0 ms: 0.0599 -> 0.0000'] or near.
    expect(backwards).toEqual([]);
    expect(onCanvas().el).toBe(held.el);
  });

  it("keeps the page's own still where its push had reached", () => {
    const { held, backwards } = rePick(onPage);
    expect(backwards).toEqual([]);
    expect(onPage().el).toBe(held.el);
  });

  it('still starts the next piece from the start of its push', () => {
    render(THREE);
    for (let t = 0; t < PIECE_MS + 600; t += 16) one();
    // The cut came (OUT_MS after the clock), and the new still starts near 0.
    expect(onPage().at).toBeLessThan(0.2);
    expect(onCanvas().at).toBeLessThan(0.2 * 0.08);
  });
});
