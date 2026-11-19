/**
 * ShaderHero's `still`: one static frame, then no more frames until it is
 * turned off. The org layout sets it on studio routes, where the shader sits
 * behind an 80% cover and a 60px blur and every frame is a full-viewport
 * render (on CI's CPU-rendered context, ~8s per click on a studio page).
 *
 * And its `tone`: what it draws, sampled for a page that asks (03 X54).
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
vi.mock('../jfa-sdf', () => ({ destroyJFACache: vi.fn() }));
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

import { loadRenderer } from '../load-renderer';
import type { ShaderRenderer } from '../renderer-types';
import ShaderHero from '../ShaderHero.svelte';
import type { ShaderPresetId } from '../shader-config';
import { shaderStill } from '../shader-still.svelte';
import { shaderTone } from '../shader-tone';

let frames: FrameRequestCallback[] = [];
let resizeCallbacks: ResizeObserverCallback[] = [];
let box = { width: 0, height: 0 };
let app: ReturnType<typeof mount> | null = null;
let clock = 0;
let releases: (() => void)[] = [];
const toneDraws = vi.fn();
/** Copies of the studio's frame encoded (`shaderStill`, Codex-61zsk.73). */
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
  props: { still?: boolean; tone?: boolean; preset?: ShaderPresetId },
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

  // 03 X62: a page's motion dial holds the window's shader still.
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

// Codex-61zsk.73 (#20b): the studio's one frame, copied for the page editor.
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

// Codex-1yd58.14: a renderer that will not load or start leaves the CSS
// fallback showing, says so once, and stops the loop until the preset changes.
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
