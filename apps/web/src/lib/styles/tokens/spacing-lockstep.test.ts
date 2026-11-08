// @vitest-environment node
/**
 * The `:root` spacing scale and its `[data-org-brand]` re-declaration hold the
 * same rungs with the same formulas (spacing.css R12, Codex-1g5lh.6).
 *
 * A `:root` declaration substitutes `var(--space-unit)` once, at density 1,
 * and descendants inherit the resolved length; only the org-scope twin makes
 * a rung follow the org's density. A rung missing there ignores the density
 * dial (`--space-32` was a fixed 128px on every org page); a rung missing from
 * `:root` is invalid on every platform route (`--space-9`, `--space-14`).
 *
 * Each sheet is read by Svelte's CSS parser, and every `--space-*` rung must
 * sit in that sheet's one scale block, declared once: a twin under another
 * selector or in a media query would not be the declaration in force. The org
 * block's own `--space-unit` is pinned to the org's density too: without it,
 * every twin multiplies the unit `:root` resolved at density 1.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AST, parseCss } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const SCALE_BLOCK = {
  'spacing.css': ':root',
  'org-brand.css':
    "[data-org-brand], :where([data-org-brand]) [style*='--brand-']",
} as const;

interface Rung {
  name: string;
  formula: string;
  /** The rules and at-rules it sits in, outermost first. */
  where: string;
}

/** The unit, and the density it is built from. */
const UNIT = ['--space-unit', '--brand-density-scale', '--brand-density'];

/**
 * The one formula a rung's name allows: `--space-N` is N units, `--space-N-5`
 * N and a half, `--space-1` the unit itself. Nothing else follows density.
 */
function formulaFor(name: string): string | null {
  const match = /^--space-(\d+)(-5)?$/.exec(name);
  if (!match) return null;
  const units = Number(match[1]) + (match[2] ? 0.5 : 0);
  return units === 1
    ? 'var(--space-unit)'
    : `calc(var(--space-unit) * ${units})`;
}

/**
 * Every `--space-*` declaration in a sheet, and the density scale, wherever it
 * sits, its formula without comments.
 */
function scale(file: keyof typeof SCALE_BLOCK): Rung[] {
  const css = readFileSync(join(here, file), 'utf8');
  const found: Rung[] = [];
  const walk = (
    nodes: ReadonlyArray<AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration>,
    where: string[]
  ) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
        // A registered initial value stands in wherever the block does not
        // reach, and replaces every fallback: a declaration of its own.
        const registered = node.prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (
          node.name.toLowerCase() === 'property' &&
          (registered.startsWith('--space-') || UNIT.includes(registered))
        )
          found.push({
            name: registered,
            formula: '@property',
            where: [...where, '@property'].join(' > '),
          });
        if (node.block)
          walk(node.block.children, [
            ...where,
            `@${node.name} ${node.prelude}`,
          ]);
      } else if (node.type === 'Rule') {
        const selector = css
          .slice(node.prelude.start, node.prelude.end)
          .replace(/\s+/g, ' ')
          .trim();
        walk(node.block.children, [...where, selector]);
      } else if (
        node.property.startsWith('--space-') ||
        UNIT.includes(node.property)
      ) {
        found.push({
          name: node.property,
          formula: node.value
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .trim(),
          where: where.join(' > '),
        });
      }
    }
  };
  walk(parseCss(css).children, []);
  return found;
}

describe('spacing scale', () => {
  test.each(
    Object.entries(SCALE_BLOCK) as [keyof typeof SCALE_BLOCK, string][]
  )('%s declares every rung once, in its one scale block', (file, block) => {
    const all = scale(file);
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((r) => r.where !== block)).toEqual([]);
    const names = all.map((r) => r.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  test('the org scope derives its own unit from the org’s density', () => {
    const formula = (file: keyof typeof SCALE_BLOCK, name: string) =>
      scale(file).find((r) => r.name === name)?.formula;
    expect(formula('spacing.css', '--space-unit')).toBe(
      'calc(0.25rem * var(--brand-density-scale, 1))'
    );
    // At :root the scale is the default; a value there would rescale every
    // platform route.
    expect(formula('spacing.css', '--brand-density-scale')).toBeUndefined();
    // The density itself is the org layout's input, set only when the org
    // has one: declared in either sheet, it would stand in for every org
    // without one, or reset the org's own.
    for (const file of Object.keys(SCALE_BLOCK) as (keyof typeof SCALE_BLOCK)[])
      expect(scale(file).filter((r) => r.name === '--brand-density')).toEqual(
        []
      );
    expect(formula('org-brand.css', '--brand-density-scale')).toBe(
      'var(--brand-density, 1)'
    );
    expect(formula('org-brand.css', '--space-unit')).toBe(
      'calc(0.25rem * var(--brand-density-scale))'
    );
  });

  test('the org scope re-declares every :root rung, formula for formula', () => {
    const rungs = (file: keyof typeof SCALE_BLOCK) =>
      new Map(
        scale(file)
          .filter((r) => !UNIT.includes(r.name))
          .map((r) => [r.name, r.formula])
      );
    const root = rungs('spacing.css');
    const org = rungs('org-brand.css');
    // Zero needs no density, so it needs no twin; where declared it is 0px.
    expect(root.get('--space-0')).toBe('0px');
    for (const sheet of [root, org]) {
      expect(sheet.get('--space-0') ?? '0px').toBe('0px');
      sheet.delete('--space-0');
    }
    expect([...root].filter(([name, f]) => f !== formulaFor(name))).toEqual([]);
    expect(Object.fromEntries(org)).toEqual(Object.fromEntries(root));
  });
});
