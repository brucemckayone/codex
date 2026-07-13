/**
 * workerd multipart round-trip — root-cause guard for the logo path (Codex-sxm74).
 *
 * Logo uploads 400'd in PRODUCTION only, for the SAME reason avatars did: the
 * web layer re-forwards the browser-uploaded File to organization-api over a
 * fresh cross-worker fetch, and in workerd a File reconstructed off the inbound
 * SvelteKit request does not survive re-serialisation with its `filename`
 * intact. When the outbound part carries no `filename`, workerd parses it as a
 * string form field — not a File — so `multipartProcedure`'s `validateFiles`
 * (`!(file instanceof File)`) rejects it with MissingFileError (400) BEFORE any
 * MIME/size logic runs. Node/undici preserves the part, so this was invisible
 * locally and only reproduced in prod.
 *
 * The fix (apps/web `forwardMultipartUpload`) re-materialises the bytes into a
 * fresh in-memory File and appends it WITH an explicit filename. These tests
 * pin the two runtime facts that fix relies on:
 *   1. a part WITHOUT a filename parses as a string (the prod 400 trigger);
 *   2. a fresh File appended WITH a filename serialises with `filename=` on the
 *      wire and round-trips back as a File (what the fix guarantees).
 *
 * They run under the workers pool (workerd), not Node — the only faithful
 * oracle for this bug.
 */

import { describe, expect, it } from 'vitest';

// Minimal valid PNG magic bytes — enough for the receiver's MIME sniff.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Build real multipart wire bytes for a `logo` part, optionally omitting the
 * `filename` from its Content-Disposition (the shape a stripped re-forward
 * produces on the wire).
 */
function multipartRequest(opts: { withFilename: boolean }): Request {
  const boundary = '----WebKitFormBoundaryLogoAbCdEf';
  const disposition = opts.withFilename
    ? `Content-Disposition: form-data; name="logo"; filename="logo.png"\r\n`
    : `Content-Disposition: form-data; name="logo"\r\n`;
  const head =
    `--${boundary}\r\n` + disposition + `Content-Type: image/png\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = new Uint8Array([
    ...new TextEncoder().encode(head),
    ...PNG_BYTES,
    ...new TextEncoder().encode(tail),
  ]);
  return new Request('http://org/api/organizations/x/settings/branding/logo', {
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

describe('logo re-forward — workerd INBOUND parse', () => {
  it('parses a part WITHOUT a filename as a STRING, not a File (the prod MissingFileError trigger)', async () => {
    const logo = (
      await multipartRequest({ withFilename: false }).formData()
    ).get('logo');
    // `validateFiles` does `!(file instanceof File)` → MissingFileError (400).
    // A string here is exactly what produced the production 400.
    expect(logo).not.toBeInstanceOf(File);
    expect(typeof logo).toBe('string');
  });

  it('parses a part WITH a filename as a File (what the sender fix guarantees)', async () => {
    const logo = (
      await multipartRequest({ withFilename: true }).formData()
    ).get('logo');
    expect(logo).toBeInstanceOf(File);
    expect((logo as File).name).toBe('logo.png');
    expect((logo as File).type).toBe('image/png');
  });
});

describe('logo re-forward — workerd OUTBOUND serialise', () => {
  it('writes a filename= for a fresh File appended with an explicit name', async () => {
    // Mirrors forwardMultipartUpload: fresh in-memory File + explicit filename.
    const fresh = new File([PNG_BYTES], 'logo', { type: 'image/png' });
    const fd = new FormData();
    fd.append('logo', fresh, fresh.name);
    const wire = await serialiseToWire(fd);
    expect(wire).toContain('filename="logo"');
  });

  it('round-trips a fresh explicit-filename File back to a File across serialise→parse', async () => {
    const fresh = new File([PNG_BYTES], 'logo', { type: 'image/png' });
    const fd = new FormData();
    fd.append('logo', fresh, fresh.name);
    // Re-parse the serialised body exactly as organization-api would.
    const roundTripped = (
      await new Request('http://org/', { method: 'POST', body: fd }).formData()
    ).get('logo');
    expect(roundTripped).toBeInstanceOf(File);
  });
});
