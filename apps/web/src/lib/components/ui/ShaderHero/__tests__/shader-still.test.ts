/**
 * The studio's copy of the org's moving background (Codex-61zsk.73, #20b):
 * the channel that holds it, and the copy itself. jsdom has no 2D canvas and
 * no object URLs, so both are stand-ins; what is checked is what reaches the
 * channel, and that a copy that cannot be made leaves the glow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStill, STILL_SIZE, shaderStill } from '../shader-still.svelte';

let made = 0;
const revoked: string[] = [];
let encodes: ((blob: Blob | null) => void)[] = [];

/** A 2D canvas whose encode the test finishes by hand. */
function copyCanvas(): HTMLCanvasElement {
  return {
    toBlob: (done: BlobCallback) => encodes.push(done),
  } as unknown as HTMLCanvasElement;
}

/** Finishes the encodes started so far, in the order given. */
function finish(order: number[], blob: Blob | null = new Blob(['frame'])) {
  for (const i of order) encodes[i]?.(blob);
}

beforeEach(() => {
  made = 0;
  revoked.length = 0;
  encodes = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => `blob:still-${++made}`,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
});

afterEach(() => {
  shaderStill.clear();
  vi.restoreAllMocks();
});

describe('shaderStill', () => {
  it('holds nothing until a copy is taken, then the copy and its theme', () => {
    expect(shaderStill.current).toBeNull();
    shaderStill.take(copyCanvas(), 'dark');
    expect(shaderStill.current).toBeNull();
    finish([0]);
    expect(shaderStill.current).toEqual({ url: 'blob:still-1', theme: 'dark' });
  });

  it('revokes the copy a newer one replaces, and the last on a clear', () => {
    shaderStill.take(copyCanvas(), 'light');
    finish([0]);
    shaderStill.take(copyCanvas(), 'light');
    finish([1]);
    expect(shaderStill.current?.url).toBe('blob:still-2');
    expect(revoked).toEqual(['blob:still-1']);

    shaderStill.clear();
    expect(shaderStill.current).toBeNull();
    expect(revoked).toEqual(['blob:still-1', 'blob:still-2']);
  });

  it('never lets an older frame land over a newer one, or a cleared one come back', () => {
    shaderStill.take(copyCanvas(), 'light');
    shaderStill.take(copyCanvas(), 'light');
    // The newer encode finishes first; the older one, after, is dropped.
    finish([1, 0]);
    expect(shaderStill.current?.url).toBe('blob:still-1');
    expect(made).toBe(1);

    shaderStill.take(copyCanvas(), 'light');
    shaderStill.clear();
    finish([2]);
    expect(shaderStill.current).toBeNull();
    expect(made).toBe(1);
  });

  it('keeps what it shows when an encode gives nothing: no copy yet is the glow', () => {
    shaderStill.take(copyCanvas(), 'light');
    finish([0], null);
    expect(shaderStill.current).toBeNull();

    shaderStill.take(copyCanvas(), 'light');
    finish([1]);
    shaderStill.take(copyCanvas(), 'light');
    finish([2], null);
    expect(shaderStill.current?.url).toBe('blob:still-1');
    expect(revoked).toEqual([]);
  });

  it('is wanted while any render that paints it is mounted, and tells the shader each time one asks', () => {
    const asked = vi.fn();
    shaderStill.onDemand(asked);
    expect(shaderStill.wanted).toBe(false);

    const canvas = shaderStill.want();
    const swatch = shaderStill.want();
    expect(shaderStill.wanted).toBe(true);
    expect(asked).toHaveBeenCalledTimes(2);

    canvas();
    canvas(); // a release twice counts once
    expect(shaderStill.wanted).toBe(true);
    swatch();
    expect(shaderStill.wanted).toBe(false);

    shaderStill.onDemand(null);
    shaderStill.want()();
    expect(asked).toHaveBeenCalledTimes(2);
  });
});

describe('captureStill', () => {
  type Draw = { args: number[]; filter: string | undefined };
  let draws: Draw[];
  let sizes: { width: number; height: number }[];

  /** The 2D context: `filter` only where the browser has it. */
  function context(withFilter: boolean) {
    const ctx: { filter?: string; drawImage: (...args: unknown[]) => void } = {
      drawImage: (_source: unknown, ...args: unknown[]) =>
        draws.push({ args: args as number[], filter: ctx.filter }),
    };
    if (withFilter) ctx.filter = 'none';
    return ctx;
  }

  function source(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  beforeEach(() => {
    draws = [];
    sizes = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, done: BlobCallback) {
        sizes.push({ width: this.width, height: this.height });
        done(new Blob(['frame']));
      }
    );
  });

  it('copies the frame at most STILL_SIZE on its longer side, keeping its shape', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context(false) as unknown as CanvasRenderingContext2D
    );
    captureStill(source(2880, 1800), { theme: 'light', blur: 0 });
    expect(sizes).toEqual([{ width: STILL_SIZE, height: 300 }]);
    expect(draws).toEqual([{ args: [0, 0, 480, 300], filter: undefined }]);
    expect(shaderStill.current).toEqual({
      url: 'blob:still-1',
      theme: 'light',
    });
  });

  it('blurs it as the studio does, drawn twice the radius past every edge so it never fades', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context(true) as unknown as CanvasRenderingContext2D
    );
    // 60px over a 1440px window: 20px over the 480px copy.
    captureStill(source(2880, 1800), { theme: 'dark', blur: 60 / 1440 });
    const [draw] = draws;
    expect(draw?.filter).toBe('blur(20px)');
    const [x = 0, y = 0, w = 0, h = 0] = draw?.args ?? [];
    // Grown evenly, by the side that needs more (the height: 80px on 300).
    expect(w / 480).toBeCloseTo(h / 300, 6);
    expect(h).toBeCloseTo(380, 6);
    expect(x).toBeCloseTo((480 - w) / 2, 6);
    expect(y).toBeCloseTo(-40, 6);
    expect(shaderStill.current?.theme).toBe('dark');
  });

  it('copies sharp where the context cannot filter', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context(false) as unknown as CanvasRenderingContext2D
    );
    captureStill(source(1200, 800), { theme: 'light', blur: 0.05 });
    expect(draws).toEqual([{ args: [0, 0, 480, 320], filter: undefined }]);
  });

  it('takes nothing, and so leaves the glow, with no 2D context or no frame', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    captureStill(source(1200, 800), { theme: 'light', blur: 0 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context(false) as unknown as CanvasRenderingContext2D
    );
    captureStill(source(0, 0), { theme: 'light', blur: 0 });
    expect(sizes).toEqual([]);
    expect(shaderStill.current).toBeNull();
  });
});
