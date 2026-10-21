/**
 * EXIF orientation (Codex-kk9nv.11): a camera's tag is read, and the decoded
 * picture is turned upright before anything is measured or resized.
 *
 * Photon is REAL here, unlike in processor.test.ts. What is under test is
 * which way the pixels end up, which only the real decoder shows. The expected
 * corners for each orientation were taken from Pillow's
 * `ImageOps.exif_transpose`, the reference implementation, on the same
 * four-colour picture (2026-10-21).
 */
import { PhotonImage } from '@cf-wasm/photon';
import { describe, expect, it } from 'vitest';
import { readJpegOrientation } from '../exif-orientation';
import { processPageImageVariants } from '../processor';

/** An APP1 EXIF segment holding one Orientation entry. */
function app1(orientation: number, littleEndian = false): number[] {
  const u16 = (v: number) =>
    littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff];
  const u32 = (v: number) =>
    littleEndian
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
      : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(orientation),
    0x00,
    0x00,
    ...u32(0),
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
}

/** A JPEG with `segments` spliced in straight after its start-of-image. */
function withSegments(jpeg: Uint8Array, ...segments: number[][]): Uint8Array {
  return new Uint8Array([
    ...jpeg.slice(0, 2),
    ...segments.flat(),
    ...jpeg.slice(2),
  ]);
}

const QUADRANTS = {
  R: [230, 20, 20],
  B: [20, 20, 230],
  G: [20, 200, 20],
  Y: [240, 230, 20],
} as const;
type Quadrant = keyof typeof QUADRANTS;

/** An 80x40 JPEG: red, blue over green, yellow. No EXIF of its own. */
function fourColourJpeg(): Uint8Array {
  const width = 80;
  const height = 40;
  const raw = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key: Quadrant =
        y < height / 2
          ? x < width / 2
            ? 'R'
            : 'B'
          : x < width / 2
            ? 'G'
            : 'Y';
      raw.set([...QUADRANTS[key], 255], (y * width + x) * 4);
    }
  }
  const image = new PhotonImage(raw, width, height);
  try {
    return image.get_bytes_jpeg(95);
  } finally {
    image.free();
  }
}

/** "WxH" and the colour at each corner: top-left, top-right, bottom-left, bottom-right. */
function corners(webp: Uint8Array): string {
  const image = PhotonImage.new_from_byteslice(webp);
  try {
    const w = image.get_width();
    const h = image.get_height();
    const px = image.get_raw_pixels();
    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      const p = [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
      const distance = (q: Quadrant) =>
        QUADRANTS[q].reduce((sum, v, k) => sum + (v - (p[k] ?? 0)) ** 2, 0);
      return (Object.keys(QUADRANTS) as Quadrant[]).sort(
        (a, b) => distance(a) - distance(b)
      )[0];
    };
    return `${w}x${h} ${at(4, 4)}${at(w - 5, 4)}${at(4, h - 5)}${at(w - 5, h - 5)}`;
  } finally {
    image.free();
  }
}

describe('readJpegOrientation', () => {
  const jpeg = fourColourJpeg();

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])('reads orientation %i, big- and little-endian', (orientation) => {
    expect(readJpegOrientation(withSegments(jpeg, app1(orientation)))).toBe(
      orientation
    );
    expect(
      readJpegOrientation(withSegments(jpeg, app1(orientation, true)))
    ).toBe(orientation);
  });

  it('finds the EXIF segment behind a JFIF one', () => {
    const jfif = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    expect(readJpegOrientation(withSegments(jpeg, jfif, app1(6)))).toBe(6);
  });

  it('reads anything it cannot trust as upright (1), and never throws', () => {
    expect(readJpegOrientation(jpeg)).toBe(1);
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      1
    );
    expect(readJpegOrientation(new Uint8Array([]))).toBe(1);
    expect(readJpegOrientation(withSegments(jpeg, app1(9)))).toBe(1);
    const notExif = [
      0xff, 0xe1, 0x00, 0x08, 0x58, 0x4d, 0x50, 0x00, 0x00, 0x00,
    ];
    expect(readJpegOrientation(withSegments(jpeg, notExif))).toBe(1);
    const tagged = withSegments(jpeg, app1(6));
    expect(readJpegOrientation(tagged.slice(0, 20))).toBe(1);
  });
});

describe('processPageImageVariants turns a tagged picture upright', () => {
  const jpeg = fourColourJpeg();
  // Pillow's ImageOps.exif_transpose on the same picture.
  const PILLOW: Record<number, string> = {
    1: '80x40 RBGY',
    2: '80x40 BRYG',
    3: '80x40 YGBR',
    4: '80x40 GYRB',
    5: '40x80 RGBY',
    6: '40x80 GRYB',
    7: '40x80 YBGR',
    8: '40x80 BYRG',
  };

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])('orientation %i matches the reference, in the pixels and the recorded size', (orientation) => {
    const result = processPageImageVariants(
      withSegments(jpeg, app1(orientation))
    );
    const expected = PILLOW[orientation] ?? '';
    expect(corners(result.variants.lg)).toBe(expected);
    expect(`${result.width}x${result.height}`).toBe(expected.split(' ')[0]);
  });
});
