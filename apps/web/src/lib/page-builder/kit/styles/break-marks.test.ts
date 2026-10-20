/**
 * A Break's mark, Style by Style (03 X64, Codex-61zsk.53).
 *
 * The inspector offers the mark only in the Styles that draw one (the field's
 * `styles`), so each of those Styles must draw it, and the others none.
 *
 * Every mark is in an ink already proven against every scheme the Break can
 * stand on: the new drawings (Studio's stroke, Soft's pebbles, Cinematic's
 * hairline) in `--lp-mark-ink`, the decorative grade that holds 3:1 on all
 * of them (`schemes.test.ts`, X24); the reused separators in the ink they
 * already part sections with (Bold's slab in the ink, Quiet's and Poster's
 * rules in the line). A paint is read as written in the rule that draws the
 * mark, every colour stop of a gradient included.
 *
 * A marked Break replaces the Style's own separator at its joint: the slab
 * and the hairline are matched against real elements (jsdom's selector
 * engine), never against a string, so the test reads what the browser reads.
 *
 * Read with svelte's own CSS parser, comments stripped first.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { breakDefinition } from '../blocks/break/definition';
import { PAGE_STYLE_IDS, type PageStyleId } from '../model/ids';

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

const DIR = dirname(fileURLToPath(import.meta.url));
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const uncomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

function rulesOf(css: string): Rule[] {
  const rules: Rule[] = [];
  const visit = (children: CssNode[]) => {
    for (const node of children) {
      if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const decls = new Map<string, string>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', squash(d.value ?? ''));
        rules.push({
          selector: squash(css.slice(node.prelude.start, node.prelude.end)),
          decls,
        });
      }
      visit(node.block?.children ?? []);
    }
  };
  visit(parseCss(css).children as unknown as CssNode[]);
  return rules;
}

const sheet = (style: PageStyleId) =>
  rulesOf(uncomment(readFileSync(join(DIR, `style-${style}.css`), 'utf8')));

/** The rules that draw the mark: their selector ends at the mark itself. */
const markRules = (style: PageStyleId) =>
  sheet(style).filter((rule) => /\.lp-break__mark$/.test(rule.selector));

/** Every colour a paint names: a `var()`, or a gradient's colour stops. */
function inks(paint: string): string[] {
  return [...paint.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
    .map((m) => m[1])
    .filter(
      (name) => name.startsWith('--lp-') && !name.startsWith('--lp-rule')
    );
}

const MARKED = new Set(
  breakDefinition.fields.find((field) => field.key === 'mark')?.styles ?? []
);

const INK: Partial<Record<PageStyleId, string>> = {
  studio: '--lp-mark-ink',
  soft: '--lp-mark-ink',
  cinematic: '--lp-mark-ink',
  bold: '--lp-ink',
  quiet: '--lp-line',
  poster: '--lp-line',
};

describe("a Break's mark", () => {
  it('is offered in six Styles, and in neither Clean nor Path', () => {
    expect([...MARKED].sort()).toEqual(
      ['bold', 'cinematic', 'poster', 'quiet', 'soft', 'studio'].sort()
    );
  });

  it.each(
    PAGE_STYLE_IDS
  )('%s draws one exactly where the inspector offers it', (style) => {
    expect(markRules(style).length > 0).toBe(MARKED.has(style));
  });

  it.each([
    ...MARKED,
  ] as PageStyleId[])('%s paints it only in an ink proven on every ground it can stand on', (style) => {
    const paints = markRules(style).flatMap((rule) =>
      ['background', 'background-color', 'background-image']
        .map((p) => rule.decls.get(p))
        .filter((v): v is string => v !== undefined)
    );
    expect(paints.length, style).toBeGreaterThan(0);
    const used = new Set(paints.flatMap(inks));
    expect([...used], style).toEqual([INK[style]]);
  });
});

describe('a marked Break replaces the Style’s own separator at its joint', () => {
  /** A page of three sections, the middle one a Break, as the renderer draws it. */
  function page(style: PageStyleId, marked: boolean) {
    document.body.innerHTML = `
      <div class="lp" data-lp-style="${style}">
        <section class="lp-section" data-lp-type="problem" data-lp-scheme="base"></section>
        <section class="lp-section" data-lp-type="break" data-lp-scheme="base">
          <div class="lp-inner"><div class="lp-break"${marked ? ' data-mark=""' : ''}></div></div>
        </section>
        <section class="lp-section" data-lp-type="curriculum" data-lp-scheme="base"></section>
      </div>`;
    const [, pause, after] = document.querySelectorAll('.lp-section');
    return { pause, after };
  }

  /** The separator's rule: Bold's slab, Quiet's hairline (its `::before`). */
  const separator = (style: 'bold' | 'quiet') => {
    const rule = sheet(style).find((r) =>
      style === 'bold'
        ? r.decls.get('background')?.includes('--_bold-slab')
        : r.selector.endsWith('::before') &&
          r.decls.get('background') === 'var(--lp-line)'
    );
    expect(rule, style).toBeDefined();
    return (rule?.selector ?? '').replace(/::before$/, '');
  };

  it.each([
    'bold',
    'quiet',
  ] as const)('%s: never on the Break, and not under a marked one', (style) => {
    const selector = separator(style);
    const plain = page(style, false);
    expect(plain.pause.matches(selector), 'the Break itself').toBe(false);
    expect(plain.after.matches(selector), 'under a plain Break').toBe(true);
    const marked = page(style, true);
    expect(marked.after.matches(selector), 'under a marked Break').toBe(false);
  });
});
