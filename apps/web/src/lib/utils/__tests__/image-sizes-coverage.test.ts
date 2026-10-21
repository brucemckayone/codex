/**
 * Every `<img>` that draws a stored still chooses the file for its slot
 * (Codex-kk9nv.1-.3): a `srcset` the browser picks from, or a size helper on
 * its `src`. A raw `src` draws whichever file the row happens to store, which
 * was an 800px file in an 80px tile and a 200px file across a phone. The
 * likeliest way back to that is a NEW image, so this is a census of every
 * `<img>` with a dynamic `src`, not a test of the ones fixed today.
 *
 * Comments are stripped before the search, so a commented-out `srcset` does
 * not count.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..');

/** A `src` that picks its own file. */
const SIZE_HELPER = /\b(getThumbnailUrl|getShareImage|resolvePageImageUrl)\(/;

/** A logo is stored as uploaded, one file with no sizes (owner: "Leave logos out"). */
const LOGO = /logo/i;

/** `src` values the file sizes where it declares them, and how. */
const SIZED_AT_DECLARATION: Record<string, Record<string, string>> = {
  'lib/components/ui/Avatar/AvatarImage.svelte': {
    src: "`getThumbnailUrl(restProps.src, 'sm')`",
  },
  'lib/components/layout/StudioSidebar/StudioSidebar.svelte': {
    brandImageUrl: "`getThumbnailUrl(brand.imageUrl, 'sm')`",
  },
  'lib/components/page-builder/editor/ImageField.svelte': {
    thumb: "`thumbUrl`, which is `resolvePageImageUrl(ref, 'sm', …)`",
  },
  'lib/components/page-builder/editor/FocalPointField.svelte': {
    src: "`resolvePageImageUrl(image, 'md', …)`",
  },
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

/** The end of the `{…}` expression that opens at `start`. */
function closingBrace(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  return source.length;
}

/** Each `<img …>` tag, read past any `>` inside a `{…}` attribute. */
function imgTags(source: string): string[] {
  const tags: string[] = [];
  const opening = /<img[\s/>]/g;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    let end = match.index + 4;
    while (end < source.length && source[end] !== '>') {
      end = source[end] === '{' ? closingBrace(source, end) + 1 : end + 1;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/** The `src` expression of a tag (`src={x}` or `{src}`); null for a fixed `src="…"`. */
function srcExpression(tag: string): string | null {
  if (/\s\{src\}/.test(tag)) return 'src';
  const open = /\ssrc=\{/.exec(tag);
  if (!open) return null;
  const start = open.index + open[0].length - 1;
  return tag.slice(start + 1, closingBrace(tag, start)).trim();
}

const images = svelteFiles(SRC).flatMap((path) => {
  const file = relative(SRC, path);
  return imgTags(withoutComments(readFileSync(path, 'utf8'))).flatMap((tag) => {
    const src = srcExpression(tag);
    return src === null ? [] : [{ file, src, tag }];
  });
});

function choosesItsFile({
  file,
  src,
  tag,
}: {
  file: string;
  src: string;
  tag: string;
}): boolean {
  return (
    /\ssrcset=/.test(tag) ||
    SIZE_HELPER.test(src) ||
    LOGO.test(src) ||
    src in (SIZED_AT_DECLARATION[file] ?? {})
  );
}

describe('every stored still chooses the file for its slot', () => {
  it('finds the images at all (the census is not empty)', () => {
    expect(images.length).toBeGreaterThanOrEqual(50);
  });

  for (const file of new Set(images.map((image) => image.file))) {
    it(file, () => {
      const raw = images
        .filter((image) => image.file === file && !choosesItsFile(image))
        .map((image) => `src={${image.src}}`);
      expect(raw).toEqual([]);
    });
  }

  it('lists no allowlisted src that has gone, so the list cannot go stale', () => {
    for (const [file, sources] of Object.entries(SIZED_AT_DECLARATION)) {
      const found = images.filter((image) => image.file === file);
      for (const src of Object.keys(sources)) {
        expect(found.map((image) => image.src)).toContain(src);
      }
    }
  });
});
