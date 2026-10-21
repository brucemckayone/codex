/**
 * The page image's variants (Codex-61zsk.13, -61zsk.53): an `xl` at
 * `min(1600, width)` beside the three every still has, never upscaled, and
 * the picture's own size handed back for the page's `ImageRef`.
 *
 * And the memory shape every still shares (Codex-kk9nv.12): the size is
 * checked from the header before anything is decoded, the largest variant is
 * made from the decode, the decode is freed at once, and the rest are made
 * from that largest one.
 *
 * Photon is replaced by a fake that records each resize, because what is under
 * test is the arithmetic and the cleanup, not the Wasm encoder. The header
 * reader is replaced too, so the fake's size is what the check sees;
 * image-dimensions.test.ts proves the real reader against real files.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeImage {
  width: number;
  height: number;
  freed: boolean;
}

const made: FakeImage[] = [];
const resizes: { width: number; height: number }[] = [];
/** Each resize's source width, each turn and each free, in order. */
const events: string[] = [];
const orients: number[] = [];
let source = { width: 1950, height: 1300 };
let headerReadable = true;

vi.mock('../image-dimensions', () => ({
  readImageDimensions: () => (headerReadable ? source : null),
}));

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
      events.push(`resize ${this.image.width} -> ${width}`);
      return new FakePhoton(width, height);
    }
    // Like the real one: THIS for 1 and for the mirrors 2 and 4, which it
    // flips in place; a NEW instance (swapped for a quarter turn) for 3, 5-8.
    orient(orientation: number) {
      orients.push(orientation);
      events.push(`orient ${this.image.width}`);
      if (orientation === 1 || orientation === 2 || orientation === 4)
        return this;
      return orientation >= 5
        ? new FakePhoton(this.image.height, this.image.width)
        : new FakePhoton(this.image.width, this.image.height);
    }
    getBytesWebP() {
      return new Uint8Array([this.image.width % 256]);
    }
    free() {
      if (!this.image.freed) events.push(`free ${this.image.width}`);
      this.image.freed = true;
    }
  }
  return { SafePhotonImage: FakePhoton };
});

const { PAGE_IMAGE_XL_WIDTH, processImageVariants, processPageImageVariants } =
  await import('../processor');
const { InvalidImageError, UNREADABLE_IMAGE_MESSAGE } = await import(
  '../errors'
);

beforeEach(() => {
  made.length = 0;
  resizes.length = 0;
  events.length = 0;
  orients.length = 0;
  headerReadable = true;
});

/** The smallest JPEG framing that carries an EXIF orientation (no pixels). */
function jpegTagged(orientation: number): Uint8Array {
  const tiff = [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01, // Orientation, SHORT, 1
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...payload,
    0xff,
    0xd9,
  ]);
}

describe('processPageImageVariants', () => {
  it('writes sm, md, lg and an xl at 1600 from a large picture, and returns its size', () => {
    source = { width: 1950, height: 1300 };
    const result = processPageImageVariants(new Uint8Array([1]));

    expect(Object.keys(result.variants)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(resizes.map((r) => r.width)).toEqual([1600, 800, 400, 200]);
    expect(PAGE_IMAGE_XL_WIDTH).toBe(1600);
    // Each keeps the picture's shape: 1600 x 1067 for 3:2.
    expect(resizes[0]).toEqual({ width: 1600, height: 1067 });
    expect(resizes[1]).toEqual({ width: 800, height: 533 });
    expect({ width: result.width, height: result.height }).toEqual({
      width: 1950,
      height: 1300,
    });
  });

  it('never upscales: a 1000px picture gives an xl of 1000, not 1600', () => {
    source = { width: 1000, height: 1250 };
    const result = processPageImageVariants(new Uint8Array([1]));

    expect(resizes.map((r) => r.width)).toEqual([1000, 800, 400, 200]);
    expect(resizes[0]).toEqual({ width: 1000, height: 1250 });
    expect(result.width).toBe(1000);
  });

  it('frees every Wasm allocation, the source included', () => {
    source = { width: 1950, height: 1300 };
    processPageImageVariants(new Uint8Array([1]));

    // The source and four resizes.
    expect(made).toHaveLength(5);
    expect(made.every((image) => image.freed)).toBe(true);
  });

  it('makes xl from the decode, frees the decode, then makes the rest from xl', () => {
    source = { width: 1950, height: 1300 };
    processPageImageVariants(new Uint8Array([1]));

    // Holding the decode while every variant was made from it peaked at
    // 81 MB of Wasm on a 2000x1280 picture; this order peaks at 65.
    // (An untagged picture's `orient` is a no-op that returns the same image.)
    expect(events).toEqual([
      'resize 1950 -> 1600',
      'free 1950',
      'resize 1600 -> 800',
      'orient 800',
      'free 800',
      'resize 1600 -> 400',
      'orient 400',
      'free 400',
      'resize 1600 -> 200',
      'orient 200',
      'free 200',
      'orient 1600',
      'free 1600',
    ]);
  });
});

describe('the size check, before anything is decoded', () => {
  it('refuses a 12 MP photo without decoding it, and says how big it is', () => {
    source = { width: 4032, height: 3024 };

    expect(() => processPageImageVariants(new Uint8Array([1]))).toThrow(
      InvalidImageError
    );
    expect(() => processImageVariants(new Uint8Array([1]))).toThrow(
      /4032 × 3024 pixels/
    );
    expect(made).toHaveLength(0);
  });

  it('takes a picture of exactly 1600 x 1600', () => {
    source = { width: 1600, height: 1600 };
    expect(() => processPageImageVariants(new Uint8Array([1]))).not.toThrow();
  });

  it('limits pixels, not width: 2560 x 1000 is the same 2.56 MP and is taken', () => {
    source = { width: 2560, height: 1000 };
    const result = processPageImageVariants(new Uint8Array([1]));
    expect(result.width).toBe(2560);
  });

  it('refuses one pixel over the limit', () => {
    source = { width: 1600, height: 1601 };
    expect(() => processPageImageVariants(new Uint8Array([1]))).toThrow(
      InvalidImageError
    );
    expect(made).toHaveLength(0);
  });

  it('refuses a file whose size cannot be read, without decoding it', () => {
    headerReadable = false;
    expect(() => processImageVariants(new Uint8Array([1]))).toThrow(
      UNREADABLE_IMAGE_MESSAGE
    );
    expect(made).toHaveLength(0);
  });
});

describe('EXIF orientation (Codex-kk9nv.11)', () => {
  it('measures upright, resizes in the stored orientation, and turns only the small outputs', () => {
    // Stored landscape; the camera says to display it turned 90° (6).
    source = { width: 1950, height: 1300 };
    const result = processPageImageVariants(jpegTagged(6));

    expect({ width: result.width, height: result.height }).toEqual({
      width: 1300,
      height: 1950,
    });
    // Upright 1300 wide is under xl's 1600, so xl keeps it: stored 1950x1300.
    expect(resizes[0]).toEqual({ width: 1950, height: 1300 });
    // lg is 800 x 1200 upright, so it is resized to 1200 x 800 as stored.
    expect(resizes[1]).toEqual({ width: 1200, height: 800 });
    // What is encoded is the TURNED copy: 800 wide, not the stored 1200.
    expect(result.variants.lg[0]).toBe(800 % 256);
    expect(orients).toEqual([6, 6, 6, 6]);
    // Nothing is turned until the decode has been freed.
    const firstTurn = events.findIndex((e) => e.startsWith('orient'));
    expect(events.indexOf('free 1950')).toBeLessThan(firstTurn);
    // The decode, four resizes and their four turned copies, all freed.
    expect(made).toHaveLength(9);
    expect(made.every((image) => image.freed)).toBe(true);
  });

  it('mirrors (2) every variant, the largest last, because a mirror flips in place', () => {
    source = { width: 1950, height: 1300 };
    processPageImageVariants(jpegTagged(2));

    // Each smaller variant is made from xl BEFORE xl is flipped, or it
    // would be flipped twice.
    expect(events.filter((e) => !e.startsWith('free'))).toEqual([
      'resize 1950 -> 1600',
      'resize 1600 -> 800',
      'orient 800',
      'resize 1600 -> 400',
      'orient 400',
      'resize 1600 -> 200',
      'orient 200',
      'orient 1600',
    ]);
    // In place: no turned copies.
    expect(made).toHaveLength(5);
  });

  it('leaves an untagged picture as it is', () => {
    source = { width: 1950, height: 1300 };
    processImageVariants(new Uint8Array([1]));

    expect(orients).toEqual([1, 1, 1]);
    expect(made).toHaveLength(4);
  });
});

describe('processImageVariants (every other still)', () => {
  it('keeps its three sizes: no xl for a still that is never drawn across a band', () => {
    source = { width: 1950, height: 1300 };
    const variants = processImageVariants(new Uint8Array([1]));

    expect(Object.keys(variants)).toEqual(['sm', 'md', 'lg']);
    // lg from the decode, then md and sm from lg.
    expect(resizes.map((r) => r.width)).toEqual([800, 400, 200]);
    expect(events.slice(0, 3)).toEqual([
      'resize 1950 -> 800',
      'free 1950',
      'resize 800 -> 400',
    ]);
  });
});
