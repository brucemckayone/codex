/**
 * A JPEG's EXIF orientation (Codex-kk9nv.11).
 *
 * A camera stores the sensor's pixels as they were read, plus a tag saying
 * how to turn them for display. Photon decodes the pixels and ignores the
 * tag, and the WebP variants carry no EXIF, so a portrait phone photo was
 * stored, measured and served sideways. The processor reads the tag here and
 * turns the decoded image upright before it measures or resizes anything.
 *
 * JPEG only: that is where camera orientation lives. A PNG or WebP with an
 * orientation tag is rare and is decoded as stored, as before. Anything
 * malformed, truncated or absent reads as 1 (already upright), never throws.
 */

import { jpegSegments } from './jpeg-segments';

/** EXIF orientation: 1 is upright; 2-8 are the seven flips and turns. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const ORIENTATION_TAG = 0x0112;
const SHORT = 3;

export function readJpegOrientation(bytes: Uint8Array): ExifOrientation {
  for (const { marker, start, end } of jpegSegments(bytes)) {
    if (marker !== 0xe1) continue;
    const found = orientationInApp1(bytes, start, end);
    if (found !== null) return found;
  }
  return 1;
}

/** The orientation in one APP1 segment's payload, or null if it is not EXIF. */
function orientationInApp1(
  bytes: Uint8Array,
  start: number,
  end: number
): ExifOrientation | null {
  const limit = Math.min(end, bytes.length);
  // "Exif\0\0", then a TIFF header.
  const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  if (start + 14 > limit) return null;
  for (let i = 0; i < EXIF.length; i++) {
    if (bytes[start + i] !== EXIF[i]) return null;
  }
  const tiff = start + 6;
  const little =
    bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
      ? true
      : bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d
        ? false
        : null;
  if (little === null) return 1;

  const u16 = (at: number): number | null => {
    if (at + 2 > limit) return null;
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1] ?? 0;
    return little ? a | (b << 8) : (a << 8) | b;
  };
  const u32 = (at: number): number | null => {
    const hi = u16(little ? at + 2 : at);
    const lo = u16(little ? at : at + 2);
    return hi === null || lo === null ? null : hi * 0x10000 + lo;
  };

  if (u16(tiff + 2) !== 42) return 1;
  const ifd = u32(tiff + 4);
  if (ifd === null) return 1;
  const entries = u16(tiff + ifd);
  if (entries === null) return 1;
  for (let i = 0; i < entries; i++) {
    const entry = tiff + ifd + 2 + i * 12;
    // An entry cut off by the segment's end: no later one can be whole either.
    if (entry + 10 > limit) return 1;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    if (u16(entry + 2) !== SHORT) return 1;
    const value = u16(entry + 8);
    return value !== null && value >= 1 && value <= 8
      ? (value as ExifOrientation)
      : 1;
  }
  return 1;
}
