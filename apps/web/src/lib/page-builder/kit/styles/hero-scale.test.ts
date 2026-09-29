// @vitest-environment node
/**
 * The hero headline's continuous scale, and the steps it stands on
 * (Codex-61zsk.34). Where the browser knows `pow()`, a Style sets the hero's
 * headline at a size computed from its length, character by character
 * (`--lp-heading-chars`, which HeroBlock sets). Where it does not, Bold's,
 * Poster's and Cinematic's two steps stand (X27's `data-long`, X31's
 * `data-medium`), and the other Styles keep their full size.
 *
 * Both halves are plain CSS, so nothing fails when either goes astray. A
 * continuous rule outside its `@supports` hands an older browser an invalid
 * `font-size`, and the display drops to the body's size. One outside its
 * container query scales a phone. A deleted step leaves that older browser a
 * wall of type. So every continuous rule sits inside an `@supports` test of
 * each function it uses, made on a real property (a custom property takes
 * any value, so a test of one always passes), and inside the ≥ 56rem
 * container. Every stepped layout keeps its steps outside that test.
 *
 * Read with svelte's own CSS parser, comments stripped first.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS, type PageStyleId } from '../model/ids';

const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The scaled parents each Style sets a continuous scale on (the layout's
 * element). Bold's, Poster's and Cinematic's posters are absent on purpose
 * (below).
 */
const CONTINUOUS: Record<PageStyleId, string[]> = {
  bold: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-split__copy',
    '.hero-statement',
  ],
  poster: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-split__copy',
    '.hero-statement',
  ],
  cinematic: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-split__copy',
    '.hero-statement',
  ],
  clean: ['.hero-cover__copy', '.hero-poster', '.hero-split__copy'],
  soft: ['.hero-cover__copy', '.hero-poster'],
  path: ['.hero-cover__copy', '.hero-poster', '.hero-split__copy'],
  studio: ['.hero-cover__copy', '.hero-poster'],
  quiet: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-poster',
    '.hero-split__copy',
    '.hero-statement',
  ],
};

/** The scaled parents each Style steps down (X27, X31): the fallback. */
const STEPPED: Partial<Record<PageStyleId, string[]>> = {
  bold: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-poster',
    '.hero-split__copy',
    '.hero-statement',
  ],
  poster: [
    '.hero-centered',
    '.hero-cover__copy',
    '.hero-poster',
    '.hero-split__copy',
    '.hero-statement',
  ],
  cinematic: [
    '.hero-cover__copy',
    '.hero-poster',
    '.hero-split__copy',
    '.hero-statement',
  ],
};

/** Math functions older than `pow()`, which need no test of their own. */
const KNOWN = new Set(['calc', 'min', 'max', 'clamp', 'var']);

type CssNode = {
  type: string;
  name?: string;
  prelude?: string | { start: number; end: number };
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
  children?: CssNode[];
};

interface ScaleRule {
  selector: string;
  /** The hero classes it sets the scale on (before its `:has()`). */
  parents: string[];
  value: string;
  /** The at-rules around it, outermost first, e.g. `container (min-width: 56rem)`. */
  within: string[];
}

const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

function scaleRules(style: PageStyleId): ScaleRule[] {
  const css = uncomment(readFileSync(join(DIR, `style-${style}.css`), 'utf8'));
  const rules: ScaleRule[] = [];
  const visit = (nodes: CssNode[], within: string[]) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
        visit(node.block?.children ?? [], [
          ...within,
          `${node.name} ${node.prelude}`,
        ]);
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const selector = css.slice(node.prelude.start, node.prelude.end);
        const target = selector.split(':has(')[0];
        for (const child of node.block?.children ?? [])
          if (
            child.type === 'Declaration' &&
            child.property === '--lp-display-scale'
          )
            rules.push({
              selector,
              parents: target.match(/\.hero-[a-z_-]+/g) ?? [],
              value: child.value ?? '',
              within,
            });
      }
    }
  };
  visit(parseCss(css).children as unknown as CssNode[], []);
  return rules;
}

const parentsOf = (rules: ScaleRule[]) =>
  [...new Set(rules.flatMap((rule) => rule.parents))].sort();
const supportsOf = (rule: ScaleRule) =>
  rule.within.filter((at) => at.startsWith('supports '));

describe.each(PAGE_STYLE_IDS)('%s: the hero headline scale', (style) => {
  const rules = scaleRules(style);
  const continuous = rules.filter((rule) =>
    rule.value.includes('var(--lp-heading-chars')
  );
  const steps = rules.filter(
    (rule) =>
      /\[data-(medium|long)\]/.test(rule.selector) &&
      !rule.value.includes('var(')
  );
  const stepped = STEPPED[style] ?? [];

  it('is continuous only where pow() is known, and only at ≥ 56rem', () => {
    expect(parentsOf(continuous)).toEqual(CONTINUOUS[style]);
    for (const rule of continuous) {
      const supports = supportsOf(rule);
      expect(supports, rule.selector).toHaveLength(1);
      expect(supports[0], rule.selector).toMatch(/^supports \((?!--)[a-z-]+:/);
      expect(rule.within, rule.selector).toContain(
        'container (min-width: 56rem)'
      );
      for (const fn of rule.value.match(/[a-z-]+(?=\()/g) ?? [])
        if (!KNOWN.has(fn))
          expect(supports[0], `${rule.selector} uses ${fn}()`).toContain(
            `${fn}(`
          );
    }
  });

  it('keeps its steps outside that test, a long one for every layout it steps', () => {
    const fallback = steps.filter((rule) => supportsOf(rule).length === 0);
    expect(fallback).toHaveLength(steps.length);
    for (const rule of fallback)
      expect(rule.within, rule.selector).toEqual([
        'container (min-width: 56rem)',
      ]);
    expect(parentsOf(fallback)).toEqual(stepped);
    expect(
      parentsOf(
        fallback.filter((rule) => rule.selector.includes('[data-long]'))
      )
    ).toEqual(stepped);
  });
});

// Beside the poster's picture the longest word, not the headline's length,
// sets how large the headline can be (a long word splits first), so a curve
// on length lost to the steps there at most lengths. Where a poster has steps
// it keeps both and takes no continuous rule: word length is Codex-61zsk.33's.
describe.each([
  'bold',
  'poster',
  'cinematic',
] as const)('%s: the poster hero stays stepped', (style) => {
  const poster = scaleRules(style).filter((rule) =>
    rule.parents.includes('.hero-poster')
  );

  it('keeps its medium and long steps outside the test, and no continuous rule', () => {
    expect(
      poster.filter((rule) => rule.value.includes('var(--lp-heading-chars'))
    ).toEqual([]);
    for (const tier of ['[data-medium]', '[data-long]'])
      expect(
        poster.filter(
          (rule) =>
            rule.selector.includes(tier) && supportsOf(rule).length === 0
        ),
        tier
      ).toHaveLength(1);
  });
});
