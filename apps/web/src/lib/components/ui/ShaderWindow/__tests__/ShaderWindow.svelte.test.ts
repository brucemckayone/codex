/**
 * A ShaderWindow copies its patch of the org's shader from each frame the
 * shader hands over, only while on or near the screen, and shows its
 * fallback until a live shader's patch is in it.
 *
 * The shader's side is a host registered here by hand (`shader-frame`), its
 * canvas a 1200x800 window drawn at DPR 2. The IntersectionObserver is a
 * stand-in a test fires; the 2D context counts its draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { registerShaderHost } from '../../ShaderHero/shader-frame.svelte';
import ShaderWindow from '../ShaderWindow.svelte';

const { reportWindowNoContext } = vi.hoisted(() => ({
  reportWindowNoContext: vi.fn(),
}));
vi.mock('../../ShaderHero/renderer-failure', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../ShaderHero/renderer-failure')
  >()),
  reportWindowNoContext,
}));

class FakeIntersectionObserver {
  static made: FakeIntersectionObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  readonly observed: Element[] = [];
  readonly disconnect = vi.fn();
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.made.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

/** The window comes near the screen, or leaves it. */
function intersect(isIntersecting: boolean) {
  for (const observer of FakeIntersectionObserver.made)
    for (const target of observer.observed)
      observer.callback(
        [{ isIntersecting, target } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver
      );
  flushSync();
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

const fallback = createRawSnippet(() => ({
  render: () => '<div class="fallback"></div>',
}));
const drawImage = vi.fn();
let clock = 0;
let app: ReturnType<typeof mount> | null = null;
let releaseHost: (() => void) | null = null;

/** The fullpage shader's canvas, and its host. */
function shader({ live = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1600;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    rect(0, 0, 1200, 800)
  );
  const requestFrame = vi.fn();
  const host = registerShaderHost({ canvas, requestFrame });
  releaseHost = host.release;
  host.setLive(live);
  return { canvas, requestFrame, ...host };
}

/** A 320x180 window at (100, 200), or where `at` puts it. */
function start(at = rect(100, 200, 320, 180)) {
  app = mount(ShaderWindow, { target: document.body, props: { fallback } });
  flushSync();
  const canvas = document.querySelector(
    'canvas.shader-window'
  ) as HTMLCanvasElement;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(at);
  Object.defineProperty(canvas, 'clientWidth', {
    configurable: true,
    value: at.width,
  });
  Object.defineProperty(canvas, 'clientHeight', {
    configurable: true,
    value: at.height,
  });
  return canvas;
}

const shows = () => {
  flushSync();
  const canvas = document.querySelector('canvas.shader-window');
  return {
    live: canvas?.hasAttribute('data-live') ?? false,
    fallback: document.querySelector('.fallback') !== null,
  };
};

beforeEach(() => {
  FakeIntersectionObserver.made = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  drawImage.mockClear();
  reportWindowNoContext.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
    kind: string
  ) =>
    kind === '2d'
      ? { drawImage }
      : null) as unknown as HTMLCanvasElement['getContext']);
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  releaseHost?.();
  releaseHost = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ShaderWindow', () => {
  it('shows its fallback while no shader is live, and copies nothing', () => {
    start();
    intersect(true);
    expect(shows()).toEqual({ live: false, fallback: true });

    const source = shader({ live: false });
    source.emit();
    expect(drawImage).not.toHaveBeenCalled();
    expect(shows()).toEqual({ live: false, fallback: true });
  });

  it('listens only once near the screen, then copies its patch and drops the fallback', () => {
    const source = shader();
    const canvas = start();
    expect(FakeIntersectionObserver.made[0]?.options?.rootMargin).toBeTruthy();
    source.emit();
    expect(drawImage).not.toHaveBeenCalled();
    expect(source.requestFrame).not.toHaveBeenCalled();
    // Live, but no copy yet: still the fallback.
    expect(shows()).toEqual({ live: false, fallback: true });

    intersect(true);
    // A still shader drew its one frame before the window came near.
    expect(source.requestFrame).toHaveBeenCalledTimes(1);
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(
      source.canvas,
      200,
      400,
      640,
      360,
      0,
      0,
      320,
      180
    );
    // Its backing store is its CSS box at 1x.
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    expect(shows()).toEqual({ live: true, fallback: false });
  });

  // Review r1: past WebKit's canvas-memory cap `getContext('2d')` is null on a
  // live-shader page. The fallback is right to show, but it must be said.
  it('reports a window that gets no 2D context, and keeps its fallback', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const source = shader();
    start();
    intersect(true);
    source.emit();
    expect(reportWindowNoContext).toHaveBeenCalledWith(true);
    expect(drawImage).not.toHaveBeenCalled();
    expect(shows()).toEqual({ live: false, fallback: true });
  });

  it('copies nothing while near but off the shader, and keeps its fallback', () => {
    const source = shader();
    start(rect(100, 900, 320, 180));
    intersect(true);
    source.emit();
    expect(drawImage).not.toHaveBeenCalled();
    expect(shows()).toEqual({ live: false, fallback: true });
  });

  it('copies at most 30 times a second', () => {
    const source = shader();
    start();
    intersect(true);
    source.emit();
    clock = 16;
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(1);
    // The next 60Hz tick, a little early, still copies.
    clock = 33;
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('stops listening off screen, and lets go of the frames and its observer on destroy', () => {
    const source = shader();
    start();
    intersect(true);
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(1);

    intersect(false);
    clock = 100;
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(1);

    intersect(true);
    clock = 200;
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(2);

    const observer = FakeIntersectionObserver.made[0];
    if (app) unmount(app);
    app = null;
    clock = 300;
    source.emit();
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(observer?.disconnect).toHaveBeenCalled();
  });

  it('asks a still shader for its frame again once a scroll settles, and not once destroyed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = shader();
    start();
    intersect(true);
    expect(source.requestFrame).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(149);
    expect(source.requestFrame).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(source.requestFrame).toHaveBeenCalledTimes(2);

    if (app) unmount(app);
    app = null;
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);
    expect(source.requestFrame).toHaveBeenCalledTimes(2);
  });
});
