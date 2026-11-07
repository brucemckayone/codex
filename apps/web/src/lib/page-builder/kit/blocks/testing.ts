/**
 * Reads a block component's style block, or a kit sheet, for the source
 * tests: each rule with its declarations and the at-rules it sits in, through
 * svelte's own parser (which drops the comments). Imported by tests only.
 */
import { readFileSync } from 'node:fs';
import { parse, parseCss } from 'svelte/compiler';

type CssNode = {
  type: string;
  name?: string;
  prelude?: { start: number; end: number } | string;
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

export type CssRule = {
  /** As written, spaces squashed. */
  selector: string;
  decls: Map<string, string>;
  /** The at-rules it sits in, outermost first: `@container (min-width: 44rem)`. */
  within: string[];
  /** For a nested rule, the selectors of the rules around it, outermost first. */
  parents: string[];
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * A component's rules. `nested` also reads rules nested inside rules (`&:hover`),
 * each with the selectors around it in `parents`.
 */
export function componentRules(
  path: string,
  { nested = false }: { nested?: boolean } = {}
): CssRule[] {
  const source = readFileSync(path, 'utf8');
  return rulesOf(source, parse(source, { modern: true }).css?.children, nested);
}

/** The same, for a plain `.css` sheet (a Style's, or the kit's own). */
export function sheetRules(path: string): CssRule[] {
  const source = readFileSync(path, 'utf8');
  return rulesOf(source, parseCss(source).children);
}

function rulesOf(
  source: string,
  children: unknown[] | undefined,
  nested = false
): CssRule[] {
  const rules: CssRule[] = [];
  const visit = (children: CssNode[], within: string[], parents: string[]) => {
    for (const node of children) {
      if (node.type === 'Atrule') {
        visit(
          node.block?.children ?? [],
          [...within, `@${node.name} ${squash(String(node.prelude))}`],
          parents
        );
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const selector = squash(
          source.slice(node.prelude.start, node.prelude.end)
        );
        const decls = new Map<string, string>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', squash(d.value ?? ''));
        rules.push({ selector, decls, within, parents });
        if (nested)
          visit(node.block?.children ?? [], within, [...parents, selector]);
      }
    }
  };
  visit((children ?? []) as CssNode[], [], []);
  return rules;
}
