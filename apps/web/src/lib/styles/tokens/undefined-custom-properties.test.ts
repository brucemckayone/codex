// @vitest-environment node
/**
 * No `var()` without a fallback names a property nothing defines
 * (Codex-1g5lh.6). An undefined custom property is guaranteed-invalid, and a
 * declaration that reads one with no fallback is invalid at computed-value
 * time: `height: calc(var(--space-48) * …)` fell back to `height: auto`, so
 * the logo-hero desktop logo sat at its intrinsic 26px whatever the Scale
 * dial said, and a whole `transition` shorthand naming `--duration-default`
 * was dropped, not just its duration. No browser reports either.
 *
 * Defined means one of: a declaration in CSS or an inline style
 * (`--x: …`), a Svelte `style:--x=` directive or `--x=` component prop, an
 * object key (`'--x': …`), `setProperty('--x', …)`, `@property --x`, or a
 * `--brand-{key}` / `--brand-{key}-dark` the brand editor writes at runtime
 * (BRAND_PREFIX_KEYS). A reference with a fallback is never checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BRAND_PREFIX_KEYS } from '$lib/brand-editor/css-injection';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (/\.(test|spec)\.ts$|\.d\.ts$/.test(name)) return [];
    return /\.(css|svelte|ts|html)$/.test(name) ? [path] : [];
  });
}

/**
 * The text with its comments blanked to spaces, so a name a comment mentions
 * is neither a reference nor a definition and line numbers still hold. A `//`
 * counts only after whitespace or a line start, which leaves `https://` alone.
 */
function withoutComments(text: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(
      /(^|\s)\/\/[^\n]*/g,
      (comment, lead: string) => `${lead}${blank(comment.slice(lead.length))}`
    );
}

/** Every `var(--name)` with no fallback, with its 1-based line. */
function references(text: string): { name: string; line: number }[] {
  return [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => ({
    name: match[1],
    line: text.slice(0, match.index).split('\n').length,
  }));
}

function definitions(text: string): string[] {
  return [
    ...text.matchAll(/(?<![\w-])(--[\w-]+)['"]?\s*[:=](?!=)/g),
    ...text.matchAll(/setProperty\(\s*['"`](--[\w-]+)['"`]/g),
    ...text.matchAll(/@property\s+(--[\w-]+)/g),
  ].map((match) => match[1]);
}

const runtimeBrandInputs = [...BRAND_PREFIX_KEYS].flatMap((key) => [
  `--brand-${key}`,
  `--brand-${key}-dark`,
]);

function undefinedReferences(files: Record<string, string>): string[] {
  const texts = Object.entries(files).map(
    ([file, text]) => [file, withoutComments(text)] as const
  );
  const defined = new Set([
    ...runtimeBrandInputs,
    ...texts.flatMap(([, text]) => definitions(text)),
  ]);
  return texts.flatMap(([file, text]) =>
    references(text)
      .filter(({ name }) => !defined.has(name))
      .map(({ name, line }) => `${file}:${line} ${name}`)
  );
}

describe('custom property references', () => {
  test('the check flags an undefined name and nothing else', () => {
    expect(
      undefinedReferences({
        'a.css': `a {
  --x: 1px;
  width: var(--x);
  height: var(--missing);
  top: var(--missing, 0);
  /* left: var(--in-a-comment); */
  margin: var(--brand-${[...BRAND_PREFIX_KEYS][0]});
}`,
      })
    ).toEqual(['a.css:4 --missing']);
  });

  test('a definition counts in every form the codebase writes one', () => {
    const forms = {
      'a.svelte': `<div style:--a={v} style="--b: 1px" ></div>
<Child --c="2px" />
<script>el.style.setProperty('--d', v); const s = { '--e': v };</script>
<style>@property --f { syntax: '<length>'; inherits: false; initial-value: 0; }</style>`,
      'b.css': `.logo--large:hover { width: var(--large); }
a { x: var(--a) var(--b) var(--c) var(--d) var(--e) var(--f); }`,
    };
    // `.logo--large:hover` is a BEM modifier, not a definition of `--large`.
    expect(undefinedReferences(forms)).toEqual(['b.css:1 --large']);
  });

  test('a comment marker inside a URL is not a comment', () => {
    expect(
      withoutComments('a { background: url(https://x.test/a.png); }')
    ).toContain('https://x.test/a.png');
  });

  test('none is undefined anywhere under src', () => {
    const files = sourceFiles(src);
    expect(files.length).toBeGreaterThan(500);
    const texts = Object.fromEntries(
      files.map((file) => [relative(src, file), readFileSync(file, 'utf8')])
    );
    expect(undefinedReferences(texts)).toEqual([]);
  });
});
