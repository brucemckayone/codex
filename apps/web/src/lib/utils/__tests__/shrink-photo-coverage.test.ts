/**
 * Every file input that uploads a still must shrink the photo first
 * (Codex-kk9nv.12). The server refuses anything over `MAX_IMAGE_PIXELS`, so an
 * input that skips `shrink-photo` turns every phone photo into an error. The
 * likeliest way back to that is a NEW upload input, so this is a census of
 * all of them, not a test of the eight wired today.
 *
 * Comments are stripped before the search, so a commented-out handler does
 * not count as wired.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..');

/** File inputs that never carry a still the server decodes, and why. */
const NOT_A_STILL: Record<string, string> = {
  'lib/components/studio/LogoUpload.svelte':
    'a logo is stored as uploaded and never decoded (owner: "Leave logos out")',
  'lib/components/studio/MediaUpload.svelte':
    'video and audio, which the transcoder handles',
  'routes/shader-gallery/+page.svelte': 'an audio file for a dev-only page',
};

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const inputs = svelteFiles(SRC)
  .map((path) => ({
    file: relative(SRC, path),
    source: withoutComments(readFileSync(path, 'utf8')),
  }))
  .filter(({ source }) => /type="file"|\.as\('file'\)/.test(source));

describe('every still upload shrinks the photo first', () => {
  it('finds the upload inputs at all (the census is not empty)', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(8);
  });

  for (const { file, source } of inputs) {
    if (file in NOT_A_STILL) continue;
    it(file, () => {
      expect(source).toMatch(
        /\bshrinkPhoto(Input|AndSubmit)?\(|\{shrinkPhotoAndSubmit\}/
      );
    });
  }

  it('lists no allowlisted file that has gone, so the list cannot go stale', () => {
    const found = new Set(inputs.map(({ file }) => file));
    for (const file of Object.keys(NOT_A_STILL)) expect(found).toContain(file);
  });
});
