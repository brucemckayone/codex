/**
 * The studio shrinks every photo before upload (Codex-kk9nv.12), because the
 * server cannot decode one over `MAX_IMAGE_PIXELS` inside a Worker's 128 MB.
 *
 * jsdom has no image decoder and no canvas, so `Image` and the canvas are
 * stubbed here and what is under test is this module's own decisions: the
 * size it draws at, the format it picks, and that anything it cannot redraw
 * goes up exactly as picked. That a real browser turns the photo upright and
 * really shrinks it is checked in Chromium, not here.
 */
import {
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_WIDTH,
} from '@codex/validation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shrinkPhoto, shrunkSize } from '../shrink-photo';

describe('shrunkSize', () => {
  it.each([
    ['a 12 MP landscape phone photo', 4032, 3024],
    ['a 12 MP portrait phone photo', 3024, 4032],
    ['a 48 MP photo', 8064, 6048],
    ['a tall strip', 1000, 4000],
    ['a wide panorama', 12000, 2000],
    ['a one-pixel strip', 1, 5_000_000],
  ])('%s fits both limits and keeps its shape', (_name, width, height) => {
    const size = shrunkSize(width, height);
    expect(size.width).toBeLessThanOrEqual(MAX_IMAGE_WIDTH);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    // Rounding down moves the shape by under a pixel on either side.
    expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(
      (width / height) * (1 / size.height + 1 / size.width) + 1e-9
    );
  });

  it('a 12 MP portrait becomes 1385 x 1846: the pixel limit, not the width, binds', () => {
    expect(shrunkSize(3024, 4032)).toEqual({ width: 1385, height: 1846 });
  });

  it('a wide picture is held to 1600 wide', () => {
    expect(shrunkSize(4000, 1000)).toEqual({ width: 1600, height: 400 });
  });

  it.each([
    [800, 600],
    [1600, 1600],
    [1, 1],
  ])('never enlarges a %ix%i picture', (width, height) => {
    expect(shrunkSize(width, height)).toEqual({ width, height });
  });
});

/** What the stubbed canvas was asked to do. */
let drawn: { width: number; height: number } | null;
let encodedAs: string[];
let alphaAt: number | null;
let blobSizes: Record<string, number>;
let decodes: boolean;

beforeEach(() => {
  drawn = null;
  encodedAs = [];
  alphaAt = null;
  blobSizes = {};
  decodes = true;

  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 4032;
      naturalHeight = 3024;
      decode() {
        return decodes
          ? Promise.resolve()
          : Promise.reject(new Error('EncodingError'));
      }
    }
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picked');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        imageSmoothingQuality: 'low',
        drawImage: (
          _image: unknown,
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => {
          drawn = { width, height };
          expect({ width: this.width, height: this.height }).toEqual(drawn);
        },
        getImageData: (
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => {
          const data = new Uint8ClampedArray(width * height * 4).fill(255);
          if (alphaAt !== null) data[alphaAt * 4 + 3] = 0;
          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
    } as never
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback: BlobCallback, type?: string) => {
      const as = type ?? 'image/png';
      encodedAs.push(as);
      callback(new Blob([new Uint8Array(blobSizes[as] ?? 10)], { type: as }));
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const picked = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: 42 });

describe('shrinkPhoto', () => {
  it('redraws a 12 MP JPEG at the shrunk size, as a JPEG named for it', async () => {
    const out = await shrinkPhoto(picked('IMG_0001.JPG', 'image/jpeg'));

    // A landscape is held by the width: exactly 1600, never a floored 1599.
    expect(drawn).toEqual({ width: 1600, height: 1200 });
    expect(encodedAs).toEqual(['image/jpeg']);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_0001.jpg');
    expect(out.lastModified).toBe(42);
  });

  it('an opaque PNG becomes a JPEG: a photo saved as PNG is still a photo', async () => {
    const out = await shrinkPhoto(picked('shot.png', 'image/png'));
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('shot.jpg');
  });

  it('a PNG with any transparency stays a PNG, so it keeps it', async () => {
    alphaAt = 12345;
    const out = await shrinkPhoto(picked('cutout.png', 'image/png'));
    expect(encodedAs).toEqual(['image/png']);
    expect(out.type).toBe('image/png');
  });

  it('a transparent picture whose PNG is over the upload limit is sent as WebP', async () => {
    alphaAt = 0;
    blobSizes = { 'image/png': MAX_IMAGE_SIZE_BYTES + 1 };
    const out = await shrinkPhoto(picked('cutout.png', 'image/png'));
    expect(encodedAs).toEqual(['image/png', 'image/webp']);
    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('cutout.webp');
  });

  it.each([
    ['an SVG', 'logo.svg', 'image/svg+xml'],
    ['a HEIC', 'IMG_0002.HEIC', 'image/heic'],
    ['a file with no type', 'mystery', ''],
  ])('sends %s exactly as picked, without trying to draw it', async (_n, name, type) => {
    const file = picked(name, type);
    expect(await shrinkPhoto(file)).toBe(file);
    expect(drawn).toBeNull();
  });

  it('sends the picked file when the browser cannot decode it, for the server to explain', async () => {
    decodes = false;
    const file = picked('broken.jpg', 'image/jpeg');
    expect(await shrinkPhoto(file)).toBe(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picked');
  });
});
