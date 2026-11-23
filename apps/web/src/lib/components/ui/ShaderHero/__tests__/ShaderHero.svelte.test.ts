/**
 * ShaderHero's `still`: one static frame, then no more frames until it is
 * turned off. The org layout sets it on studio routes, where the shader sits
 * behind an 80% cover and a 60px blur and every frame is a full-viewport
 * render (on CI's CPU-rendered context, ~8s per click on a studio page).
 *
 * And its `tone`: what it draws, sampled for a page that asks.
 *
 * The render loop is driven by hand: requestAnimationFrame queues its
 * callbacks and `step()` runs one frame's worth. The WebGL context and the
 * renderer are stand-ins; what is counted is how often the renderer draws.
 */
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const renderer = vi.hoisted(() => ({
  init: vi.fn(() => true),
  render: vi.fn(),
  resize: vi.fn(),
  reset: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('$app/environment', () => ({
  browser: true,
  dev: true,
  building: false,
  version: 'test',
}));
vi.mock('../load-renderer', () => ({
  loadRenderer: vi.fn(async () => renderer),
}));
vi.mock('../jfa-sdf', () => ({
  destroyJFACache: vi.fn(),
  resetJFACache: vi.fn(),
}));
// The stack's compositor: a stand-in that says it drew.
const compositor = vi.hoisted(() => ({
  // It reads the frame's `onSecondFailed`, as the real one does.
  render: vi.fn(
    (_frame: { onSecondFailed?: (thrown: unknown) => void }) => true
  ),
  setMedia: vi.fn(),
  setStage: vi.fn(),
  setNameMask: vi.fn(),
  setLook: vi.fn(),
  setMotion: vi.fn(),
  // Whether a frame of the film is on the GPU (ShaderHero's `data-film`).
  mediaReady: vi.fn(() => false),
  destroy: vi.fn(),
  forget: vi.fn(),
}));
vi.mock('../compositor/compositor', () => ({
  createCompositor: vi.fn(() => compositor),
}));
// The brand's stack; null reads the real (bare, with no tokens) one.
const brandStack = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../compositor/stack-config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../compositor/stack-config')>();
  return {
    ...actual,
    getStackConfig: (...args: Parameters<typeof actual.getStackConfig>) =>
      (brandStack.value as ReturnType<typeof actual.getStackConfig> | null) ??
      actual.getStackConfig(...args),
  };
});
// The phone's layer budget: off as shipped, on where a test says.
const layerBudgetFlag = vi.hoisted(() => ({ on: false }));
vi.mock('../compositor/layer-budget', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../compositor/layer-budget')>();
  return {
    ...actual,
    get PHONE_LAYER_BUDGET() {
      return layerBudgetFlag.on;
    },
  };
});
const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));
// What the brand's tokens say the shader draws; a test edits it as the brand
// editor would.
const brand = vi.hoisted(() => ({
  config: { preset: 'ether' } as Record<string, unknown>,
  /** How many times the shader has read them. */
  reads: 0,
}));
vi.mock('../shader-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shader-config')>()),
  getShaderConfig: () => {
    brand.reads++;
    return brand.config;
  },
}));

import { createCompositor } from '../compositor/compositor';
import type { MotionChoice } from '../compositor/effects/motion-ids';
import { restMotion } from '../compositor/effects/motion-uniforms';
import type { FilmMotion } from '../compositor/film-motion';
import { showreelFeed } from '../compositor/showreel-feed';
import { BARE_STACK, type StackConfig } from '../compositor/stack-config';
import { resetJFACache } from '../jfa-sdf';
import { loadRenderer } from '../load-renderer';
import type { MouseState, ShaderRenderer } from '../renderer-types';
import ShaderHero from '../ShaderHero.svelte';
import type { ShaderPresetId } from '../shader-config';
import {
  isShaderLive,
  onShaderFrame,
  requestShaderFrame,
} from '../shader-frame.svelte';
import { shaderLive } from '../shader-live.svelte';
import { shaderStill } from '../shader-still.svelte';
import { shaderTone } from '../shader-tone';
import { STILL_MOTION } from './motion-fixtures';

let frames: FrameRequestCallback[] = [];
let resizeCallbacks: ResizeObserverCallback[] = [];
let box = { width: 0, height: 0 };
let app: ReturnType<typeof mount> | null = null;
let clock = 0;
let releases: (() => void)[] = [];
const toneDraws = vi.fn();
/** Copies of the studio's frame encoded (`shaderStill`). */
let encoded = 0;
let contextLost = false;
/** The WebGL context's stand-in. */
const webgl = {
  isContextLost: () => contextLost,
  // No float render targets: what a failure report records.
  getExtension: () => null,
};

/** Run the frames queued so far (those they queue run on the next step). */
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    for (const callback of due) callback(performance.now());
  }
}

/** Mount, then let the async renderer load and its first frame queue. */
async function start(
  props: {
    still?: boolean;
    tone?: boolean;
    preset?: ShaderPresetId;
    publishFrames?: boolean;
  },
  target: HTMLElement = document.body
) {
  app = mount(ShaderHero, { target, props });
  flushSync();
  await tick();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  frames = [];
  resizeCallbacks = [];
  box = { width: 0, height: 0 };
  renderer.render.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // The WebGL context is a stand-in; the 2D one the samples are drawn on
  // counts its draws and reads back a mid grey.
  toneDraws.mockClear();
  brand.config = { preset: 'ether' };
  contextLost = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
    kind: string
  ) =>
    kind === '2d'
      ? {
          drawImage: toneDraws,
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4).fill(128),
          }),
        }
      : webgl) as unknown as HTMLCanvasElement['getContext']);
  // The still's copy is encoded at once, to an object URL jsdom lacks.
  encoded = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (done: BlobCallback) => {
      encoded++;
      done(new Blob(['frame']));
    }
  );
  let made = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => `blob:still-${++made}`,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => {},
  });
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  for (const [side, size] of [
    ['clientWidth', 1200],
    ['clientHeight', 800],
  ] as const)
    Object.defineProperty(document.documentElement, side, {
      configurable: true,
      value: size,
    });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        ...box,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: box.width,
        bottom: box.height,
      }) as DOMRect
  );
});

afterEach(() => {
  layerBudgetFlag.on = false;
  for (const release of releases) release();
  releases = [];
  if (app) unmount(app);
  app = null;
  shaderStill.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ShaderHero still', () => {
  it('moves by default: a draw every frame', async () => {
    await start({ still: false });
    step(5);
    expect(renderer.render).toHaveBeenCalledTimes(5);
    expect(frames).toHaveLength(1);
  });

  it('draws one frame and then asks for no more', async () => {
    await start({ still: true });
    step(5);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  it('freezes and thaws when the prop changes, as on entering and leaving the studio', async () => {
    const props = $state({ still: false });
    await start(props);
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);

    props.still = true;
    flushSync();
    step(5);
    // The frame already queued draws the static frame; nothing after it.
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(frames).toHaveLength(0);

    props.still = false;
    flushSync();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(7);
    expect(frames).toHaveLength(1);
  });

  // A page's motion dial holds the window's shader still.
  it('stands still while a page holds it, and moves again when the last lets go', async () => {
    await start({ tone: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);

    const release = shaderTone.hold();
    releases.push(release);
    step(5);
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(frames).toHaveLength(0);

    release();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(7);
    expect(frames).toHaveLength(1);
  });

  it('stands still from its first frame for a page that held it first, and only with `tone`', async () => {
    releases.push(shaderTone.hold());
    await start({ tone: true });
    step(5);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    unmount(app!);
    app = null;

    renderer.render.mockClear();
    await start({});
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);
  });

  it('draws its frame again after a resize clears the canvas, then stops', async () => {
    await start({ still: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    box = { width: 1200, height: 800 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(0);
  });
});

describe('ShaderHero tone', () => {
  const ask = () => releases.push(shaderTone.demand());

  it('samples nothing until a page asks, then about twice a second', async () => {
    box = { width: 1200, height: 800 };
    await start({ tone: true });
    step(3);
    expect(shaderTone.grid.samples).toBe(0);

    ask();
    step(1);
    expect(shaderTone.grid.samples).toBe(1);
    // Frames within the half second draw, but are not sampled.
    clock += 100;
    step(3);
    expect(shaderTone.grid.samples).toBe(1);
    clock += 500;
    step(1);
    expect(shaderTone.grid.samples).toBe(2);
    // One pixel per cell, averaged from the frame.
    expect(shaderTone.grid.lo[0]).toBe(128);
  });

  it('never samples without `tone`, whatever a page asks', async () => {
    box = { width: 1200, height: 800 };
    await start({});
    ask();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(toneDraws).not.toHaveBeenCalled();
    expect(shaderTone.grid.samples).toBe(0);
  });

  it('draws a frozen frame again, the same moment, for a page that starts asking', async () => {
    box = { width: 1200, height: 800 };
    clock = 1000;
    await start({ still: true, tone: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(shaderTone.grid.samples).toBe(0);

    clock = 9000;
    ask();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(shaderTone.grid.samples).toBe(1);
    // The same moment: the picture behind the page does not jump.
    const elapsed = renderer.render.mock.calls.map((call) => call[1]);
    expect(elapsed[1]).toBe(elapsed[0]);
    expect(frames).toHaveLength(0);
  });

  it('clears what it reported when the canvas changes size', async () => {
    box = { width: 1200, height: 800 };
    await start({ tone: true });
    ask();
    step(1);
    expect(shaderTone.grid.samples).toBe(1);

    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    expect(shaderTone.grid.samples).toBe(0);
  });

  it('says whether its frame is still, and how far the blur over it reaches', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    (document.querySelector('.shader-hero') as HTMLElement).style.filter =
      'blur(20px)';
    ask();
    step(3);
    expect(shaderTone.grid.samples).toBe(1);
    expect(shaderTone.still).toBe(true);
    expect(shaderTone.blur).toBe(20);
  });

  it('samples a still frame again after a resize, however soon after the last', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    ask();
    step(3);
    expect(shaderTone.grid.samples).toBe(1);

    clock += 50; // well inside the half second
    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(shaderTone.grid.samples).toBe(1);
  });
});

// The studio's one frame, copied for the page editor.
describe('ShaderHero still copy', () => {
  it('copies the studio’s frame in the task that draws it, and again when a resize redraws it', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    // Read from the WebGL canvas itself, straight after the draw.
    expect(toneDraws).toHaveBeenCalledTimes(1);
    expect(toneDraws.mock.calls[0]?.[0]).toBe(document.querySelector('canvas'));
    expect(shaderStill.current).toEqual({
      url: 'blob:still-1',
      theme: 'light',
    });

    step(3);
    expect(encoded).toBe(1);

    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(encoded).toBe(2);
    expect(shaderStill.current?.url).toBe('blob:still-2');
  });

  it('names the theme the shader drew in, from the sentinel its config reads', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    (document.querySelector('.shader-hero') as HTMLElement).style.setProperty(
      '--brand-shader-is-dark',
      '1'
    );
    step(1);
    expect(shaderStill.current?.theme).toBe('dark');
  });

  it('copies nothing while the shader moves, or from a shader that is not the org layout’s', async () => {
    box = { width: 1200, height: 800 };
    await start({ tone: true });
    step(3);
    unmount(app!);
    app = null;
    // The moving shader's next frame was queued; it never runs once gone.
    frames = [];
    await start({ still: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(encoded).toBe(0);
    expect(shaderStill.current).toBeNull();
  });

  it('drops the copy on leaving the studio and on unmount', async () => {
    box = { width: 1200, height: 800 };
    const props = $state({ still: true, tone: true });
    await start(props);
    step(1);
    expect(shaderStill.current).not.toBeNull();

    props.still = false;
    flushSync();
    expect(shaderStill.current).toBeNull();

    props.still = true;
    flushSync();
    step(1);
    expect(shaderStill.current).not.toBeNull();

    unmount(app!);
    app = null;
    expect(shaderStill.current).toBeNull();
  });

  it('keeps the glow when no copy can be made', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
      kind: string
    ) =>
      kind === '2d'
        ? null
        : webgl) as unknown as HTMLCanvasElement['getContext']);
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(encoded).toBe(0);
    expect(shaderStill.current).toBeNull();
  });

  it('copies the frame on entering the studio when reduced motion had already frozen it', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList);
    box = { width: 1200, height: 800 };
    const props = $state({ still: false, tone: true });
    await start(props);
    step(3);
    // Frozen for the viewer's sake, out of the studio: no copy.
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(shaderStill.current).toBeNull();

    props.still = true;
    flushSync();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(shaderStill.current).not.toBeNull();
  });

  it('draws a frozen frame in the brand as it is now, not as it last polled', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(1);
    expect(shaderStill.current?.theme).toBe('light');

    // The brand changes, then a resize redraws the frame.
    brand.config = { preset: 'ether', intensity: 0.4 };
    (document.querySelector('.shader-hero') as HTMLElement).style.setProperty(
      '--brand-shader-is-dark',
      '1'
    );
    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    step(1);
    expect(renderer.render.mock.calls[1]?.[3]).toEqual({
      preset: 'ether',
      intensity: 0.4,
    });
    expect(shaderStill.current?.theme).toBe('dark');
  });

  /** The studio's shader inside its org layout, its first frame copied; the
   *  wait for changes to settle runs by hand (`settle`), any other timer is
   *  real. */
  async function inStudio() {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    document.body.appendChild(layout);
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true }, layout);
    step(1);
    expect(encoded).toBe(1);
    let settling: (() => void) | null = null;
    const later = window.setTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((
      callback: () => void,
      ms?: number
    ) => {
      if (ms !== 250) return later(callback, ms);
      settling = callback;
      return 1;
    }) as typeof window.setTimeout);
    const settle = async () => {
      await Promise.resolve();
      const run: (() => void) | null = settling;
      settling = null;
      run?.();
      step(3);
    };
    return { layout, settle };
  }

  it('copies the frame again in the studio once the brand or the theme changes what it draws', async () => {
    const { layout, settle } = await inStudio();
    // The page editor paints the copy.
    releases.push(shaderStill.want());
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // A token the shader does not read: nothing is drawn again.
    layout.style.setProperty('--brand-radius', '4px');
    await settle();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(encoded).toBe(1);

    // A new shader setting, as the brand editor writes it.
    brand.config = { preset: 'ether', intensity: 0.4 };
    layout.style.setProperty('--brand-shader-intensity', '0.4');
    await settle();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(encoded).toBe(2);

    // The other theme.
    (document.querySelector('.shader-hero') as HTMLElement).style.setProperty(
      '--brand-shader-is-dark',
      '1'
    );
    document.documentElement.setAttribute('data-theme', 'dark');
    await settle();
    expect(encoded).toBe(3);
    expect(shaderStill.current?.theme).toBe('dark');
  });

  it('with nothing painting the copy, a brand change drops it and draws nothing until a render asks', async () => {
    const { layout, settle } = await inStudio();

    // The brand editor, which paints no copy.
    brand.config = { preset: 'ether', intensity: 0.4 };
    layout.style.setProperty('--brand-shader-intensity', '0.4');
    await settle();
    // The old brand's copy gives way to the glow; no full-viewport draw.
    expect(shaderStill.current).toBeNull();
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // The page editor opens.
    releases.push(shaderStill.want());
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(encoded).toBe(2);
    expect(shaderStill.current).not.toBeNull();

    // A second render asking, with a copy shown, draws nothing more.
    releases.push(shaderStill.want());
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('draws no second frame for a copy still being encoded, and draws again once for a copy that failed', async () => {
    // The encoder answers later, as a browser's does.
    const encodes: BlobCallback[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (done: BlobCallback) => {
        encodes.push(done);
      }
    );
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // The page editor mounts while the first copy is encoding.
    releases.push(shaderStill.want());
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // That copy fails: the next render to ask gets the frame drawn again.
    encodes.shift()?.(null);
    releases.push(shaderStill.want());
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);

    // It fails again: the same brand is not drawn for a third time.
    encodes.shift()?.(null);
    releases.push(shaderStill.want());
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(shaderStill.current).toBeNull();
  });

  it('a frozen shader with nothing to draw keeps to the poll that spots a new preset', async () => {
    brand.config = { preset: 'none' };
    await start({ still: true, tone: true });
    const before = brand.reads;
    step(60);
    // Once in thirty frames, not every frame.
    expect(brand.reads - before).toBe(2);
  });

  it('goes back to the glow when its context is lost, and copies no blank frame', async () => {
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(1);
    expect(shaderStill.current).not.toBeNull();

    contextLost = true;
    document
      .querySelector('canvas')
      ?.dispatchEvent(new Event('webglcontextlost'));
    expect(shaderStill.current).toBeNull();
    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    step(3);
    expect(encoded).toBe(1);
    expect(shaderStill.current).toBeNull();
  });
});

// A renderer that will not load or start leaves the CSS fallback showing, says
// so once, and stops the loop until the preset changes.
describe('ShaderHero renderer failure', () => {
  /** A renderer whose `init()` refuses, as a two-pass preset does with no
   *  float render targets. */
  const refusing = () =>
    ({
      init: vi.fn(() => false),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    }) satisfies ShaderRenderer;

  const failures = () =>
    logger.warn.mock.calls.filter(
      ([event]) => event === 'shader_hero.renderer_failed'
    );

  beforeEach(() => {
    vi.mocked(loadRenderer).mockClear();
  });

  afterEach(() => {
    logger.warn.mockClear();
  });

  it('logs a renderer that will not load, and asks for no more frames', async () => {
    vi.mocked(loadRenderer).mockRejectedValueOnce(new Error('chunk gone'));
    brand.config = { preset: 'lava' };
    await start({ still: false });
    step(5);
    expect(frames).toHaveLength(0);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(failures()).toEqual([
      [
        'shader_hero.renderer_failed',
        expect.objectContaining({ preset: 'lava', reason: 'load' }),
      ],
    ]);
  });

  it('stays stopped through a wake that leaves the preset, and loads the next one', async () => {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    document.body.appendChild(layout);
    vi.mocked(loadRenderer).mockResolvedValueOnce(refusing());
    brand.config = { preset: 'flux' };
    const props = $state({ still: false });
    await start(props, layout);
    step(3);
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    expect(failures()).toEqual([
      [
        'shader_hero.renderer_failed',
        { preset: 'flux', reason: 'init', hasFloat: false, contextLost: false },
      ],
    ]);

    // Woken by something else (freezing draws a frame): still the same
    // preset, so no second try and no loop.
    props.still = true;
    flushSync();
    step(3);
    // A brand token that is not the preset: the same.
    layout.style.setProperty('--brand-radius', '4px');
    await Promise.resolve();
    step(3);
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);

    // The preset changes, as the brand editor writes it: it loads and draws.
    props.still = false;
    flushSync();
    brand.config = { preset: 'ether' };
    layout.style.setProperty('--brand-shader-preset', 'ether');
    await Promise.resolve();
    step(1);
    await Promise.resolve();
    await Promise.resolve();
    step(2);
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadRenderer).mock.calls[1]?.[0]).toBe('ether');
    expect(renderer.render).toHaveBeenCalled();
    // The failure was said once, not once per wake.
    expect(failures()).toHaveLength(1);
  });

  it('counts an init that throws as an init failure, and frees what it built', async () => {
    const throwing = {
      ...refusing(),
      init: vi.fn((): boolean => {
        throw new Error('bad framebuffer');
      }),
    } satisfies ShaderRenderer;
    vi.mocked(loadRenderer).mockResolvedValueOnce(throwing);
    brand.config = { preset: 'glass' };
    await start({ still: false });
    step(3);
    expect(throwing.destroy).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    expect(failures()).toEqual([
      [
        'shader_hero.renderer_failed',
        expect.objectContaining({
          preset: 'glass',
          reason: 'init',
          hasFloat: false,
          error: 'bad framebuffer',
        }),
      ],
    ]);
  });

  it('retries a load failure once when the browser is back online, then gives up', async () => {
    // The calibration: the retry fires only while the tab is shown.
    expect(document.visibilityState).toBe('visible');
    vi.mocked(loadRenderer)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'));
    brand.config = { preset: 'topo' };
    await start({ still: false });
    expect(loadRenderer).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    step(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadRenderer).mock.calls[1]?.[0]).toBe('topo');

    // Failed again: no third try, whatever comes back.
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    step(3);
    await Promise.resolve();
    expect(loadRenderer).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(0);
    // Said once for the preset and reason, and the retry's outcome once.
    expect(failures()).toHaveLength(1);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.renderer_retry_failed'
      )
    ).toEqual([['shader_hero.renderer_retry_failed', { preset: 'topo' }]]);
  });

  it('reads no config for a brand change that leaves the preset tokens alone', async () => {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    document.body.appendChild(layout);
    vi.mocked(loadRenderer).mockResolvedValueOnce(refusing());
    brand.config = { preset: 'fracture' };
    await start({ still: false }, layout);
    step(2);
    const before = brand.reads;

    layout.style.setProperty('--brand-radius', '4px');
    await Promise.resolve();
    expect(brand.reads).toBe(before);

    // The preset token itself: read, and (another preset) loaded.
    brand.config = { preset: 'ink' };
    layout.style.setProperty('--brand-shader-preset', 'ink');
    await Promise.resolve();
    expect(brand.reads).toBe(before + 1);
  });

  it('watches nothing for a preset fixed by its prop, which cannot change', async () => {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    document.body.appendChild(layout);
    vi.mocked(loadRenderer).mockResolvedValueOnce(refusing());
    brand.config = { preset: 'caustic' };
    await start({ still: false, preset: 'caustic' }, layout);
    step(2);
    const before = brand.reads;

    layout.style.setProperty('--brand-shader-preset', 'ink');
    await Promise.resolve();
    step(2);
    expect(brand.reads).toBe(before);
    expect(loadRenderer).toHaveBeenCalledTimes(1);
  });
});

// `data-live` on the root is what "a shader is painting" reads (the home hero's
// ink, OrgHero's), and the `tone` instance reports the same state to
// `shaderLive` for the org layout's gate.
describe('ShaderHero live', () => {
  const root = () => document.querySelector('.shader-hero') as HTMLElement;
  const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
  const isLive = () => {
    flushSync();
    return root().hasAttribute('data-live');
  };
  const stub = (init: () => boolean = () => true) =>
    ({
      init: vi.fn(init),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    }) satisfies ShaderRenderer;

  beforeEach(() => {
    vi.mocked(loadRenderer).mockClear();
  });

  it('goes live only once a renderer has drawn a frame, and shows the canvas then', async () => {
    await start({ tone: true });
    // Loaded and started, but nothing drawn: not shown, not live.
    expect(vi.mocked(loadRenderer)).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(isLive()).toBe(false);
    expect(canvas().style.opacity).toBe('');
    expect(shaderLive.state).toBe('pending');

    step(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(isLive()).toBe(true);
    expect(canvas().style.opacity).toBe('1');
    expect(shaderLive.state).toBe('live');
  });

  it('goes live from the one frame a still shader draws', async () => {
    await start({ still: true, tone: true });
    expect(isLive()).toBe(false);
    step(1);
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('live');
  });

  it('is never live with no preset, and reports none', async () => {
    brand.config = { preset: 'none' };
    await start({ tone: true });
    step(3);
    expect(isLive()).toBe(false);
    expect(canvas().style.opacity).toBe('0');
    expect(shaderLive.state).toBe('none');
  });

  it('is never live when its renderer will not load, and reports failed', async () => {
    vi.mocked(loadRenderer).mockRejectedValueOnce(new Error('chunk gone'));
    await start({ tone: true });
    step(3);
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('failed');
  });

  it('reports failed with no WebGL, and none when there was nothing to draw', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await start({ tone: true });
    flushSync();
    expect(document.querySelector('canvas')).toBeNull();
    expect(root().hasAttribute('data-live')).toBe(false);
    expect(shaderLive.state).toBe('failed');
    if (app) unmount(app);
    app = null;
    expect(shaderLive.state).toBe('pending');

    brand.config = { preset: 'none' };
    await start({ tone: true });
    expect(shaderLive.state).toBe('none');
  });

  it('stays live through a switch while the new renderer loads, as the old frame stays shown', async () => {
    box = { width: 1200, height: 800 };
    await start({ tone: true });
    step(1);
    expect(isLive()).toBe(true);

    let finishLoad: (r: ShaderRenderer) => void = () => {};
    vi.mocked(loadRenderer).mockImplementationOnce(
      () =>
        new Promise<ShaderRenderer | null>((resolve) => {
          finishLoad = resolve;
        })
    );
    brand.config = { preset: 'lava' };
    step(30); // the poll spots the new preset and starts loading it
    expect(vi.mocked(loadRenderer).mock.calls.at(-1)?.[0]).toBe('lava');
    expect(isLive()).toBe(true);
    expect(canvas().style.opacity).toBe('1');

    // A resize mid-load keeps the old frame: resizing the canvas would clear
    // it to black, with no renderer to redraw it, so it keeps its size.
    const before = { width: canvas().width, height: canvas().height };
    expect(before).toEqual({ width: 1200, height: 800 });
    box = { width: 900, height: 700 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    expect({ width: canvas().width, height: canvas().height }).toEqual(before);

    const next = stub();
    finishLoad(next);
    await Promise.resolve();
    await Promise.resolve();
    // Installed and not yet drawn: still live (the old frame is on screen),
    // and the size the resize asked for is applied before init.
    expect(isLive()).toBe(true);
    expect({ width: canvas().width, height: canvas().height }).toEqual({
      width: 900,
      height: 700,
    });
    expect(next.init).toHaveBeenCalledWith(expect.anything(), 900, 700);
    step(1);
    expect(next.render).toHaveBeenCalledTimes(1);
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('live');
  });

  it('stops being live when the brand switches the shader off, or the new one fails', async () => {
    await start({ tone: true });
    step(1);
    brand.config = { preset: 'none' };
    step(30);
    expect(isLive()).toBe(false);
    expect(canvas().style.opacity).toBe('0');
    expect(shaderLive.state).toBe('none');

    vi.mocked(loadRenderer).mockResolvedValueOnce(stub(() => false));
    brand.config = { preset: 'flux' };
    step(30);
    await Promise.resolve();
    await Promise.resolve();
    step(1);
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('failed');
  });

  it('stops being live when its context is lost, logs it, and stops its loop', async () => {
    // An earlier test's loss may have logged: count only this one's.
    logger.warn.mockClear();
    await start({ tone: true });
    step(1);
    expect(isLive()).toBe(true);

    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost'));
    expect(isLive()).toBe(false);
    expect(canvas().style.opacity).toBe('0');
    expect(shaderLive.state).toBe('failed');
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.context_lost'
      )
    ).toEqual([['shader_hero.context_lost', { preset: 'ether' }]]);

    // Nothing more is drawn on a context that cannot show it, and the loop
    // asks for no frame (it used to spin at full rate on the dead context).
    const drawn = renderer.render.mock.calls.length;
    step(3);
    expect(renderer.render.mock.calls.length).toBe(drawn);
    expect(frames).toHaveLength(0);
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('failed');
  });

  it('reports only from the `tone` instance, and goes back to pending on unmount', async () => {
    await start({ tone: false });
    step(1);
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('pending');
    if (app) unmount(app);
    app = null;
    // The stand-in cancelAnimationFrame cancels nothing: drop the old frame.
    frames = [];

    await start({ tone: true });
    step(1);
    expect(shaderLive.state).toBe('live');
    if (app) unmount(app);
    app = null;
    expect(shaderLive.state).toBe('pending');
  });
});

// ── The shader windows' frames (`shader-frame.svelte.ts`) ─────────
describe('ShaderHero publishFrames', () => {
  const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
  /** A shader window's stand-in: how many draws the renderer had made each
   *  time it was handed a frame (an `expect` in it would be caught). */
  const listen = () => {
    const rendersSeen: number[] = [];
    releases.push(
      onShaderFrame(() => rendersSeen.push(renderer.render.mock.calls.length))
    );
    return rendersSeen;
  };

  it('hands each frame it draws to the windows, straight after the draw', async () => {
    const rendersSeen = listen();
    await start({ publishFrames: true });
    expect(isShaderLive()).toBe(false);
    step(3);
    expect(rendersSeen).toEqual([1, 2, 3]);
    expect(isShaderLive()).toBe(true);
  });

  it('hands the windows the canvas it draws on', async () => {
    let seen: HTMLCanvasElement | null = null;
    releases.push(
      onShaderFrame((source) => {
        seen = source;
      })
    );
    await start({ publishFrames: true });
    step(1);
    expect(seen).toBe(canvas());
  });

  it('publishes nothing, and nothing is live, without the prop', async () => {
    const rendersSeen = listen();
    await start({ tone: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(rendersSeen).toEqual([]);
    expect(isShaderLive()).toBe(false);
  });

  it('draws a still frame once more when a window asks, and moves on untouched', async () => {
    const rendersSeen = listen();
    await start({ still: true, publishFrames: true });
    step(3);
    expect(rendersSeen).toEqual([1]);
    expect(frames).toHaveLength(0);

    requestShaderFrame();
    // Two windows asking at once draw it once.
    requestShaderFrame();
    step(3);
    expect(rendersSeen).toEqual([1, 2]);
    if (app) unmount(app);
    app = null;

    // Moving, a frame is coming anyway: asking schedules no other.
    await start({ publishFrames: true });
    step(1);
    expect(frames).toHaveLength(1);
    requestShaderFrame();
    expect(frames).toHaveLength(1);
  });

  it('is not live with no preset, once its context is lost, or once unmounted', async () => {
    const rendersSeen = listen();
    brand.config = { preset: 'none' };
    await start({ publishFrames: true });
    step(3);
    expect(isShaderLive()).toBe(false);
    expect(rendersSeen).toEqual([]);
    if (app) unmount(app);
    app = null;
    frames = [];

    brand.config = { preset: 'ether' };
    await start({ publishFrames: true });
    step(1);
    expect(isShaderLive()).toBe(true);
    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost'));
    expect(isShaderLive()).toBe(false);
    if (app) unmount(app);
    app = null;
    frames = [];
    contextLost = false;

    await start({ publishFrames: true });
    step(1);
    expect(isShaderLive()).toBe(true);
    if (app) unmount(app);
    app = null;
    expect(isShaderLive()).toBe(false);
  });
});

// ── The brand shader stack and context restore ─────────
describe('ShaderHero stack', () => {
  const root = () => document.querySelector('.shader-hero') as HTMLElement;
  const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
  const isLive = () => {
    flushSync();
    return root().hasAttribute('data-live');
  };
  /** The canvas shows a frame: a shader's, or the Showreel's plain ground. */
  const isDrawn = () => {
    flushSync();
    return root().hasAttribute('data-drawn');
  };
  const size = () => [canvas().width, canvas().height];
  const withLayers: StackConfig = {
    ...BARE_STACK,
    layers: [{ id: 'grain', amount: null }],
  };
  /** Let a dynamic import (the compositor's chunk) and its follow-up settle. */
  async function settle() {
    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
  }
  const events = (level: 'warn' | 'info', name: string) =>
    logger[level].mock.calls.filter(([event]) => event === name);

  beforeEach(() => {
    // A cancelAnimationFrame that cancels, as a browser's does: a lost
    // context's handler cancels the frame already queued.
    let rafId = 0;
    const queued = new Map<number, FrameRequestCallback>();
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
    brandStack.value = null;
    showreelFeed.setMedia(null);
    showreelFeed.setStage(null);
    showreelFeed.setNameMask(null);
    showreelFeed.setLook(null);
    showreelFeed.setMotion(null);
    // A phone at DPR 3: the scene renders at DPR 1, the output at 2.
    vi.stubGlobal('devicePixelRatio', 3);
    box = { width: 390, height: 844 };
    vi.mocked(loadRenderer).mockReset();
    vi.mocked(loadRenderer).mockImplementation(async () => renderer);
    vi.mocked(createCompositor).mockClear();
    vi.mocked(resetJFACache).mockClear();
    for (const fn of Object.values(compositor)) fn.mockClear();
    compositor.render.mockImplementation(() => true);
    compositor.mediaReady.mockReturnValue(false);
    renderer.init.mockClear();
    renderer.resize.mockClear();
    renderer.destroy.mockClear();
    logger.warn.mockClear();
    logger.info.mockClear();
  });

  it('takes today’s path for a bare stack: no compositor, the canvas at the scene’s DPR', async () => {
    await start({ tone: true });
    step(3);
    await settle();
    step(1);
    expect(createCompositor).not.toHaveBeenCalled();
    expect(size()).toEqual([390, 844]);
    expect(renderer.init).toHaveBeenCalledWith(expect.anything(), 390, 844);
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(renderer.render).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.anything(),
      brand.config,
      390,
      844
    );
    expect(compositor.render).not.toHaveBeenCalled();
  });

  it('attaches the compositor for a stack: the canvas rises to the output DPR, the presets keep the scene’s', async () => {
    brandStack.value = withLayers;
    await start({ tone: true });
    step(1);
    await settle();
    expect(createCompositor).toHaveBeenCalledTimes(1);
    expect(size()).toEqual([780, 1688]);
    // The preset was built at the scene's size and is never resized for it.
    expect(renderer.init).toHaveBeenCalledWith(expect.anything(), 390, 844);
    expect(renderer.resize).not.toHaveBeenCalled();

    renderer.render.mockClear();
    step(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        base: renderer,
        stack: withLayers,
        scene: [390, 844],
        output: [780, 1688],
        second: null,
        phone: true,
      })
    );
    expect(isLive()).toBe(true);

    // The brand takes its layers away: bare again, today's canvas.
    brandStack.value = BARE_STACK;
    step(30);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect(size()).toEqual([390, 844]);
    renderer.render.mockClear();
    step(1);
    expect(renderer.render).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.anything(),
      brand.config,
      390,
      844
    );
  });

  it('stacks nothing on a surface whose preset is fixed by its prop', async () => {
    brandStack.value = withLayers;
    await start({ preset: 'flow' });
    step(3);
    await settle();
    expect(createCompositor).not.toHaveBeenCalled();
  });

  it('draws the base alone, from then on, when the compositor cannot draw', async () => {
    brandStack.value = withLayers;
    compositor.render.mockImplementation(() => false);
    await start({ tone: true });
    step(1);
    await settle();
    renderer.render.mockClear();
    step(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect(size()).toEqual([390, 844]);
    step(30);
    await settle();
    expect(createCompositor).toHaveBeenCalledTimes(1);
  });

  it('loads a second preset beside the base, at half the scene’s size on a phone', async () => {
    const second = {
      init: vi.fn(() => true),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    vi.mocked(loadRenderer).mockImplementation(async (id) =>
      id === 'flow' ? second : renderer
    );
    brandStack.value = { ...BARE_STACK, second: 'flow' };
    await start({ tone: true });
    step(1);
    await settle();
    expect(second.init).toHaveBeenCalledWith(expect.anything(), 195, 422);
    step(1);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        base: renderer,
        second,
        secondSize: [195, 422],
      })
    );
  });

  it('keeps the base live when the second preset fails, and logs the failure', async () => {
    vi.mocked(loadRenderer).mockImplementation(async (id) => {
      if (id === 'flow') throw new Error('chunk gone');
      return renderer;
    });
    brandStack.value = { ...BARE_STACK, second: 'flow' };
    await start({ tone: true });
    step(1);
    await settle();
    expect(events('warn', 'shader_hero.second_failed')).toEqual([
      [
        'shader_hero.second_failed',
        expect.objectContaining({
          preset: 'flow',
          reason: 'load',
          error: 'chunk gone',
        }),
      ],
    ]);
    // Live through the failure itself, not only once a later frame draws.
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('live');
    // The stack without its second is bare: today's path, still drawing.
    renderer.render.mockClear();
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(size()).toEqual([390, 844]);
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('live');
    expect(frames).toHaveLength(1);
    // Not tried again on every poll.
    step(60);
    await settle();
    expect(
      vi.mocked(loadRenderer).mock.calls.filter(([id]) => id === 'flow')
    ).toHaveLength(1);
  });

  it('drops the second preset on a phone that cannot hold the frame rate, and logs it', async () => {
    const second = {
      init: vi.fn(() => true),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    vi.mocked(loadRenderer).mockImplementation(async (id) =>
      id === 'flow' ? second : renderer
    );
    brandStack.value = { ...BARE_STACK, second: 'flow' };
    await start({ tone: true });
    step(1);
    await settle();
    // 120 frames 40 ms apart: a 95th percentile far over 25 ms.
    for (let i = 0; i < 121; i++) {
      clock += 40;
      step(1);
    }
    expect(events('warn', 'shader_hero.stack_budget_dropped')).toEqual([
      [
        'shader_hero.stack_budget_dropped',
        { preset: 'flow', p95Ms: 40, frames: 120 },
      ],
    ]);
    step(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect(isLive()).toBe(true);
  });

  describe('the phone budget for layers (behind PHONE_LAYER_BUDGET)', () => {
    const layered = {
      ...BARE_STACK,
      layers: [
        { id: 'grain', amount: null },
        { id: 'glow', amount: null },
      ],
    } as StackConfig;
    /** The stack the compositor was last asked to draw. */
    const drawnLayers = () => {
      const frame: unknown = compositor.render.mock.calls.at(-1)?.[0];
      return (frame as { stack: StackConfig }).stack.layers.map((l) => l.id);
    };
    const slow = (count: number) => {
      for (let i = 0; i < count; i++) {
        clock += 40;
        step(1);
      }
    };
    const cuts = () => events('warn', 'shader_hero.stack_budget_layer_dropped');

    it('cuts nothing while off, as shipped: a layers-only stack stays whole', async () => {
      brandStack.value = layered;
      await start({ tone: true });
      step(1);
      await settle();
      slow(241);
      expect(cuts()).toEqual([]);
      expect(drawnLayers()).toEqual(['grain', 'glow']);
    });

    it('on, cuts the last layer each slow window on a phone, logs each, and goes bare after the last', async () => {
      layerBudgetFlag.on = true;
      brandStack.value = layered;
      await start({ tone: true });
      step(1);
      await settle();
      // 120 frames 40 ms apart: a 95th percentile far over 25 ms.
      slow(121);
      expect(cuts()).toEqual([
        [
          'shader_hero.stack_budget_layer_dropped',
          { layer: 'glow', remaining: 1, p95Ms: 40, frames: 120 },
        ],
      ]);
      step(1);
      expect(drawnLayers()).toEqual(['grain']);
      // judged afresh on the lighter stack: another slow window cuts again
      slow(120);
      expect(cuts()).toHaveLength(2);
      expect(cuts()[1]).toEqual([
        'shader_hero.stack_budget_layer_dropped',
        { layer: 'grain', remaining: 0, p95Ms: 40, frames: 120 },
      ]);
      // bare: today's path, without a compositor
      step(1);
      await settle();
      expect(compositor.destroy).toHaveBeenCalledTimes(1);
      expect(isLive()).toBe(true);
      // nothing left to judge
      slow(121);
      expect(cuts()).toHaveLength(2);
    });

    it('on, drops the second preset first, then judges the layers afresh', async () => {
      layerBudgetFlag.on = true;
      const second = {
        init: vi.fn(() => true),
        render: vi.fn(),
        resize: vi.fn(),
        reset: vi.fn(),
        destroy: vi.fn(),
      } satisfies ShaderRenderer;
      vi.mocked(loadRenderer).mockImplementation(async (id) =>
        id === 'flow' ? second : renderer
      );
      brandStack.value = { ...layered, second: 'flow' };
      await start({ tone: true });
      step(1);
      await settle();
      slow(121);
      expect(events('warn', 'shader_hero.stack_budget_dropped')).toHaveLength(
        1
      );
      expect(cuts()).toEqual([]);
      step(1);
      expect(second.destroy).toHaveBeenCalledTimes(1);
      slow(121);
      expect(cuts()).toEqual([
        [
          'shader_hero.stack_budget_layer_dropped',
          { layer: 'glow', remaining: 1, p95Ms: 40, frames: 120 },
        ],
      ]);
    });

    it('on, judges a desktop never', async () => {
      layerBudgetFlag.on = true;
      box = { width: 1440, height: 900 };
      brandStack.value = layered;
      await start({ tone: true });
      step(1);
      await settle();
      slow(241);
      expect(cuts()).toEqual([]);
    });
  });

  it('prevents a lost context’s default (or it is never restored), and stops its loop', async () => {
    await start({ tone: true });
    step(1);
    contextLost = true;
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas().dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    step(3);
    expect(frames).toHaveLength(0);
  });

  it('rebuilds on a restored context, deleting nothing dead, and goes live once it draws', async () => {
    await start({ tone: true });
    step(1);
    expect(isLive()).toBe(true);
    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('failed');

    renderer.init.mockClear();
    renderer.render.mockClear();
    contextLost = false;
    canvas().dispatchEvent(new Event('webglcontextrestored'));
    await settle();
    // Its objects died with the old context: forgotten, never deleted.
    expect(renderer.destroy).not.toHaveBeenCalled();
    expect(resetJFACache).toHaveBeenCalledTimes(1);
    expect(renderer.init).toHaveBeenCalledWith(expect.anything(), 390, 844);
    expect(events('info', 'shader_hero.context_restored')).toEqual([
      ['shader_hero.context_restored', { preset: 'ether' }],
    ]);
    // Live again from the first frame it draws, and moving.
    expect(isLive()).toBe(false);
    step(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(isLive()).toBe(true);
    expect(shaderLive.state).toBe('live');
    expect(frames).toHaveLength(1);
  });

  it('forgets the compositor’s objects on a restored context, and composites again', async () => {
    brandStack.value = withLayers;
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    contextLost = false;
    compositor.render.mockClear();
    canvas().dispatchEvent(new Event('webglcontextrestored'));
    await settle();
    expect(compositor.forget).toHaveBeenCalledTimes(1);
    expect(compositor.destroy).not.toHaveBeenCalled();
    step(1);
    expect(compositor.render).toHaveBeenCalledTimes(1);
    expect(isLive()).toBe(true);
  });

  // An org with no brand shader still gets the Showreel, its film on a plain
  // ground; with no film it draws nothing, as today.
  const film = () =>
    ({ videoWidth: 720, videoHeight: 1280 }) as unknown as HTMLVideoElement;

  it('plays a film with no brand shader on a plain ground: drawn, but no shader under the words', async () => {
    brand.config = { preset: 'none' };
    const video = film();
    showreelFeed.setMedia(video);
    await start({ tone: true });
    step(1);
    await settle();
    expect(loadRenderer).not.toHaveBeenCalled();
    expect(createCompositor).toHaveBeenCalledTimes(1);
    expect(compositor.setMedia).toHaveBeenCalledWith(video);
    expect(size()).toEqual([780, 1688]);
    step(1);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        base: null,
        baseConfig: brand.config,
        output: [780, 1688],
      })
    );
    // Drawn (the Showreel keys on that), but not live: the words keep the
    // page's ink, and the layout's gate hears 'none'.
    expect(isDrawn()).toBe(true);
    expect(canvas().style.opacity).toBe('1');
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('none');
    // A drawn plain ground resizes like any frame (no preset is loading).
    box = { width: 400, height: 800 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    expect(size()).toEqual([800, 1600]);
    box = { width: 390, height: 844 };
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);

    // The film ends: nothing left to draw, so it hides, as no preset does,
    // and keeps polling for a preset the brand may set.
    showreelFeed.setMedia(null);
    expect(compositor.setMedia).toHaveBeenLastCalledWith(null);
    step(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect(isDrawn()).toBe(false);
    expect(isLive()).toBe(false);
    expect(shaderLive.state).toBe('none');
    expect(size()).toEqual([390, 844]);
    expect(frames).toHaveLength(1);
  });

  it('says which it draws as the brand moves from a plain ground to a shader and back', async () => {
    brand.config = { preset: 'none' };
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      false,
      'none',
    ]);

    brand.config = { preset: 'ether' };
    step(30);
    await settle();
    step(1);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: renderer })
    );
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      true,
      'live',
    ]);

    brand.config = { preset: 'none' };
    step(30);
    step(1);
    expect(renderer.destroy).toHaveBeenCalled();
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: null })
    );
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      false,
      'none',
    ]);
    // Through it all the canvas never hid.
    expect(canvas().style.opacity).toBe('1');
  });

  // Owner's call B: a brand shader that will not start (an FBO preset on a
  // phone without float targets) still lets the film play.
  it('plays the film on a plain ground when the brand’s shader will not start, and says failed', async () => {
    brand.config = { preset: 'fracture' };
    vi.mocked(loadRenderer).mockImplementation(async (id) => {
      if (id === 'fracture') throw new Error('chunk gone');
      return renderer;
    });
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    step(5);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.renderer_failed'
      )
    ).toEqual([
      [
        'shader_hero.renderer_failed',
        expect.objectContaining({ preset: 'fracture', reason: 'load' }),
      ],
    ]);
    // Tried once, not every frame it draws the ground.
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: null })
    );
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      false,
      'failed',
    ]);

    // The film ends: today's stop-and-hide.
    showreelFeed.setMedia(null);
    step(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      false,
      false,
      'failed',
    ]);
    expect(frames).toHaveLength(0);
  });

  it('draws a failed base’s film on a PLAIN ground: none of its stack, and the stack back once a base draws', async () => {
    const second = {
      init: vi.fn(() => true),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    const stack: StackConfig = {
      ...BARE_STACK,
      second: 'aurora',
      layers: [{ id: 'grain', amount: null }],
    };
    brandStack.value = stack;
    brand.config = { preset: 'fracture' };
    vi.mocked(loadRenderer).mockImplementation(async (id) => {
      if (id === 'fracture') throw new Error('chunk gone');
      return id === 'aurora' ? second : renderer;
    });
    showreelFeed.setMedia(film());
    await start({ tone: true });
    for (let i = 0; i < 4; i++) {
      step(1);
      await settle();
    }
    // The stack was parsed against the failed base: its second never loads,
    // and the ground goes without the layers too.
    expect(vi.mocked(loadRenderer).mock.calls.map(([id]) => id)).toEqual([
      'fracture',
    ]);
    const plain = compositor.render.mock.calls.at(-1)?.[0] as unknown as {
      base: unknown;
      second: unknown;
      stack: StackConfig;
    };
    expect(plain.base).toBeNull();
    expect(plain.second).toBeNull();
    expect(plain.stack).toEqual({ ...stack, second: null, layers: [] });
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      false,
      'failed',
    ]);

    // The brand moves to a preset that starts: its stack comes back.
    brand.config = { preset: 'ripple' };
    step(30);
    await settle();
    step(1);
    await settle();
    step(1);
    expect(vi.mocked(loadRenderer).mock.calls.map(([id]) => id)).toEqual([
      'fracture',
      'ripple',
      'aurora',
    ]);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: renderer, second, stack })
    );
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      true,
      true,
      'live',
    ]);
  });

  it('stops and hides a brand shader that will not start when there is no film, as today', async () => {
    brand.config = { preset: 'fracture' };
    vi.mocked(loadRenderer).mockRejectedValue(new Error('chunk gone'));
    await start({ tone: true });
    step(3);
    await settle();
    expect(createCompositor).not.toHaveBeenCalled();
    expect(compositor.render).not.toHaveBeenCalled();
    expect([isDrawn(), isLive(), shaderLive.state]).toEqual([
      false,
      false,
      'failed',
    ]);
    expect(frames).toHaveLength(0);
  });

  // Review round 1 (silent-failure-hunter), folded from its probes.
  it('drops the studio’s still copy on a stack-only edit, as on any brand edit (P1)', async () => {
    box = { width: 1200, height: 800 };
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    document.body.appendChild(layout);
    await start({ still: true, tone: true }, layout);
    step(1);
    await settle();
    step(1);
    const before = shaderStill.current;
    expect(before).not.toBeNull();
    // An edit that changes neither the config nor the stack keeps the copy.
    layout.setAttribute('style', '--brand-unrelated: 1');
    await new Promise((settled) => setTimeout(settled, 320));
    expect(shaderStill.current).toEqual(before);
    // A stack-only edit draws another picture: the copy goes.
    brandStack.value = withLayers;
    layout.setAttribute('style', '--brand-shader-layers: grain');
    await new Promise((settled) => setTimeout(settled, 320));
    expect(shaderStill.current).not.toEqual(before);
  });

  it('latches nothing for a compositor that failed because the context was lost, and composites after the restore (P2)', async () => {
    brandStack.value = withLayers;
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    compositor.render.mockImplementationOnce(() => {
      contextLost = true;
      return false;
    });
    step(1);
    expect(compositor.destroy).not.toHaveBeenCalled();
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    contextLost = false;
    canvas().dispatchEvent(new Event('webglcontextrestored'));
    await settle();
    compositor.render.mockClear();
    step(2);
    expect(compositor.render).toHaveBeenCalledTimes(2);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.compositor_failed'
      )
    ).toEqual([]);
  });

  it('gives a compositor that failed for real another go after a restore', async () => {
    brandStack.value = withLayers;
    compositor.render.mockImplementationOnce(() => false);
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    step(30);
    await settle();
    expect(createCompositor).toHaveBeenCalledTimes(1);

    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    contextLost = false;
    canvas().dispatchEvent(new Event('webglcontextrestored'));
    await settle();
    step(1);
    await settle();
    expect(createCompositor).toHaveBeenCalledTimes(2);
  });

  it('keeps its loop through a throw out of the compositor, logs it, and draws the base alone (P3)', async () => {
    brandStack.value = withLayers;
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    const boom = new Error('a preset threw');
    compositor.render.mockImplementationOnce(() => {
      throw boom;
    });
    renderer.render.mockClear();
    expect(() => step(1)).not.toThrow();
    expect(frames).toHaveLength(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(compositor.destroy).toHaveBeenCalledTimes(1);
    expect(
      logger.warn.mock.calls.filter(
        ([event]) => event === 'shader_hero.compositor_failed'
      )
    ).toEqual([
      [
        'shader_hero.compositor_failed',
        expect.objectContaining({ what: 'render', error: 'a preset threw' }),
      ],
    ]);
    expect(isLive()).toBe(true);
  });

  it('drops a second preset that throws in its render, logs it, and never loads it again', async () => {
    const second = {
      init: vi.fn(() => true),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    vi.mocked(loadRenderer).mockImplementation(async (id) =>
      id === 'flow' ? second : renderer
    );
    brandStack.value = { ...BARE_STACK, second: 'flow' };
    await start({ tone: true });
    step(1);
    await settle();
    const boom = new Error('second.render threw');
    compositor.render.mockImplementationOnce(
      (f: { onSecondFailed?: (e: unknown) => void }) => {
        f.onSecondFailed?.(boom);
        return true;
      }
    );
    step(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(events('warn', 'shader_hero.second_failed')).toEqual([
      [
        'shader_hero.second_failed',
        expect.objectContaining({
          preset: 'flow',
          reason: 'render',
          error: 'second.render threw',
        }),
      ],
    ]);
    step(60);
    await settle();
    expect(
      vi.mocked(loadRenderer).mock.calls.filter(([id]) => id === 'flow')
    ).toHaveLength(1);
    expect(isLive()).toBe(true);
  });

  it('latches nothing for a second preset whose init failed on a lost context, and loads it after the restore', async () => {
    let finish: (r: ShaderRenderer) => void = () => {};
    const second = {
      init: vi.fn(() => !contextLost),
      render: vi.fn(),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    vi.mocked(loadRenderer).mockImplementation((id) =>
      id === 'flow'
        ? new Promise<ShaderRenderer | null>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(renderer)
    );
    brandStack.value = { ...BARE_STACK, second: 'flow' };
    await start({ tone: true });
    step(1);
    // Lost while the second loads: its init fails.
    contextLost = true;
    finish(second);
    await settle();
    expect(events('warn', 'shader_hero.second_failed')).toEqual([]);
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    contextLost = false;
    canvas().dispatchEvent(new Event('webglcontextrestored'));
    await settle();
    step(1);
    await settle();
    expect(
      vi.mocked(loadRenderer).mock.calls.filter(([id]) => id === 'flow')
    ).toHaveLength(2);
  });

  it('draws nothing with no brand shader and no film, exactly as today, even over a stack', async () => {
    brand.config = { preset: 'none' };
    brandStack.value = withLayers;
    await start({ tone: true });
    step(3);
    await settle();
    step(1);
    expect(createCompositor).not.toHaveBeenCalled();
    expect(loadRenderer).not.toHaveBeenCalled();
    expect(compositor.render).not.toHaveBeenCalled();
    expect(isLive()).toBe(false);
    expect(canvas().style.opacity).toBe('0');
    expect(shaderLive.state).toBe('none');
    expect(frames).toHaveLength(1);
  });

  it('attaches for a film over a brand shader whose stack is bare', async () => {
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    expect(compositor.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ base: renderer, stack: BARE_STACK })
    );
  });

  it('leaves the film to the window’s shader: a hero without `tone` ignores it', async () => {
    showreelFeed.setMedia(film());
    await start({});
    step(2);
    await settle();
    step(1);
    expect(createCompositor).not.toHaveBeenCalled();
  });

  it('hands the compositor the film’s frame and the name mask as they change', async () => {
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    const box = {
      left: 0,
      top: 120,
      width: 300,
      height: 500,
      fadeDistance: 600,
    };
    const mask = {} as TexImageSource;
    showreelFeed.setStage(box);
    showreelFeed.setNameMask(mask);
    expect(compositor.setStage).toHaveBeenLastCalledWith(box);
    expect(compositor.setNameMask).toHaveBeenLastCalledWith(mask);
  });

  it('hands the compositor the Showreel’s look, on attach and as it changes', async () => {
    const look = { frame: 'film-name', band: 'none' } as const;
    showreelFeed.setLook(look);
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    expect(compositor.setLook).toHaveBeenLastCalledWith(look);
    const fade = { frame: 'film-fill', band: 'fade' } as const;
    showreelFeed.setLook(fade);
    expect(compositor.setLook).toHaveBeenLastCalledWith(fade);
  });

  // The Showreel's motion reaches the compositor as its look does, and a frozen
  // hero draws each frame the motion moves.
  const motionOf = (choice: MotionChoice = STILL_MOTION): FilmMotion => ({
    choice,
    values: restMotion(),
    running: null,
  });

  it('hands the compositor the Showreel’s motion, on attach and as it changes', async () => {
    const first = motionOf();
    showreelFeed.setMotion(first);
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    expect(compositor.setMotion).toHaveBeenLastCalledWith(first);
    // A new motion is its own message: it is no name mask.
    const masks = compositor.setNameMask.mock.calls.length;
    const next = motionOf({ ...STILL_MOTION, pointer: 'smoke' });
    showreelFeed.setMotion(next);
    expect(compositor.setMotion).toHaveBeenLastCalledWith(next);
    expect(compositor.setNameMask).toHaveBeenCalledTimes(masks);
    showreelFeed.setMotion(null);
    expect(compositor.setMotion).toHaveBeenLastCalledWith(null);
  });

  it('draws a frozen hero again for each frame its motion moves, and no more', async () => {
    showreelFeed.setMedia(film());
    await start({ tone: true, still: true });
    step(1);
    await settle();
    step(3);
    const drawn = compositor.render.mock.calls.length;
    // No motion: a motion frame is no word at all.
    showreelFeed.motionFrame();
    step(3);
    expect(compositor.render).toHaveBeenCalledTimes(drawn);

    showreelFeed.setMotion(motionOf());
    step(3);
    const still = compositor.render.mock.calls.length;
    showreelFeed.motionFrame();
    step(1);
    expect(compositor.render).toHaveBeenCalledTimes(still + 1);
    // Frozen again: nothing more until the motion moves.
    step(3);
    expect(compositor.render).toHaveBeenCalledTimes(still + 1);
  });

  // The Showreel hides its own copy of the film only while the canvas shows
  // it: a lost context or a detached compositor shows the page's again.
  it('says `data-film` only while the compositor holds a frame of the film', async () => {
    const hasFilm = () => {
      flushSync();
      return root().hasAttribute('data-film');
    };
    showreelFeed.setMedia(film());
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    expect(compositor.render).toHaveBeenCalled();
    expect(hasFilm()).toBe(false);

    compositor.mediaReady.mockReturnValue(true);
    step(1);
    expect(hasFilm()).toBe(true);

    contextLost = true;
    canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(hasFilm()).toBe(false);
  });

  it('drops `data-film` when the film ends and the compositor detaches', async () => {
    showreelFeed.setMedia(film());
    compositor.mediaReady.mockReturnValue(true);
    await start({ tone: true });
    step(1);
    await settle();
    step(1);
    flushSync();
    expect(root().hasAttribute('data-film')).toBe(true);
    showreelFeed.setMedia(null);
    step(2);
    flushSync();
    expect(root().hasAttribute('data-film')).toBe(false);
  });
});

// A press is the burst's rise from one frame to the next: a renderer splashes
// on each one (ripple's click edge). One gesture, one rise.
describe('ShaderHero press', () => {
  /** A renderer that keeps the burst each frame drew with. */
  function counting() {
    const bursts: number[] = [];
    const r = {
      init: vi.fn(() => true),
      render: vi.fn((...args: Parameters<ShaderRenderer['render']>) => {
        const mouse: MouseState = args[2];
        bursts.push(mouse.burstStrength);
      }),
      resize: vi.fn(),
      reset: vi.fn(),
      destroy: vi.fn(),
    } satisfies ShaderRenderer;
    const rises = () =>
      bursts.filter((burst, i) => burst > (bursts[i - 1] ?? 0)).length;
    return { r, bursts, rises };
  }
  /** Frames for `ms`, 16 ms apart. */
  function play(ms: number) {
    for (let t = 0; t < ms; t += 16) {
      clock += 16;
      step(1);
    }
  }
  const at = { clientX: 40, clientY: 30 };
  const pointerDown = (pointerType: string, isPrimary = true, button = 0) =>
    window.dispatchEvent(
      new PointerEvent('pointerdown', { ...at, pointerType, isPrimary, button })
    );
  const touch = (type: 'touchstart' | 'touchend') => {
    const event = new Event(type);
    Object.defineProperty(event, 'touches', {
      value: type === 'touchstart' ? [at] : [],
    });
    window.dispatchEvent(event);
  };
  const click = () => window.dispatchEvent(new MouseEvent('click', at));
  /** What a finger's tap sends: the press, then ~100 ms on, the
   *  browser's compatibility click. */
  function tap() {
    pointerDown('touch');
    touch('touchstart');
    play(100);
    touch('touchend');
    click();
  }

  beforeEach(() => {
    vi.mocked(loadRenderer).mockClear();
  });

  it('counts a tap once, though the browser also sends it a click', async () => {
    const { r, rises } = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(r);
    await start({});
    play(100);
    tap();
    play(600);
    expect(rises()).toBe(1);
  });

  it('counts a mouse click once, and a keyboard’s click (no press) not at all', async () => {
    const { r, rises } = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(r);
    await start({});
    play(100);
    click();
    play(600);
    expect(rises()).toBe(0);

    pointerDown('mouse');
    play(50);
    click();
    play(600);
    expect(rises()).toBe(1);
  });

  it('counts a left-button press, never a right or middle one', async () => {
    const { r, rises } = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(r);
    await start({});
    play(100);
    pointerDown('mouse', true, 2);
    play(600);
    pointerDown('mouse', true, 1);
    play(600);
    expect(rises()).toBe(0);

    pointerDown('mouse', true, 0);
    play(600);
    expect(rises()).toBe(1);
  });

  it('counts two taps a second apart twice, and a second finger not at all', async () => {
    const { r, rises } = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(r);
    await start({});
    play(100);
    tap();
    play(1000);
    tap();
    // A second finger lands: its own pointerdown, and a touchstart.
    pointerDown('touch', false);
    touch('touchstart');
    play(600);
    expect(rises()).toBe(2);
  });

  it('leaves no splash for the still frame or the thaw of a press that froze it', async () => {
    const { r, bursts, rises } = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(r);
    await start({ tone: true });
    play(100);
    pointerDown('mouse');
    // The press holds the page (its motion dial) before the next frame.
    const release = shaderTone.hold();
    releases.push(release);
    play(100);
    expect(r.render).toHaveBeenCalled();
    const frozenFrom = bursts.length - 1;
    release();
    play(600);
    expect(bursts.slice(frozenFrom).every((burst) => burst === 0)).toBe(true);
    expect(rises()).toBe(0);
  });

  it('carries no press into the preset it switches to', async () => {
    const before = counting();
    vi.mocked(loadRenderer).mockResolvedValueOnce(before.r);
    await start({});
    play(100);

    let finishLoad: (r: ShaderRenderer) => void = () => {};
    vi.mocked(loadRenderer).mockImplementationOnce(
      () =>
        new Promise<ShaderRenderer | null>((resolve) => {
          finishLoad = resolve;
        })
    );
    brand.config = { preset: 'lava' };
    step(30); // the poll spots the new preset and starts loading it
    expect(vi.mocked(loadRenderer).mock.calls.at(-1)?.[0]).toBe('lava');
    pointerDown('mouse');
    const after = counting();
    finishLoad(after.r);
    await Promise.resolve();
    await Promise.resolve();
    play(300);
    expect(after.r.render).toHaveBeenCalled();
    expect(after.rises()).toBe(0);
  });
});
