// @vitest-environment node
/**
 * What the transformation's layouts draw that jsdom cannot (03 X55).
 *
 *   1. The toggle's switch is for a phone-width section only, and "phone
 *      width" is the columns' own breakpoint: the flag the toggle reads
 *      (`--_phone`) is set under exactly the complement of the query that sets
 *      the columns side by side, so the two can never drift apart.
 *   2. Side by side, the after lines are the loudest thing in the section:
 *      the display face at title size, over the before side's body lines.
 *
 * A SOURCE test, the weaker instrument: it proves the rules, not the paint.
 * The paint is measured in a browser by `e2e/page-kit/type-rank.spec.ts`.
 * Read with svelte's own parser, which drops the style block's comments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type CssNode = {
  type: string;
  name?: string;
  prelude?: { start: number; end: number } | string;
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

type Rule = { selector: string; decls: Map<string, string>; within: string[] };

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every rule in a component's style block, with the at-rules it sits in. */
function rulesOf(file: string): Rule[] {
  const source = readFileSync(join(import.meta.dirname, file), 'utf8');
  const css = parse(source, { modern: true }).css;
  const rules: Rule[] = [];
  const visit = (children: CssNode[], within: string[]) => {
    for (const node of children) {
      if (node.type === 'Atrule') {
        visit(node.block?.children ?? [], [
          ...within,
          `@${node.name} ${squash(String(node.prelude))}`,
        ]);
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const decls = new Map<string, string>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', squash(d.value ?? ''));
        rules.push({
          selector: squash(source.slice(node.prelude.start, node.prelude.end)),
          decls,
          within,
        });
      }
    }
  };
  visit((css?.children ?? []) as unknown as CssNode[], []);
  return rules;
}

const columns = rulesOf('ChangeColumns.svelte');
const toggle = rulesOf('ChangeToggle.svelte');

describe('the transformation layouts', () => {
  it('flags phone width under exactly the complement of the columns’ side-by-side query', () => {
    const sideBySide = columns.filter(
      (r) =>
        r.selector === '.tf-cols' &&
        r.decls.get('grid-template-columns')?.startsWith('repeat(2,')
    );
    expect(sideBySide).toHaveLength(1);
    const [query] = sideBySide[0].within;
    expect(query).toMatch(/^@container \(min-width: [\d.]+rem\)$/);

    const flags = toggle.filter((r) => r.decls.has('--_phone'));
    expect(flags).toHaveLength(1);
    expect(flags[0].selector).toBe('.tf-toggle');
    expect(flags[0].decls.get('--_phone')).toBe('1');
    expect(flags[0].within).toEqual([
      query.replace('@container (', '@container not ('),
    ]);
  });

  it('sets the after lines in the display face at title size, over body-size before lines', () => {
    const line = columns.find(
      (r) => r.selector === 'li' && r.within.length === 0
    );
    expect(line?.decls.get('font-size')).toBe('var(--lp-size-body)');
    const after = columns.filter(
      (r) => r.selector === ".tf-col[data-side='after'] li"
    );
    expect(after).toHaveLength(1);
    expect(after[0].within).toEqual([]);
    expect(after[0].decls.get('font-family')).toBe('var(--lp-font-display)');
    expect(after[0].decls.get('font-size')).toBe('var(--lp-size-title)');
    // No rule raises the before lines to the after's size.
    expect(
      columns.filter(
        (r) =>
          r.selector.includes("[data-side='before']") &&
          r.decls.has('font-size')
      )
    ).toEqual([]);
  });
});
