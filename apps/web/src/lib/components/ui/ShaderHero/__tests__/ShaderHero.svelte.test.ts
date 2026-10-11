/**
 * ShaderHero's `still`: one static frame, then no more frames until it is
 * turned off. The org layout sets it on studio routes, where the shader sits
 * behind an 80% cover and a 60px blur and every frame is a full-viewport
 * render (on CI's CPU-rendered context, ~8s per click on a studio page).
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

let frames: FrameRequestCallback[] = [];
let resizeCallbacks: ResizeObserverCallback[] = [];
let box = { width: 0, height: 0 };
let app: ReturnType<typeof mount> | null = null;

/** Run the frames queued so far (those they queue run on the next step). */
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    for (const callback of due) callback(performance.now());
  }
}

/** Mount, then let the async renderer load and its first frame queue. */
async function start(props: { still: boolean }) {
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as RenderingContext
  );
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
  if (app) unmount(app);
  app = null;
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
