/**
 * The size check before a decode (Codex-kk9nv.12) is only as good as the
 * header reader. Each real file here is encoded by Photon itself and then
 * checked against BOTH the expected size and what Photon decodes, so the
 * reader cannot drift from the decoder it guards. Odd and large sizes catch
 * an off-by-one or a lost high bit in the packed fields. Lossy and extended
 * WebP and GIF are built by hand, from their specs, because Photon does not
 * write them.
 */
import { PhotonImage } from '@cf-wasm/photon';
import { describe, expect, it } from 'vitest';
import { readImageDimensions } from '../image-dimensions';

function encoded(
  width: number,
  height: number,
  as: 'png' | 'jpeg' | 'webp'
): Uint8Array {
  const image = new PhotonImage(
    new Uint8Array(width * height * 4).fill(200),
    width,
    height
  );
  try {
    if (as === 'png') return image.get_bytes();
    if (as === 'jpeg') return image.get_bytes_jpeg(80);
    return image.get_bytes_webp();
  } finally {
    image.free();
  }
}

function decodedSize(bytes: Uint8Array) {
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return { width: image.get_width(), height: image.get_height() };
  } finally {
    image.free();
  }
}

const SIZES: [number, number][] = [
  [37, 23],
  [5000, 3],
  [3, 5000],
];

describe('readImageDimensions: files Photon writes', () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    for (const [width, height] of SIZES) {
      it(`${format} ${width}x${height}`, () => {
        const bytes = encoded(width, height, format);
        expect(readImageDimensions(bytes)).toEqual({ width, height });
        expect(readImageDimensions(bytes)).toEqual(decodedSize(bytes));
      });
    }
  }

  it('webp from Photon is the lossless bitstream, so VP8L is what those cases read', () => {
    const bytes = encoded(37, 23, 'webp');
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('VP8L');
  });
});

/** Insert `extra` right after a JPEG's SOI marker. */
function afterSoi(jpeg: Uint8Array, extra: number[]): Uint8Array {
  return new Uint8Array([
    ...jpeg.subarray(0, 2),
    ...extra,
    ...jpeg.subarray(2),
  ]);
}

describe('readImageDimensions: JPEG segment walk', () => {
  const base = encoded(37, 23, 'jpeg');

  it('walks past an EXIF APP1 and fill bytes to the frame header', () => {
    // APP1, length 8: "Exif\0\0", then two 0xFF fill bytes before the next marker.
    const app1 = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const withFill = afterSoi(base, [...app1, 0xff, 0xff]);
    expect(readImageDimensions(withFill)).toEqual({ width: 37, height: 23 });
    // Calibration: the decoder takes this file too, at the same size.
    expect(decodedSize(withFill)).toEqual({ width: 37, height: 23 });
  });

  it('reads a progressive frame header (SOF2) like a baseline one', () => {
    const progressive = base.slice();
    const sof = progressive.findIndex(
      (b, i) => b === 0xff && progressive[i + 1] === 0xc0
    );
    expect(sof).toBeGreaterThan(0);
    progressive[sof + 1] = 0xc2;
    expect(readImageDimensions(progressive)).toEqual({ width: 37, height: 23 });
  });

  it('refuses a file whose scan starts before any frame header', () => {
    expect(
      readImageDimensions(
        new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00])
      )
    ).toBeNull();
  });

  it('refuses a segment length under 2, which would walk in place', () => {
    expect(
      readImageDimensions(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00])
      )
    ).toBeNull();
  });

  it('refuses a file cut off before its frame header', () => {
    const sof = base.findIndex((b, i) => b === 0xff && base[i + 1] === 0xc0);
    expect(readImageDimensions(base.subarray(0, sof + 4))).toBeNull();
  });
});

/** A RIFF/WEBP file whose first chunk is `fourcc` with `payload`. */
function riff(fourcc: string, payload: number[]): Uint8Array {
  const chunk = [...fourcc].map((c) => c.charCodeAt(0));
  const size = payload.length;
  const body = [
    ...[...'WEBP'].map((c) => c.charCodeAt(0)),
    ...chunk,
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    size >>> 24,
    ...payload,
  ];
  const total = body.length;
  return new Uint8Array([
    ...[...'RIFF'].map((c) => c.charCodeAt(0)),
    total & 0xff,
    (total >> 8) & 0xff,
    (total >> 16) & 0xff,
    total >>> 24,
    ...body,
  ]);
}

describe('readImageDimensions: hand-built headers', () => {
  it('lossy WebP (VP8): the key frame start code, then 14-bit sizes', () => {
    // frame tag (3), start code 9D 01 2A, width 4000, height 3000 (scale bits clear)
    const vp8 = [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0xa0, 0x0f, 0xb8, 0x0b];
    expect(readImageDimensions(riff('VP8 ', vp8))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it('lossy WebP ignores the two scale bits above each size', () => {
    // 4000 | 0xC000 and 3000 | 0x4000
    const vp8 = [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0xa0, 0xcf, 0xb8, 0x4b];
    expect(readImageDimensions(riff('VP8 ', vp8))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it('lossy WebP without a key frame start code is refused', () => {
    const vp8 = [0x10, 0x02, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x0f, 0xb8, 0x0b];
    expect(readImageDimensions(riff('VP8 ', vp8))).toBeNull();
  });

  it('extended WebP (VP8X): the canvas, as 24-bit width-1 and height-1', () => {
    // flags + 3 reserved, then 9999 and 70000 minus one each
    const w = 9999 - 1;
    const h = 70000 - 1;
    const vp8x = [
      0x10,
      0,
      0,
      0,
      w & 0xff,
      (w >> 8) & 0xff,
      (w >> 16) & 0xff,
      h & 0xff,
      (h >> 8) & 0xff,
      (h >> 16) & 0xff,
    ];
    expect(readImageDimensions(riff('VP8X', vp8x))).toEqual({
      width: 9999,
      height: 70000,
    });
  });

  it('GIF: the logical screen, little-endian', () => {
    const gif = new Uint8Array([
      ...[...'GIF89a'].map((c) => c.charCodeAt(0)),
      0x40,
      0x06, // 1600
      0xb0,
      0x04, // 1200
      0x00,
      0x00,
      0x00,
    ]);
    expect(readImageDimensions(gif)).toEqual({ width: 1600, height: 1200 });
  });

  it('a zero-sized header is refused, not read as an empty picture', () => {
    const gif = new Uint8Array([
      ...[...'GIF89a'].map((c) => c.charCodeAt(0)),
      0x00,
      0x00,
      0xb0,
      0x04,
    ]);
    expect(readImageDimensions(gif)).toBeNull();
  });
});

describe('readImageDimensions: not an image it can bound', () => {
  it.each([
    ['empty', new Uint8Array([])],
    ['text', new TextEncoder().encode('This is not an image at all')],
    [
      'a PNG signature with no IHDR',
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x44,
        0x41, 0x54, 0, 0, 0, 1, 0, 0, 0, 1,
      ]),
    ],
    // A valid lossy header in every byte but the form type.
    [
      'a RIFF that is not WEBP',
      riff(
        'VP8 ',
        [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0xa0, 0x0f, 0xb8, 0x0b]
      ).map((b, i) => (i === 8 ? 0x41 : b)),
    ],
    ['an unknown WebP chunk', riff('ABCD', new Array(20).fill(0))],
  ])('%s', (_name, bytes) => {
    expect(readImageDimensions(bytes)).toBeNull();
  });
});
