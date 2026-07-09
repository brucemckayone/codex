/**
 * workerd multipart round-trip — root-cause guard for Codex-sxm74.
 *
 * Avatar uploads 400'd in PRODUCTION only. These tests pin the workerd runtime
 * behaviour that made the bug environment-specific (Node/undici does not behave
 * this way), and document why the fix lives in the receiver's MIME sniffing.
 *
 * Chain:
 *   1. INBOUND parse — a browser omits (or a re-forward strips) the part's
 *      `Content-Type` → workerd yields a File with `type === ''`.
 *   2. OUTBOUND serialise — the web layer re-appends that File to a fresh
 *      FormData and fetches identity-api; workerd writes
 *      `Content-Type: application/octet-stream` for the empty-typed part.
 *   3. identity-api parses that part → `file.type === 'application/octet-stream'`,
 *      which is NOT in the image allowlist → InvalidFileTypeError (400).
 *
 * `validateFiles` (@codex/worker-utils) now sniffs the magic bytes to recover
 * the real type; these tests guard the runtime assumptions that fix relies on.
 */

import { describe, expect, it } from 'vitest';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** Build real multipart wire bytes, optionally including the part Content-Type. */
function multipartRequest(opts: { partContentType?: string }): Request {
  const boundary = '----WebKitFormBoundaryAbCdEf123';
  const ct = opts.partContentType
    ? `Content-Type: ${opts.partContentType}\r\n`
    : '';
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="avatar"; filename="photo.jpg"\r\n` +
    ct +
    `\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = new Uint8Array([
    ...new TextEncoder().encode(head),
    ...JPEG_BYTES,
    ...new TextEncoder().encode(tail),
  ]);
  return new Request('http://identity/api/user/avatar', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

/** Force real multipart serialisation of a FormData body and return the wire text. */
async function serialiseToWire(fd: FormData): Promise<string> {
  const req = new Request('http://x/', { method: 'POST', body: fd });
  return new TextDecoder().decode(await req.arrayBuffer());
}

describe('workerd multipart INBOUND parse', () => {
  it('preserves a part Content-Type into File.type', async () => {
    const avatar = (
      await multipartRequest({ partContentType: 'image/jpeg' }).formData()
    ).get('avatar');
    expect(avatar).toBeInstanceOf(File);
    expect((avatar as File).type).toBe('image/jpeg');
  });

  it('yields an EMPTY File.type when the part has no Content-Type (the prod trigger)', async () => {
    const avatar = (await multipartRequest({}).formData()).get('avatar');
    expect(avatar).toBeInstanceOf(File);
    // Still a File (not a string) — so the receiver fails at the type check,
    // not with MissingFileError.
    expect((avatar as File).type).toBe('');
  });
});

describe('workerd multipart OUTBOUND serialise', () => {
  it('writes application/octet-stream for a File whose type is empty', async () => {
    const fd = new FormData();
    fd.append('avatar', new File([JPEG_BYTES], 'photo.jpg', { type: '' }));
    const wire = await serialiseToWire(fd);
    // This is the exact byte-level root cause: the receiver sees octet-stream,
    // never the empty string.
    expect(wire).toContain('Content-Type: application/octet-stream');
  });

  it('preserves a present File.type across serialisation', async () => {
    const fd = new FormData();
    fd.append(
      'avatar',
      new File([JPEG_BYTES], 'photo.jpg', { type: 'image/jpeg' })
    );
    const wire = await serialiseToWire(fd);
    expect(wire).toContain('Content-Type: image/jpeg');
  });
});
