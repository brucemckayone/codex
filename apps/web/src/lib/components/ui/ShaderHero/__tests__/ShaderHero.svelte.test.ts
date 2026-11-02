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
vi.mock('../shader-config', () => ({
  getShaderConfig: () => ({ preset: 'glow' }),
}));

import ShaderHero from '../ShaderHero.svelte';
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

/** Run the frames queued so far (those they queue run on the next step). */
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    for (const callback of due) callback(performance.now());
  }
}

/** Mount, then let the async renderer load and its first frame queue. */
async function start(props: { still?: boolean; tone?: boolean }) {
  app = mount(ShaderHero, { target: document.body, props });
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
      : {}) as unknown as HTMLCanvasElement['getContext']);
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
      kind === '2d' ? null : {}) as unknown as HTMLCanvasElement['getContext']);
    box = { width: 1200, height: 800 };
    await start({ still: true, tone: true });
    step(3);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(encoded).toBe(0);
    expect(shaderStill.current).toBeNull();
  });
});
