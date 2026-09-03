/**
 * Every multipart upload in `api.ts` must re-forward its file through
 * `forwardMultipartUpload` — never by hand.
 *
 * THE BUG THIS EXISTS FOR. A `File` reconstructed off the inbound SvelteKit
 * request does not reliably survive re-serialisation into a new outbound
 * multipart body in workerd: the part reaches the worker WITHOUT a `filename`,
 * so `multipartProcedure` parses it as a string form field and rejects it with
 * MissingFileError (400) before any type/size logic runs. It is invisible
 * locally — Node/undici preserves the part — and only reproduces in
 * production. It bit the avatar path, then the logo path (both Codex-sxm74),
 * which is why `forwardMultipartUpload` was created to be the single home for
 * the fix.
 *
 * WHY NOTHING CAUGHT IT. `api.content.uploadThumbnail` was written afterwards
 * and did the raw thing anyway: `formData.append('thumbnail', file)` with no
 * arrayBuffer→File rebuild and no explicit filename. So content thumbnail
 * upload was broken in production for the same reason twice already fixed
 * elsewhere, and additionally threw away the worker's real error message. The
 * helper's own docstring claims it prevents "a third upload path" from
 * reintroducing the bug — but a claim in a comment is not a guard, and the
 * third path had already happened.
 *
 * WHY SOURCE-SCANNING RATHER THAN A TYPE OR A MOCK. No type expresses
 * "survives multipart re-serialisation in workerd". And a mocked `fetch`
 * cannot reproduce it at all: undici keeps the filename, so a unit test of the
 * broken code passes. Same lesson as `remote-file-uploads.test.ts` — a mock
 * more capable than the runtime hides exactly this class of defect. So the
 * rule is asserted over the source, mechanically.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = readFileSync(join(HERE, 'api.ts'), 'utf8');

/**
 * The helper's own body legitimately constructs a FormData. Bound the scan to
 * everything AFTER its closing brace so the one allowed construction does not
 * make the assertion vacuous.
 */
function sourceOutsideTheHelper(): string {
  const start = API_SRC.indexOf('async function forwardMultipartUpload');
  expect(
    start,
    'forwardMultipartUpload must exist in api.ts — if it was renamed, update this guard'
  ).toBeGreaterThan(-1);

  // The helper ends at the first line that closes a top-level function.
  const after = API_SRC.slice(start);
  const endIdx = after.indexOf('\n}\n');
  expect(endIdx, 'could not find the end of forwardMultipartUpload').toBeGreaterThan(-1);

  return API_SRC.slice(0, start) + after.slice(endIdx + 3);
}

describe('api.ts — multipart uploads may only travel via forwardMultipartUpload', () => {
  it('finds the helper, so the rules below are not asserted over an empty set', () => {
    expect(API_SRC).toContain('async function forwardMultipartUpload');
    // At least the known upload paths route through it.
    const callCount = (API_SRC.match(/forwardMultipartUpload</g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(6);
  });

  it('constructs a FormData in exactly one place — inside the helper', () => {
    const outside = sourceOutsideTheHelper();
    const strays = (outside.match(/new FormData\(\)/g) ?? []).length;

    expect(
      strays,
      'A hand-rolled FormData outside forwardMultipartUpload will lose the ' +
        'multipart filename in workerd and 400 in production. Call the helper.'
    ).toBe(0);
  });

  it('never appends a raw inbound File to a FormData', () => {
    const outside = sourceOutsideTheHelper();
    // `formData.append(<field>, file)` — the exact broken shape. The helper
    // appends a REBUILT file with an explicit third filename argument.
    const rawAppends = outside.match(/formData\.append\([^)]*,\s*file\s*\)/g) ?? [];

    expect(
      rawAppends,
      'Appending the inbound File directly is the workerd filename bug. ' +
        'forwardMultipartUpload rebuilds it via arrayBuffer() and passes an ' +
        'explicit filename.'
    ).toEqual([]);
  });

  it('keeps the arrayBuffer rebuild and explicit filename inside the helper', () => {
    // Guards the fix itself, so the helper cannot be "simplified" back into
    // the broken shape while every call site still looks correct.
    const start = API_SRC.indexOf('async function forwardMultipartUpload');
    const body = API_SRC.slice(start, start + 1400);

    expect(body).toContain('await file.arrayBuffer()');
    expect(body).toContain('new File(');
    // Third argument to append() is the filename — without it the part is
    // serialised as a plain field.
    expect(body).toMatch(/formData\.append\(\s*fieldName,\s*forwardFile,\s*forwardFile\.name\s*\)/);
  });
});
