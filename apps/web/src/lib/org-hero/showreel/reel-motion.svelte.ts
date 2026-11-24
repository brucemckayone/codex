/**
 * The Showreel's motion, wired: the hook the Showreel calls once, at init. It
 * keeps a `ReelMotion` (the pure driver, `reel-motion.ts`) in step with the
 * reel, hands its `FilmMotion` to the window's shader
 * (`showreelFeed.setMotion`), and runs its frames.
 *
 * In step with the reel:
 *   - the hero's four motion settings, the layout's film frame, a phone,
 *     reduced motion and the static path (`configure`);
 *   - the piece the clock is on: a cut (`follow`);
 *   - the reel paused: a cut under way ends at once on its piece;
 *   - the pointer over the reel, and a sideways swipe on a phone;
 *   - the film playing, in the hero or the phone's pop-up: the way into it;
 *   - the canvas showing the film for the first time: the opening;
 *   - the page scrolling over the letters' fade (`NAME_FADE_PX`).
 *
 * Frames run only while something moves (`ReelMotion.frame` says), woken
 * by each of those, so a reel at rest costs no frame at all. Each frame the
 * values are written in place; `showreelFeed.motionFrame()` tells a frozen
 * hero to draw them (a moving one draws them anyway).
 *
 * The Showreel shows the piece `stage` names on its stage: during a cut
 * that is the piece going out, until the cut's bottom, so the film never
 * swaps under a picture still showing it. It is held by key and found in the
 * reel as it is now, so a refresh that moves the piece (one added before it)
 * never shows another entry for a render before the driver hears of it.
 * Null until the hook runs (the server's render), or once the piece has left
 * the reel: the Showreel then shows its own.
 */
import { untrack } from 'svelte';
import type { FilmFrameId } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import {
  NAME_FADE_PX,
  nameFade,
} from '$lib/components/ui/ShaderHero/compositor/stage';
import type { MaskPixels } from './deepest-point';
import {
  type MotionSettings,
  motionChoice,
  ReelMotion,
  type ReelMotionSetup,
} from './reel-motion';

/** What the hook reads from the Showreel, each as it is now. */
export interface ReelMotionSource {
  /** The hero's settings: the four motion ones are read. */
  readonly options: () => MotionSettings;
  /** The layout's film frame (the Showreel's look). */
  readonly frame: () => FilmFrameId;
  /** The reel's root: its pointer and touches drive the pointer effect. */
  readonly root: () => HTMLElement | undefined;
  /** The reel's entries, by key, and the one the clock is on. */
  readonly keys: () => readonly string[];
  readonly index: () => number;
  /**
   * The visitor stopped the reel: its pause, a press held, or the reel out
   * of view. Not the hover and focus holds: a pick from the index is made
   * under one, and its cut must run.
   */
  readonly paused: () => boolean;
  /** The reel moves on by itself (not the static path). */
  readonly moves: () => boolean;
  /**
   * This visit has had its opening (`opening-seen.ts`): the driver runs none,
   * and the words come straight in. The first paint still holds them, as the
   * server drew it, until the driver's first frame.
   */
  readonly skipOpening?: () => boolean;
  readonly phone: () => boolean;
  readonly reducedMotion: () => boolean;
  /** The film plays, in the hero or the phone's pop-up. */
  readonly filmPlaying: () => boolean;
}

/** The longest side of the mask copy a dive is aimed on. */
const AIM_SIZE = 240;
/** How long the letters wait dark for the film to reach the canvas. */
export const OPEN_WAIT_MS = 4000;

/**
 * A small copy of the org's name mask (`showreelFeed.mask`, a canvas the
 * Showreel draws), for `deepestPoint`. Null for no mask, or one that is no
 * canvas.
 */
function maskPixelsOf(source: TexImageSource | null): MaskPixels | null {
  if (
    !source ||
    typeof HTMLCanvasElement === 'undefined' ||
    !(source instanceof HTMLCanvasElement)
  )
    return null;
  const { width, height } = source;
  if (!width || !height) return null;
  const scale = Math.min(1, AIM_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** The window's width over its height: the fixed canvas's. */
function viewportAspect(): number {
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * Whether CSS alone can take the name back as the page scrolls: a
 * scroll-driven animation over a set range (`animation-range`). Firefox 159
 * ships the timeline; where the range is missing, the ink's share is written
 * from a scroll listener instead (`--_ink-back`), a frame late: a fade.
 */
function inkFollowsScrollInCss(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('animation-timeline: scroll()') &&
    CSS.supports('animation-range: 0 32px')
  );
}

/**
 * Wire the Showreel's motion. Call once, during the Showreel's init: its
 * effects belong to the component. Returns the piece the stage shows.
 */
export function useReelMotion(source: ReelMotionSource): {
  readonly stage: number | null;
  readonly wordsHeld: boolean;
} {
  let stageKey = $state<string | null>(null);
  // Before the driver's first frame (the server's render, hydration): held
  // whenever an opening is chosen, as the server drew it.
  let heldByDriver = $state<boolean | null>(null);
  let driver: ReelMotion | null = null;
  let frameId = 0;
  const now = () => performance.now();

  function tick(time: number) {
    frameId = 0;
    const d = driver;
    if (!d) return;
    const busy = d.frame(time);
    if (d.stageKey !== stageKey) stageKey = d.stageKey;
    if (d.wordsHeld !== heldByDriver) heldByDriver = d.wordsHeld;
    showreelFeed.motionFrame();
    if (busy) wake();
  }
  function wake() {
    if (frameId === 0 && driver) frameId = requestAnimationFrame(tick);
  }

  // The settings and circumstances: the first run makes the driver.
  $effect(() => {
    const chosen = motionChoice(source.options());
    const setup: ReelMotionSetup = {
      choice: source.skipOpening?.() ? { ...chosen, opening: 'none' } : chosen,
      frame: source.frame(),
      phone: source.phone(),
      reducedMotion: source.reducedMotion(),
      moves: source.moves(),
    };
    untrack(() => {
      if (driver) driver.configure(setup);
      else {
        driver = new ReelMotion(setup, {
          maskPixels: () => maskPixelsOf(showreelFeed.mask),
          stageSettled: () => showreelFeed.settled,
        });
      }
      showreelFeed.setMotion(driver.motion);
      wake();
    });
  });

  // Gone: the film draws with no motion again (`setMotion(null)`).
  $effect(() => () => {
    if (frameId !== 0) cancelAnimationFrame(frameId);
    frameId = 0;
    driver = null;
    showreelFeed.setMotion(null);
  });

  // Paused: a cut under way ends at once on the piece it was going to, and the
  // stage names it now, so its words come in. Before the cuts' effect, so a
  // pause and a pick in one flush (a click on the pause, then the index) reach
  // the driver in the order the visitor made them.
  $effect(() => {
    const paused = source.paused();
    untrack(() => {
      if (!driver) return;
      if (paused) driver.pause(now());
      else driver.play(now());
      stageKey = driver.stageKey;
      wake();
    });
  });

  // The piece the clock is on: a cut, or a refresh that only moved it.
  $effect(() => {
    const keys = source.keys();
    const index = source.index();
    untrack(() => {
      if (!driver) return;
      driver.follow(keys, index, now());
      stageKey = driver.stageKey;
      wake();
    });
  });

  // The film plays: the way into it; it stops: the band and letters return.
  // Scrolled past the letters' fade, it goes straight to the film filling.
  let inFilm = false;
  $effect(() => {
    const playing = source.filmPlaying();
    untrack(() => {
      if (!driver || playing === inFilm) return;
      inFilm = playing;
      if (playing)
        driver.enterFilm(
          now(),
          viewportAspect(),
          window.scrollY >= NAME_FADE_PX
        );
      else driver.leaveFilm(now());
      wake();
    });
  });

  // What reads the scroll holds still in the window with the stage: the film
  // fades over the stage's height (`stageFade`), and the letters over the first
  // NAME_FADE_PX (`u_nameFade`), the page's own glyphs taking the name back
  // (the Showreel's ink). A frozen hero (paused, reduced motion, the static
  // path) draws only when told: a scroll that touches either span tells it, as
  // a playing hero would have drawn it, and none past both, where nothing
  // changes. Where CSS cannot follow the scroll itself, the ink's share is
  // written here. Past the letters' fade an opening has nothing to open
  // through, so the driver hears every scroll (`ReelMotion.scroll`), the
  // page's first place included.
  $effect(() => {
    const root = source.root();
    if (!root) return;
    const css = inkFollowsScrollInCss();
    const ink = (y: number) => {
      if (!css) root.style.setProperty('--_ink-back', String(1 - nameFade(y)));
    };
    const tell = (y: number) => {
      if (driver?.scroll(y)) wake();
    };
    let last = window.scrollY;
    ink(last);
    tell(last);
    const scrolled = () => {
      const y = window.scrollY;
      const from = Math.min(last, y);
      last = y;
      tell(y);
      if (from < NAME_FADE_PX) ink(y);
      const film = showreelFeed.stage?.fadeDistance ?? 0;
      if (from < Math.max(NAME_FADE_PX, film)) showreelFeed.motionFrame();
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => window.removeEventListener('scroll', scrolled);
  });

  // The pointer over the reel; on a phone, a sideways swipe. In output uv:
  // the fixed canvas is the window.
  $effect(() => {
    const root = source.root();
    if (!root) return;
    const uv = (event: PointerEvent) => {
      const { clientWidth: w, clientHeight: h } = document.documentElement;
      return {
        x: event.clientX / Math.max(w, 1),
        y: 1 - event.clientY / Math.max(h, 1),
        aspect: viewportAspect(),
      };
    };
    const move = (event: PointerEvent) => {
      if (!driver) return;
      const { x, y, aspect } = uv(event);
      if (event.pointerType === 'touch')
        driver.touchMove(event.clientX, event.clientY, x, y, now(), aspect);
      else driver.pointerMove(x, y, now(), aspect);
      wake();
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch')
        driver?.touchDown(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      driver?.touchUp(now());
      wake();
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      driver?.pointerLeave(now());
      wake();
    };
    const passive = { passive: true } as const;
    root.addEventListener('pointermove', move, passive);
    root.addEventListener('pointerdown', down, passive);
    root.addEventListener('pointerup', up, passive);
    root.addEventListener('pointercancel', up, passive);
    root.addEventListener('pointerleave', leave, passive);
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.removeEventListener('pointerleave', leave);
    };
  });

  // The opening, once the canvas shows the film (ShaderHero's `data-film`).
  // With no fullpage hero there is no canvas to open on: the letters show.
  // A film that never reaches the canvas (a slow network, a refused CORS
  // read) must not keep the letters dark: past `OPEN_WAIT_MS` it opens on
  // what the canvas has, and the letters come in.
  $effect(() => {
    if (!source.moves()) return;
    const hero = document.querySelector('.shader-hero--fullpage');
    const open = () =>
      untrack(() => {
        driver?.open(now(), viewportAspect());
        wake();
      });
    if (!hero || hero.hasAttribute('data-film')) {
      open();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!hero.hasAttribute('data-film')) return;
      stop();
      open();
    });
    const timer = setTimeout(() => {
      stop();
      open();
    }, OPEN_WAIT_MS);
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
    observer.observe(hero, {
      attributes: true,
      attributeFilter: ['data-film'],
    });
    return stop;
  });

  return {
    /** The opening holds the words back (`ReelMotion.wordsHeld`). */
    get wordsHeld() {
      return heldByDriver ?? source.options()['reel-opening'] === 'name';
    },
    get stage() {
      if (stageKey === null) return null;
      const at = source.keys().indexOf(stageKey);
      return at >= 0 ? at : null;
    },
  };
}
