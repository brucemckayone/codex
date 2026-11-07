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
 * selector or in a media query would not be the declaration in force.
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

/** Every `--space-*` rung in a sheet but the unit itself, wherever it sits. */
function rungs(file: keyof typeof SCALE_BLOCK): Rung[] {
  const css = readFileSync(join(here, file), 'utf8');
  const found: Rung[] = [];
  const walk = (
    nodes: ReadonlyArray<AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration>,
    where: string[]
  ) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
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
        node.property.startsWith('--space-') &&
        node.property !== '--space-unit'
      ) {
        found.push({
          name: node.property,
          formula: node.value.trim(),
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
    const all = rungs(file);
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((r) => r.where !== block)).toEqual([]);
    const names = all.map((r) => r.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  test('the org scope re-declares every :root rung, formula for formula', () => {
    const root = new Map(rungs('spacing.css').map((r) => [r.name, r.formula]));
    const org = new Map(rungs('org-brand.css').map((r) => [r.name, r.formula]));
    // A rung not built on the unit cannot follow density, so only zero may be one.
    const constant = [...root].filter(([, f]) => !f.includes('--space-unit'));
    expect(constant).toEqual([['--space-0', '0px']]);
    root.delete('--space-0');
    expect(Object.fromEntries(org)).toEqual(Object.fromEntries(root));
  });
});
