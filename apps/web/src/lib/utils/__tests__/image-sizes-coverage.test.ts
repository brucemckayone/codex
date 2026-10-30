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

/** Every `.svelte` and `.ts` file a page is built from: no tests, no generated messages. */
function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'paraglide'
        ? []
        : codeFiles(path);
    }
    const isCode = /\.(svelte|ts)$/.test(entry.name);
    return isCode && !/\.(test|spec)\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** A `<script>` or `<style>` block: its opening tag, tag name, body and close. */
const CODE_BLOCK = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/g;

/** Script without its `/* … *\/` and `//` comments. */
function codeWithoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * The source without comments: markup comments anywhere, and code comments
 * only where they can be, `/* … *\/` in `<script>` and `<style>`, `//` in
 * `<script>`. In markup both are text: a ` // ` in an alt, or the `/*` in
 * `accept="image/*"`, which would otherwise run to the next `*\/` in the file
 * and hide every `<img>` between them.
 */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      CODE_BLOCK,
      (_block, open: string, tag: string, body: string, close: string) => {
        const stripped =
          tag === 'script'
            ? codeWithoutComments(body)
            : body.replace(/\/\*[\s\S]*?\*\//g, '');
        return open + stripped + close;
      }
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

/**
 * No `sizes` value uses min(), max() or clamp(). Safari before 26.4 ignores an
 * entry that does, and calc() around one, and falls back to 100vw (WebKit bug
 * 304915): the file for the whole viewport, in every slot (Codex-kk9nv.3).
 * Outside `<style>` blocks and `style` attributes, a CSS math function with a
 * length in it is a `sizes` value in this app, so every one is a failure.
 * That includes the page builder's generators since Codex-sntzy.
 */
describe('no sizes value uses a math function', () => {
  const MATH_FUNCTION = /(?<![.\w$-])(min|max|clamp)\(/g;
  /** A length in the arguments, written out or after a `${…}`, or a `${…}` itself. */
  const LENGTH = /[\d}](r?em|px|[sdl]?v[whib]|vmin|vmax|ch|ex|cq[whib]|%)|\$\{/;

  /** The code a `sizes` value can be written in: no styles, no comments. */
  function sizesCode(source: string, isTs: boolean): string {
    if (isTs) return codeWithoutComments(source);
    return withoutComments(source)
      .replace(CODE_BLOCK, (block, open: string, tag: string) =>
        tag === 'style' ? open : block
      )
      .replace(/\sstyle(:[\w-]+)?="[^"]*"/g, '');
  }

  /** The `(…)` that opens at `start`, with what it holds. */
  function parenthesised(source: string, start: number): string {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) {
        return source.slice(start, i + 1);
      }
    }
    return source.slice(start);
  }

  /** Each math function in `code` with a length in its arguments. */
  function mathFunctions(code: string): string[] {
    return [...code.matchAll(MATH_FUNCTION)].flatMap((match) => {
      const args = parenthesised(code, match.index + match[0].length - 1);
      return LENGTH.test(args) ? [`${match[1]}${args}`] : [];
    });
  }

  const uses = codeFiles(SRC).flatMap((path) =>
    mathFunctions(
      sizesCode(readFileSync(path, 'utf8'), path.endsWith('.ts'))
    ).map((use) => `${relative(SRC, path)}: ${use}`)
  );

  // The page builder's generators were written like these before
  // Codex-sntzy; the census must still see each one, in script and markup,
  // and pass over a style and a math function with no length in it.
  it('finds the shapes it looks for (the census is not blind)', () => {
    const script = `const s = \`min(\${vw}vw, \${rem}rem)\`, n = Math.min(a, 3);`;
    expect(mathFunctions(sizesCode(script, true))).toEqual([
      `min(\${vw}vw, \${rem}rem)`,
    ]);
    const markup = [
      "<script>const s = 'clamp(16rem, 34vw, 28rem)';</script>",
      '<img sizes="min(100vw, 52rem)" alt="" />',
      '<div style="width: min(100%, 4rem)"></div>',
      '<style>a { width: max(1rem, 2vw); }</style>',
    ].join('');
    expect(mathFunctions(sizesCode(markup, false))).toEqual([
      'clamp(16rem, 34vw, 28rem)',
      'min(100vw, 52rem)',
    ]);
  });

  it('finds none', () => {
    expect(uses).toEqual([]);
  });
});
