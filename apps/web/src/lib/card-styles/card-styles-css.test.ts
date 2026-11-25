// @vitest-environment node
/**
 * The card style sheets stay ported, scoped and self-sufficient
 * (Codex-7104r.3).
 *
 * `lib/styles/card-styles/` holds one sheet per card style, ported nearly
 * verbatim from the card-styles gallery (Codex-7104r), and `base.css`, the
 * zero-specificity floor StyledCard imports. The org layout links only the
 * active style's sheet; while the brand editor is open it links all of them
 * at once for the picker (plan D5). So:
 *
 * - The set is exactly base.css plus one sheet per CARD_STYLES id but
 *   `today`, which is the current markup and has no sheet. A listed style
 *   with no sheet would link a missing file; a stray sheet is dead weight.
 * - No rule names the `.card` class. The gallery's block class is renamed
 *   `.sc`: the app already uses `card` (ui/Card, the pricing page), and a
 *   `.card` rule would restyle them.
 * - Every selector in a style's sheet starts with its own
 *   `[data-card-style='<id>']`, the attribute on StyledCard's wrapper. One
 *   unscoped selector would restyle every other style's preview in the
 *   picker. The one prefix allowed before it is the theme on the root,
 *   `:root[data-theme='dark'] ` (the app sets it on `<html>`, as the gallery
 *   does): editorial's dark media. Selectors come from svelte's CSS parser,
 *   so a comma inside `:is()` or `:where()` never splits one.
 * - Every `var(--card-*)` read with no fallback is declared in the same
 *   sheet, in base.css or by the org brand (org-brand.css: the hover
 *   scales), or is `--card-img-ratio`, which StyledCard sets inline from the
 *   image's real ratio. An undeclared name is invalid at computed-value time
 *   and no browser reports it. undefined-custom-properties.test.ts checks
 *   names across all of src; this is the closer rule, that a sheet never
 *   leans on another style's sheet, which is not linked.
 * - No `@import` and no off-site `url()`: each style is one hashed,
 *   self-contained file.
 *
 * Comments are stripped before any regex reads a sheet.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_STYLES } from '@codex/validation';
import { type AST, parseCss } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SHEETS = join(here, '../styles/card-styles');
const ORG_BRAND = join(here, '../styles/tokens/org-brand.css');

/** Every card style but `today`, which is the current markup. */
const SHEET_IDS = CARD_STYLES.filter((id) => id !== 'today');

/** Set inline on the media box by StyledCard, from the image's real ratio. */
const INLINE = new Set(['--card-img-ratio']);

/** A sheet holds no string with a comment marker in it. */
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

type CssNode = AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration;

/**
 * Every rule's selectors, at the top level and inside at-rules. A nested
 * rule is relative to a parent already read; keyframe stops are not
 * selectors.
 */
function selectorsOf(css: string): string[] {
  const out: string[] = [];
  const walk = (nodes: ReadonlyArray<CssNode>) => {
    for (const node of nodes) {
      if (node.type === 'Rule') {
        for (const selector of node.prelude.children)
          out.push(uncommented(css.slice(selector.start, selector.end)).trim());
      } else if (
        node.type === 'Atrule' &&
        node.block &&
        node.name !== 'keyframes'
      ) {
        walk(node.block.children);
      }
    }
  };
  walk(parseCss(css).children);
  return out;
}

/** The custom properties a sheet declares, at any depth. */
function declared(css: string): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: ReadonlyArray<CssNode>) => {
    for (const node of nodes) {
      if (node.type === 'Declaration') {
        if (node.property.startsWith('--')) out.add(node.property);
      } else if (node.block) {
        walk(node.block.children);
      }
    }
  };
  walk(parseCss(css).children);
  return out;
}

/** The theme on the root, the one thing a scoped selector may start with. */
const THEME_ROOT = /^:root\[data-theme='[a-z]+'\] /;

/** The selectors that do not start with this style's own scope. */
function unscoped(id: string, css: string): string[] {
  const scope = `[data-card-style='${id}']`;
  return selectorsOf(css).filter(
    (selector) => !selector.replace(THEME_ROOT, '').startsWith(scope)
  );
}

/** `.card` and `.card__*` class selectors. */
function cardClasses(css: string): string[] {
  const text = uncommented(css);
  return [/\.card(?![a-z0-9_-])/g, /\.card__[\w-]*/g].flatMap((re) =>
    [...text.matchAll(re)].map((m) => m[0])
  );
}

/** `--card-*` names read with no fallback; an empty fallback is none. */
function bareCardReads(css: string): string[] {
  const text = uncommented(css);
  return [...text.matchAll(/\bvar\(\s*(--card-[\w-]+)\s*(?:,\s*)?/gi)]
    .filter((m) => text[(m.index ?? 0) + m[0].length] === ')')
    .map((m) => m[1]);
}

/** `@import`s, and `url()`s that name a scheme or host (`data:` aside). */
function external(css: string): string[] {
  const text = uncommented(css);
  const imports = [...text.matchAll(/@import\b[^;]*/gi)].map((m) => m[0]);
  const urls = [...text.matchAll(/url\(\s*(['"]?)\s*([^'")\s]*)/gi)]
    .filter(
      (m) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(m[2]) && !/^data:/i.test(m[2])
    )
    .map((m) => m[0]);
  return [...imports, ...urls];
}

describe('the checks catch what they guard', () => {
  test('a selector list splits only at its top-level commas, inside at-rules too', () => {
    const css = `[data-card-style='x'] .sc:is(.a, .b), .sc { color: red; }
@container (max-width: 13rem) { [data-card-style='x'] .sc, .stray { top: 0; } }
@keyframes spin { from { rotate: 0deg; } }`;
    expect(selectorsOf(css)).toEqual([
      "[data-card-style='x'] .sc:is(.a, .b)",
      '.sc',
      "[data-card-style='x'] .sc",
      '.stray',
    ]);
  });

  test('only the theme root may come before the scope', () => {
    const css = `:root[data-theme='dark'] [data-card-style='x'] .sc { top: 0; }
:root[data-theme='dark'] .sc, .x [data-card-style='x'] .sc,
[data-card-style='y'] .sc { top: 0; }`;
    expect(unscoped('x', css)).toEqual([
      ":root[data-theme='dark'] .sc",
      ".x [data-card-style='x'] .sc",
      "[data-card-style='y'] .sc",
    ]);
  });

  test('.card and .card__x are caught; .cards, --card-x and the scope are not', () => {
    const css = `/* .card in a comment */ .card { } :where(.card__media) { }
.cards { --card-x: 1; } [data-card-style='x'] { }`;
    expect(cardClasses(css)).toEqual(['.card', '.card__media']);
  });

  test('a card read with no fallback, or an empty one, is caught', () => {
    expect(
      bareCardReads(
        'a { x: var(--card-a) var( --card-b , ) var(--card-c, 1) var(--other); }'
      )
    ).toEqual(['--card-a', '--card-b']);
  });

  test('an @import and an off-site url() are caught; data: and fragments are not', () => {
    const css = `@import 'x.css';
a { background: url(https://x.test/a.png), url('//x.test/b.png'), url(data:image/png;base64,AA), url(#f); }`;
    expect(external(css)).toEqual([
      "@import 'x.css'",
      'url(https://x.test/a.png',
      "url('//x.test/b.png",
    ]);
  });
});

describe('card style sheets', () => {
  const files = readdirSync(SHEETS).sort();
  const sheet = (file: string) => readFileSync(join(SHEETS, file), 'utf8');
  const base = sheet('base.css');

  test('the set is base.css and one sheet per card style but today', () => {
    expect(SHEET_IDS).toHaveLength(19);
    expect(files).toEqual(
      ['base.css', ...SHEET_IDS.map((id) => `${id}.css`)].sort()
    );
  });

  test('no rule names the .card class', () => {
    expect(
      files.flatMap((file) =>
        cardClasses(sheet(file)).map((c) => `${file}: ${c}`)
      )
    ).toEqual([]);
  });

  test("every selector in a style's sheet starts with its own [data-card-style]", () => {
    const stray = SHEET_IDS.flatMap((id) => {
      const css = sheet(`${id}.css`);
      // A sheet the parser read as empty would pass vacuously.
      expect(selectorsOf(css).length, `${id}.css`).toBeGreaterThan(20);
      return unscoped(id, css).map((selector) => `${id}.css: ${selector}`);
    });
    expect(stray).toEqual([]);
  });

  test('every --card-* read with no fallback is declared where the sheet can see it', () => {
    const shared = new Set([
      ...declared(base),
      ...[...declared(readFileSync(ORG_BRAND, 'utf8'))].filter((name) =>
        name.startsWith('--card-')
      ),
      ...INLINE,
    ]);
    const missing = files.flatMap((file) => {
      const own = declared(sheet(file));
      return [...new Set(bareCardReads(sheet(file)))]
        .filter((name) => !own.has(name) && !shared.has(name))
        .map((name) => `${file}: ${name}`);
    });
    expect(missing).toEqual([]);
  });

  test('no sheet imports another file or reaches off-site', () => {
    expect(
      files.flatMap((file) =>
        external(sheet(file)).map((hit) => `${file}: ${hit}`)
      )
    ).toEqual([]);
  });
});
