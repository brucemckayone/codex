/**
 * Tests for `validateFiles` — the multipart file validator used by
 * `multipartProcedure()`.
 *
 * Regression guard for Codex-sxm74: a valid image forwarded worker→worker can
 * arrive with its `Content-Type` reduced to `application/octet-stream` (workerd
 * emits that generic type when a `File` whose `.type` was empty is serialised
 * onto a multipart body). The old validator checked the declared type against a
 * strict allowlist and rejected such uploads with a 400 — the prod avatar bug.
 * `validateFiles` now sniffs the magic bytes as a fallback.
 *
 * On PRE-FIX code the "accepts …" cases below throw `InvalidFileTypeError`.
 */

import { ValidationError } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { validateFiles } from '../multipart-procedure';

const IMAGE_ALLOWLIST = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

const AVATAR_SCHEMA = {
  avatar: {
    required: true,
    maxSize: 5 * 1024 * 1024,
    allowedMimeTypes: IMAGE_ALLOWLIST,
  },
} as const;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ (.exe)

function formDataWith(file: File): FormData {
  const fd = new FormData();
  fd.append('avatar', file);
  return fd;
}

describe('validateFiles — MIME sniffing fallback (Codex-sxm74)', () => {
  it('accepts a JPEG whose type was stripped to application/octet-stream', async () => {
    const file = new File([JPEG_BYTES], 'photo.jpg', {
      type: 'application/octet-stream',
    });

    const result = await validateFiles(formDataWith(file), AVATAR_SCHEMA);

    // Recovered from magic bytes so the downstream service gets the real type.
    expect(result.avatar.type).toBe('image/jpeg');
    expect(result.avatar.name).toBe('photo.jpg');
  });

  it('accepts a PNG whose type is empty (workerd inbound parse of a part with no Content-Type)', async () => {
    const file = new File([PNG_BYTES], 'photo.png', { type: '' });

    const result = await validateFiles(formDataWith(file), AVATAR_SCHEMA);

    expect(result.avatar.type).toBe('image/png');
  });

  it('honours a correctly-declared type without sniffing (no regression)', async () => {
    const file = new File([PNG_BYTES], 'photo.png', { type: 'image/png' });

    const result = await validateFiles(formDataWith(file), AVATAR_SCHEMA);

    expect(result.avatar.type).toBe('image/png');
  });

  it('still REJECTS a non-image masquerading as octet-stream (sniff does not weaken the allowlist)', async () => {
    const file = new File([EXE_BYTES], 'malware.jpg', {
      type: 'application/octet-stream',
    });

    await expect(
      validateFiles(formDataWith(file), AVATAR_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('still REJECTS a declared, disallowed type (e.g. image/tiff)', async () => {
    const file = new File([PNG_BYTES], 'image.tiff', { type: 'image/tiff' });

    await expect(
      validateFiles(formDataWith(file), AVATAR_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an oversized file (size checked before the body is read)', async () => {
    const file = new File([JPEG_BYTES], 'photo.jpg', { type: 'image/jpeg' });
    const schema = {
      avatar: {
        required: true,
        maxSize: 3, // smaller than JPEG_BYTES
        allowedMimeTypes: IMAGE_ALLOWLIST,
      },
    } as const;

    await expect(
      validateFiles(formDataWith(file), schema)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a missing required file', async () => {
    await expect(
      validateFiles(new FormData(), AVATAR_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/**
 * Codex-r85jo.4: a declared, ALLOWED raster type was never checked against the
 * bytes, so SVG markup labelled `image/png` passed the allowlist, missed the
 * org-logo SVG sanitiser (which dispatches on `image/svg+xml`) and was stored
 * verbatim. On PRE-FIX code the "rejects …" cases below RESOLVE.
 */
describe('validateFiles — declared raster type must match the bytes (Codex-r85jo.4)', () => {
  // Mirrors ALLOWED_LOGO_MIME_TYPES: rasters plus SVG.
  const LOGO_SCHEMA = {
    logo: {
      required: true,
      maxSize: 5 * 1024 * 1024,
      allowedMimeTypes: [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
      ],
    },
  } as const;

  const SVG_BYTES = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  );

  function logoForm(file: File): FormData {
    const fd = new FormData();
    fd.append('logo', file);
    return fd;
  }

  it('rejects SVG bytes declared image/png (would skip SVG sanitisation)', async () => {
    const file = new File([SVG_BYTES], 'logo.png', { type: 'image/png' });

    const error = await validateFiles(logoForm(file), LOGO_SCHEMA).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).statusCode).toBe(400);
    expect((error as Error).message).toContain("declared type 'image/png'");
  });

  it('rejects HTML bytes declared image/jpeg', async () => {
    const html = new TextEncoder().encode('<html><body>hi</body></html>');
    const file = new File([html], 'logo.jpg', { type: 'image/jpeg' });

    await expect(
      validateFiles(logoForm(file), LOGO_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects JPEG bytes declared image/png (declaration disagrees with content)', async () => {
    const file = new File([JPEG_BYTES], 'logo.png', { type: 'image/png' });

    await expect(
      validateFiles(logoForm(file), LOGO_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts real PNG bytes declared image/png', async () => {
    const file = new File([PNG_BYTES], 'logo.png', { type: 'image/png' });

    const result = await validateFiles(logoForm(file), LOGO_SCHEMA);

    expect(result.logo.type).toBe('image/png');
  });

  it('accepts SVG declared image/svg+xml, so it reaches the SVG sanitiser', async () => {
    const file = new File([SVG_BYTES], 'logo.svg', { type: 'image/svg+xml' });

    const result = await validateFiles(logoForm(file), LOGO_SCHEMA);

    expect(result.logo.type).toBe('image/svg+xml');
  });

  it('keeps the octet-stream re-forward fallback: PNG bytes resolve to image/png', async () => {
    const file = new File([PNG_BYTES], 'logo', {
      type: 'application/octet-stream',
    });

    const result = await validateFiles(logoForm(file), LOGO_SCHEMA);

    expect(result.logo.type).toBe('image/png');
  });

  it('rejects SVG bytes re-forwarded as octet-stream (never inferred as SVG)', async () => {
    const file = new File([SVG_BYTES], 'logo', {
      type: 'application/octet-stream',
    });

    await expect(
      validateFiles(logoForm(file), LOGO_SCHEMA)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not inspect bytes when no allowlist is configured', async () => {
    const schema = { logo: { required: true } } as const;
    const file = new File([SVG_BYTES], 'logo.png', { type: 'image/png' });

    const result = await validateFiles(logoForm(file), schema);

    expect(result.logo.type).toBe('image/png');
  });
});
