/**
 * `useReelMotion`, the Showreel's motion wired (Codex-1yd58.7, WP-6 wiring
 * part 1), as the Showreel calls it: on live props, in a harness. It hands
 * the window's shader its motion and lets go, follows the settings, the
 * picks, the pause, a refresh, the pointer and a phone's swipe, the film,
 * and the opening on the canvas's `data-film`. Frames are driven by hand
 * (`frame(ms)`), as in the Showreel's own tests; the compositor's half (it
 * writes `motion.running`) is played by `runs()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilmFrameId } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
import type { MotionChoice } from '$lib/components/ui/ShaderHero/compositor/effects/motion-ids';
import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Harness from './ReelMotionHarness.test.svelte';
import { LEAVE_MS } from './name-motion';
import type { MotionSettings } from './reel-motion';
import { OPEN_WAIT_MS } from './reel-motion.svelte';
import { CUT_TIMING } from './reel-reveal';

const SETTINGS: MotionSettings = {
  'reel-trans': 'burn',
  'reel-pointer': 'smoke',
  'reel-opening': 'none',
  'reel-film': 'smoke',
};

interface HarnessProps {
  options: MotionSettings;
  frame: FilmFrameId;
  keys: string[];
  index: number;
  paused: boolean;
  moves: boolean;
  phone: boolean;
  reducedMotion: boolean;
  filmPlaying: boolean;
}

let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];
let clock = 0;

/** Run frames until `ms` has passed, 16 ms apart. */
function frame(ms: number) {
  flushSync();
  for (let t = 0; t < ms; t += 16) {
    clock += 16;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
  }
  flushSync();
}

function render(over: Partial<HarnessProps> = {}) {
  const props = $state<HarnessProps>({
    options: SETTINGS,
    frame: 'film-fill',
    keys: ['a', 'b', 'c'],
    index: 0,
    paused: false,
    moves: true,
    phone: false,
    reducedMotion: false,
    filmPlaying: false,
    ...over,
  });
  app = mount(Harness, { target: document.body, props });
  flushSync();
  return props;
}

/** The motion the hook handed the window's shader. */
function held() {
  const motion = showreelFeed.motion;
  if (!motion) throw new Error('the hook handed over no motion');
  return motion;
}
/** The compositor drew the pass for the choice (with `over` falling back). */
function runs(over: Partial<MotionChoice> = {}) {
  const motion = held();
  motion.running = { ...motion.choice, ...over };
}

const root = () => document.querySelector<HTMLElement>('.harness');
const stage = () => root()?.dataset.stage;
const pointer = (type: string, init: PointerEventInit) =>
  root()?.dispatchEvent(
    new PointerEvent(type, { bubbles: true, isPrimary: true, ...init })
  );

beforeEach(() => {
  frames = [];
  clock = 0;
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
  // The window the fixed canvas fills: output uv is its fraction.
  for (const [side, size] of [
    ['clientWidth', 1000],
    ['clientHeight', 500],
  ] as const)
    Object.defineProperty(document.documentElement, side, {
      configurable: true,
      value: size,
    });
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  showreelFeed.onChange(null);
  showreelFeed.setMotion(null);
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useReelMotion and the window’s shader', () => {
  it('hands it the motion the hero chose on mount, and lets go on unmount', () => {
    render();
    expect(held().choice).toEqual({
      trans: 'burn',
      pointer: 'smoke',
      opening: 'none',
      into: 'smoke',
    });
    if (app) unmount(app);
    app = null;
    expect(showreelFeed.motion).toBeNull();
  });

  it('hands over a new motion for a new setting, its values carried on, and keeps it for the same ones', () => {
    const props = render();
    const first = held();
    props.options = { ...SETTINGS };
    flushSync();
    expect(held()).toBe(first);
    props.options = { ...SETTINGS, 'reel-pointer': 'liquid' };
    flushSync();
    expect(held()).not.toBe(first);
    expect(held().choice.pointer).toBe('liquid');
    expect(held().values).toBe(first.values);
  });

  it('asks for no frame at all while nothing moves', () => {
    render();
    runs();
    frame(64);
    expect(frames).toHaveLength(0);
  });
});

describe('useReelMotion and the stage', () => {
  it('keeps the piece going out on the stage until the cut’s bottom', () => {
    const props = render();
    runs();
    expect(stage()).toBe('0');
    props.index = 1;
    frame(CUT_TIMING.outMs / 2);
    expect(held().values.u_reveal).toBeLessThan(1);
    expect(stage()).toBe('0');
    frame(CUT_TIMING.outMs / 2 + 32);
    expect(stage()).toBe('1');
  });

  it('shows a piece a refresh moved at its new place in the same render, never another entry first', () => {
    const props = render({ index: 1 });
    runs();
    const el = root();
    if (!el) throw new Error('no harness');
    expect(stage()).toBe('1');
    expect(el.dataset.stageKey).toBe('b');
    // Every entry the stage names on the way, render by render. An index held
    // alone would name 'a' (index 1 of the new reel) for the render before
    // the hook hears of the refresh: 'b' → 'a' → 'b'.
    const watch = new MutationObserver(() => {});
    watch.observe(el, {
      attributes: true,
      attributeFilter: ['data-stage-key'],
      attributeOldValue: true,
    });
    props.keys = ['z', 'a', 'b', 'c'];
    props.index = 2;
    flushSync();
    const before = watch.takeRecords().map((record) => record.oldValue);
    watch.disconnect();
    expect(stage()).toBe('2');
    expect(el.dataset.stageKey).toBe('b');
    expect(before.filter((key) => key !== 'b')).toEqual([]);
    // And nothing cut.
    frame(32);
    expect(held().values.u_reveal).toBe(1);
  });

  it('shows a piece picked while paused at once: the pause and the pick in one flush', () => {
    const props = render();
    runs();
    props.paused = true;
    props.index = 2;
    flushSync();
    expect(stage()).toBe('2');
    frame(32);
    expect(held().values.u_reveal).toBe(1);
  });

  it('holds a cut where it is while paused, and carries it on', () => {
    const props = render();
    runs();
    props.index = 1;
    frame(CUT_TIMING.outMs / 2);
    const at = held().values.u_reveal;
    props.paused = true;
    frame(2000);
    expect(held().values.u_reveal).toBeCloseTo(at, 6);
    expect(stage()).toBe('0');
    props.paused = false;
    frame(CUT_TIMING.outMs);
    expect(stage()).toBe('1');
  });
});

describe('useReelMotion and the pointer', () => {
  it('writes the smoke from a mouse over the reel, and tells a frozen hero to draw it', () => {
    render();
    runs();
    const said: string[] = [];
    showreelFeed.onChange((changed) => said.push(changed));
    pointer('pointermove', { pointerType: 'mouse', clientX: 250, clientY: 125 });
    frame(32);
    expect(held().values.u_pointerOn).toBe(1);
    // The head of the trail, at the pointer in output uv (y up).
    expect(held().values.u_trail[0]).toBeCloseTo(0.25, 5);
    expect(held().values.u_trail[1]).toBeCloseTo(0.75, 5);
    expect(said).toContain('frame');
    // It leaves: the smoke drifts on, so frames keep coming for a while.
    pointer('pointerleave', { pointerType: 'mouse' });
    frame(32);
    expect(held().values.u_pointerOn).toBe(0);
    expect(frames.length).toBeGreaterThan(0);
  });

  it('on a phone, a sideways swipe drives the smoke and a vertical one stays the page’s scroll', () => {
    render({ phone: true });
    runs();
    pointer('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    pointer('pointermove', { pointerType: 'touch', clientX: 103, clientY: 160 });
    frame(16);
    expect(held().values.u_pointerOn).toBe(0);
    pointer('pointerup', { pointerType: 'touch', clientX: 103, clientY: 160 });
    pointer('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    pointer('pointermove', { pointerType: 'touch', clientX: 160, clientY: 103 });
    frame(16);
    expect(held().values.u_pointerOn).toBe(1);
  });

  it('moves no trail for a pointer effect the pass does not run', () => {
    render();
    runs({ pointer: 'none' });
    pointer('pointermove', { pointerType: 'mouse', clientX: 250, clientY: 125 });
    frame(32);
    expect([...held().values.u_trail].every((n) => n === 0)).toBe(true);
  });
});

describe('useReelMotion and the film', () => {
  it('runs the way into the film while it plays, and gives the stage back after', () => {
    const props = render();
    runs();
    props.filmPlaying = true;
    frame(160);
    expect(held().values.u_into).toBeGreaterThan(0);
    props.filmPlaying = false;
    frame(LEAVE_MS + 32);
    expect(held().values.u_into).toBe(0);
    expect(held().values.u_fill).toBe(0);
  });
});

describe('useReelMotion and the opening', () => {
  const OPENING: MotionSettings = { ...SETTINGS, 'reel-opening': 'name' };
  function hero() {
    const el = document.createElement('div');
    el.className = 'shader-hero shader-hero--fullpage';
    document.body.append(el);
    return el;
  }
  const settle = async () => {
    for (let k = 0; k < 3; k++) await Promise.resolve();
    flushSync();
  };

  it('keeps the letters dark until the canvas shows the film, then fades them in', async () => {
    const canvas = hero();
    render({ options: OPENING, frame: 'film-name' });
    runs();
    frame(64);
    expect(held().values.u_nameAlpha).toBe(0);
    canvas.setAttribute('data-film', '');
    await settle();
    frame(400);
    const mid = held().values.u_nameAlpha;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    frame(1400);
    expect(held().values.u_nameAlpha).toBe(1);
  });

  it('lets the letters in when the film never reaches the canvas', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hero();
    render({ options: OPENING, frame: 'film-name' });
    runs();
    frame(64);
    expect(held().values.u_nameAlpha).toBe(0);
    vi.advanceTimersByTime(OPEN_WAIT_MS);
    frame(1400);
    expect(held().values.u_nameAlpha).toBe(1);
  });

  it('opens at once with no fullpage hero to open on', () => {
    render({ options: OPENING, frame: 'film-name' });
    runs();
    frame(400);
    expect(held().values.u_nameAlpha).toBeGreaterThan(0);
  });
});
