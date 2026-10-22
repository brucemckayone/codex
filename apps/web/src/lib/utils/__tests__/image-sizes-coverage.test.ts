/**
 * Every `<img>` that draws a stored still chooses the file for its slot
 * (Codex-kk9nv.1-.3): a `srcset` the browser picks from, or a size helper on
 * its `src`. A raw `src` draws whichever file the row happens to store, which
 * was an 800px file in an 80px tile and a 200px file across a phone. The
 * likeliest way back to that is a NEW image, so this is a census of every
 * `<img>` with a dynamic `src`, not a test of the ones fixed today.
 *
 * Comments are stripped before the search, so a commented-out `srcset` does
 * not count. A `srcset` needs its `sizes`: without one the browser assumes the
 * image is as wide as the viewport, which is the regression itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..');

/** A `src` that picks its own file. */
const SIZE_HELPER = /\b(getThumbnailUrl|getShareImage|resolvePageImageUrl)\(/;

/** A logo is stored as uploaded, one file with no sizes (owner: "Leave logos out"). */
const LOGO = /\blogoUrl\b/;

/**
 * `src` values the file sizes where it declares them. Each names the
 * declaration that does it, which must still be in the file: a value put back
 * to the raw URL fails here, not only a value that is renamed.
 */
const SIZED_AT_DECLARATION: Record<string, Record<string, RegExp[]>> = {
  'lib/components/ui/Avatar/AvatarImage.svelte': {
    src: [
      /const src = \$derived\([^;]*getThumbnailUrl\(restProps\.src, 'sm'\)/,
    ],
  },
  'lib/components/layout/StudioSidebar/StudioSidebar.svelte': {
    brandImageUrl: [
      /const brandImageUrl = \$derived\([^;]*getThumbnailUrl\(brand\.imageUrl, 'sm'\)/,
    ],
  },
  'lib/components/page-builder/editor/ImageField.svelte': {
    thumb: [
      /const thumb = \$derived\([^;]*\bthumbUrl\)/,
      /const thumbUrl = \$derived\([^;]*resolvePageImageUrl\(ref, 'sm'/,
    ],
  },
  'lib/components/page-builder/editor/FocalPointField.svelte': {
    src: [/const src = \$derived\(resolvePageImageUrl\(image, 'md'/],
  },
};

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

/**
 * The source without comments: markup and block comments anywhere, line
 * comments only inside `<script>`. In markup a ` // ` is text (an alt, a
 * caption), and cutting the line there would hide the `<img>` after it.
 */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g,
      (_script, open: string, body: string, close: string) =>
        open + body.replace(/(^|[^:'"`])\/\/.*$/gm, '$1') + close
    );
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

/**
 * The `src` expression of a tag: `src={x}`, `{src}`, or a quoted value with a
 * `{…}` in it; null for a fixed `src="…"`.
 */
function srcExpression(tag: string): string | null {
  if (/\s\{src\}/.test(tag)) return 'src';
  const quoted = /\ssrc="([^"]*\{[^"]*)"/.exec(tag)?.[1];
  if (quoted !== undefined) return quoted;
  const open = /\ssrc=\{/.exec(tag);
  if (!open) return null;
  const start = open.index + open[0].length - 1;
  return tag.slice(start + 1, closingBrace(tag, start)).trim();
}

const sources = new Map(
  svelteFiles(SRC).map((path) => [
    relative(SRC, path),
    withoutComments(readFileSync(path, 'utf8')),
  ])
);

const images = [...sources].flatMap(([file, source]) =>
  imgTags(source).flatMap((tag) => {
    const src = srcExpression(tag);
    return src === null ? [] : [{ file, src, tag }];
  })
);

/** The declarations that size `src` in `file`, all still present; false if unlisted. */
function sizedAtDeclaration(file: string, src: string): boolean {
  const declarations = SIZED_AT_DECLARATION[file]?.[src];
  const source = sources.get(file) ?? '';
  return (
    declarations?.every((declaration) => declaration.test(source)) === true
  );
}

function choosesItsFile({
  file,
  src,
  tag,
}: {
  file: string;
  src: string;
  tag: string;
}): boolean {
  const offersSizes =
    /\s(srcset=|\{srcset\})/.test(tag) && /\s(sizes=|\{sizes\})/.test(tag);
  return (
    offersSizes ||
    SIZE_HELPER.test(src) ||
    LOGO.test(src) ||
    sizedAtDeclaration(file, src)
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
