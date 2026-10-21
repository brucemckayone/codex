/**
 * A JPEG's marker segments, up to its first scan.
 *
 * Both header readers walk them: `readJpegOrientation` for the EXIF APP1
 * (Codex-kk9nv.11) and `readImageDimensions` for the start-of-frame
 * (Codex-kk9nv.12). One walker means one place handles the format's details:
 * any number of 0xFF fill bytes before a marker (T.81 B.1.1.2), the markers
 * that stand alone with no length (TEM, RST0-7), and a length too short to
 * move the walk forward. Anything malformed ends the walk; it never throws.
 */

export interface JpegSegment {
  marker: number;
  /** The first byte of the segment's payload, after its 2-byte length. */
  start: number;
  /** One past the payload's last byte. Past the end of a truncated file. */
  end: number;
}

export function* jpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return;
    while (bytes[offset + 1] === 0xff && offset + 2 < bytes.length) offset++;
    const marker = bytes[offset + 1] ?? 0;
    // Start of scan or end of image: no header segment follows.
    if (marker === 0xda || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return;
    yield { marker, start: offset + 4, end: offset + 2 + length };
    offset += 2 + length;
  }
}
