/**
 * Which picture a piece of content shows is decided in ONE place,
 * `getDisplayThumbnail`: the creator's custom thumbnail, then the video
 * poster (Codex-une9r).
 *
 * Ten render sites used to inline the opposite order, or read only the
 * poster: the org landing (Editor's picks, the subscribe preview, browse, the
 * shelves), the creator profile and its content list, search, related
 * content, discover, and the content detail page with its og:image. A creator
 * who uploaded a custom thumbnail for a video still saw the auto-extracted
 * frame on every public page. This gate fails on any new read of the poster
 * outside the helper.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

/** The helper itself is the one place that reads the poster. */
const ALLOWED = new Set(['lib/utils/thumbnail.ts']);

/** Comments name things too: only code may count. */
const stripComments = (source: string) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const POSTER_READ = /mediaItem\??\.thumbnailUrl/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    const isSource = /\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name);
    return isSource ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  file: relative(SRC, path),
  code: stripComments(readFileSync(path, 'utf8')),
}));

describe('content pictures go through getDisplayThumbnail', () => {
  it('scans the whole app, and the pattern finds what it should', () => {
    // An empty or broken scan would pass everything below.
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.some(({ code }) => code.includes('getDisplayThumbnail('))
    ).toBe(true);
    expect(
      POSTER_READ.test('c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl')
    ).toBe(true);
    expect(POSTER_READ.test('item.mediaItem.thumbnailUrl')).toBe(true);
  });

  it('no file outside the helper picks the poster itself', () => {
    const offenders = files
      .filter(({ file }) => !ALLOWED.has(file))
      .filter(({ code }) => POSTER_READ.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
