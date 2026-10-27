/**
 * A picture's width and height, read from its file header WITHOUT decoding it
 * (Codex-kk9nv.12).
 *
 * The processor checks this against `MAX_IMAGE_PIXELS` before it hands the
 * bytes to Photon. A decode is the one step that cannot be stopped part way:
 * a 12 MP photo needs 137 MB of Wasm just to decode, over a Worker's 128 MB,
 * and going over kills the isolate (error 1102) where no handler sees it. The
 * header costs nothing to read, and the size it declares is the size Photon
 * would allocate.
 *
 * Covers the four raster formats `validateImageSignature` accepts. Anything
 * malformed or unrecognised returns `null`, which the caller refuses: a file
 * whose size cannot be read is a file whose decode cannot be bounded.
 */

import { jpegSegments } from './jpeg-segments';

export interface ImageDimensions {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) =>
  ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) >>> 0) +
  (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const ascii = (b: Uint8Array, i: number, text: string) =>
  [...text].every((c, k) => b[i + k] === c.charCodeAt(0));

const sized = (width: number, height: number): ImageDimensions | null =>
  width > 0 && height > 0 ? { width, height } : null;

/**
 * The first start-of-frame segment's size. Every SOFn marker (C0-CF) carries
 * it except the three that share the range: DHT (C4), JPG (C8) and DAC (CC).
 * The walk ends at the first scan, so a file with no frame header by then
 * has none.
 */
function jpeg(b: Uint8Array): ImageDimensions | null {
  for (const { marker, start } of jpegSegments(b)) {
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (!isFrame) continue;
    // Precision (1 byte), then height and width.
    if (start + 4 >= b.length) return null;
    return sized(u16be(b, start + 3), u16be(b, start + 1));
  }
  return null;
}

/** IHDR is always the first chunk, at a fixed offset. */
function png(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return sized(u32be(b, 16), u32be(b, 20));
}

/** The logical screen, which is the canvas every frame is drawn into. */
function gif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  return sized(u16le(b, 6), u16le(b, 8));
}

/** The first chunk names the bitstream, and each keeps its size differently. */
function webp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30 || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8X')) {
    // Extended: the canvas, as 24-bit width-1 and height-1.
    return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  if (ascii(b, 12, 'VP8 ')) {
    // Lossy: a key frame's start code, then two 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (ascii(b, 12, 'VP8L')) {
    // Lossless: a 0x2F signature, then width-1 and height-1 packed into 28 bits.
    if (b[20] !== 0x2f) return null;
    const b1 = b[21] ?? 0;
    const b2 = b[22] ?? 0;
    const b3 = b[23] ?? 0;
    const b4 = b[24] ?? 0;
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return sized(width, height);
  }
  return null;
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (ascii(bytes, 0, '\x89PNG\r\n\x1a\n')) return png(bytes);
  if (ascii(bytes, 0, 'GIF8')) return gif(bytes);
  if (ascii(bytes, 0, 'RIFF')) return webp(bytes);
  return null;
}
