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
import { SafePhotonImage } from '../photon-wrapper';
import { processStillVariants } from '../processor';

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

  it('skips fill bytes and standalone markers on the way to the EXIF segment', () => {
    // 0xFF fill before a marker is legal (T.81 B.1.1.2); RST0 has no length.
    expect(readJpegOrientation(withSegments(jpeg, [0xff, 0xff], app1(6)))).toBe(
      6
    );
    expect(readJpegOrientation(withSegments(jpeg, [0xff, 0xd0], app1(8)))).toBe(
      8
    );
  });

  /** An EXIF APP1 around arbitrary (big-endian) TIFF bytes. */
  function exifApp1(tiff: number[]): number[] {
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const length = payload.length + 2;
    return [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
  }

  it.each([
    [
      'an IFD offset far past the segment',
      [0x4d, 0x4d, 0x00, 0x2a, 0xff, 0xff, 0xff, 0x00],
    ],
    [
      'an IFD claiming 65535 entries with none present',
      [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0xff, 0xff],
    ],
    [
      'an IFD offset of 0, pointing back at the TIFF header',
      [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00],
    ],
  ])('reads %s as upright, inside the segment, without throwing', (_name, tiff) => {
    expect(readJpegOrientation(withSegments(jpeg, exifApp1(tiff)))).toBe(1);
  });
});

describe('processStillVariants turns a tagged picture upright', () => {
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
    const result = processStillVariants(withSegments(jpeg, app1(orientation)));
    const expected = PILLOW[orientation] ?? '';
    expect(corners(result.variants.lg)).toBe(expected);
    expect(`${result.width}x${result.height}`).toBe(expected.split(' ')[0]);
  });

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])('orientation %i leaves no transparent pixel on any edge of any variant', (orientation) => {
    // Photon's `rotate` left the right two columns and the bottom row
    // transparent at every angle; the corners above sit 4px in and missed it.
    const result = processStillVariants(withSegments(jpeg, app1(orientation)));
    for (const bytes of Object.values(result.variants)) {
      const image = PhotonImage.new_from_byteslice(bytes);
      const w = image.get_width();
      const h = image.get_height();
      const raw = image.get_raw_pixels();
      image.free();
      const alpha = (x: number, y: number) => raw[(y * w + x) * 4 + 3];
      const edges: number[] = [];
      for (let x = 0; x < w; x++)
        edges.push(alpha(x, 0) ?? -1, alpha(x, h - 1) ?? -1);
      for (let y = 0; y < h; y++)
        edges.push(alpha(0, y) ?? -1, alpha(w - 1, y) ?? -1);
      expect(edges.filter((a) => a !== 255)).toEqual([]);
    }
  });
});

describe('SafePhotonImage.orient moves every pixel exactly where EXIF says', () => {
  // Every pixel names its own (x, y), so a pixel in the wrong place, a lost
  // row or a transparent edge all show.
  const W = 7;
  const H = 5;
  function coordinateImage(): SafePhotonImage {
    const raw = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++)
        raw.set([x * 30, y * 50, 99, 255], (y * W + x) * 4);
    }
    const png = new PhotonImage(raw, W, H);
    try {
      return SafePhotonImage.fromBuffer(png.get_bytes());
    } finally {
      png.free();
    }
  }
  /** Which source pixel belongs at display (u, v), straight from the EXIF definitions. */
  const SOURCE: Record<number, (u: number, v: number) => [number, number]> = {
    1: (u, v) => [u, v],
    2: (u, v) => [W - 1 - u, v],
    3: (u, v) => [W - 1 - u, H - 1 - v],
    4: (u, v) => [u, H - 1 - v],
    5: (u, v) => [v, u],
    6: (u, v) => [v, H - 1 - u],
    7: (u, v) => [W - 1 - v, H - 1 - u],
    8: (u, v) => [W - 1 - v, u],
  };

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ] as const)('orientation %i', (orientation) => {
    const image = coordinateImage();
    const turned = image.orient(orientation);
    const w = turned.get_width();
    const h = turned.get_height();
    const raw = turned.inner.get_raw_pixels();
    if (turned !== image) turned.free();
    image.free();

    expect([w, h]).toEqual(orientation >= 5 ? [H, W] : [W, H]);
    const wrong: string[] = [];
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const [x, y] = SOURCE[orientation]?.(u, v) ?? [-1, -1];
        const got = Array.from(
          raw.subarray((v * w + u) * 4, (v * w + u) * 4 + 4)
        );
        const want = [x * 30, y * 50, 99, 255];
        if (got.join() !== want.join())
          wrong.push(`(${u},${v}) ${got} != ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
