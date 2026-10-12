/**
 * The page image's variants (Codex-61zsk.13, -61zsk.53): an `xl` at
 * `min(1600, width)` beside the three every still has, never upscaled, and
 * the picture's own size handed back for the page's `ImageRef`.
 *
 * Photon is replaced by a fake that records each resize, because what is under
 * test is the arithmetic and the cleanup, not the Wasm encoder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeImage {
  width: number;
  height: number;
  freed: boolean;
}

const made: FakeImage[] = [];
const resizes: { width: number; height: number }[] = [];
let source = { width: 3000, height: 2000 };

vi.mock('../photon-wrapper', () => {
  class FakePhoton {
    readonly image: FakeImage;
    constructor(width: number, height: number) {
      this.image = { width, height, freed: false };
      made.push(this.image);
    }
    static fromBuffer() {
      return new FakePhoton(source.width, source.height);
    }
    get_width() {
      return this.image.width;
    }
    get_height() {
      return this.image.height;
    }
    resize(width: number, height: number) {
      resizes.push({ width, height });
      return new FakePhoton(width, height);
    }
    getBytesWebP() {
      return new Uint8Array([this.image.width % 256]);
    }
    free() {
      this.image.freed = true;
    }
  }
  return { SafePhotonImage: FakePhoton };
});

const { PAGE_IMAGE_XL_WIDTH, processImageVariants, processPageImageVariants } =
  await import('../processor');

beforeEach(() => {
  made.length = 0;
  resizes.length = 0;
});

describe('processPageImageVariants', () => {
  it('writes sm, md, lg and an xl at 1600 from a large picture, and returns its size', () => {
    source = { width: 3000, height: 2000 };
    const result = processPageImageVariants(new Uint8Array([1]));

    expect(Object.keys(result.variants)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(resizes.map((r) => r.width)).toEqual([200, 400, 800, 1600]);
    expect(PAGE_IMAGE_XL_WIDTH).toBe(1600);
    // Each keeps the picture's shape: 1600 x 1067 for 3:2.
    expect(resizes[3]).toEqual({ width: 1600, height: 1067 });
    expect({ width: result.width, height: result.height }).toEqual({
      width: 3000,
      height: 2000,
    });
  });

  it('never upscales: a 1000px picture gives an xl of 1000, not 1600', () => {
    source = { width: 1000, height: 1250 };
    const result = processPageImageVariants(new Uint8Array([1]));

    expect(resizes.map((r) => r.width)).toEqual([200, 400, 800, 1000]);
    expect(resizes[3]).toEqual({ width: 1000, height: 1250 });
    expect(result.width).toBe(1000);
  });

  it('frees every Wasm allocation, the source included', () => {
    source = { width: 3000, height: 2000 };
    processPageImageVariants(new Uint8Array([1]));

    // The source and four resizes.
    expect(made).toHaveLength(5);
    expect(made.every((image) => image.freed)).toBe(true);
  });
});

describe('processImageVariants (every other still)', () => {
  it('keeps its three sizes: no xl for a still that is never drawn across a band', () => {
    source = { width: 3000, height: 2000 };
    const variants = processImageVariants(new Uint8Array([1]));

    expect(Object.keys(variants)).toEqual(['sm', 'md', 'lg']);
    expect(resizes.map((r) => r.width)).toEqual([200, 400, 800]);
  });
});
