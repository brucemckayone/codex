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
 * each with the selectors around it in `parents`; an at-rule nested in a rule
 * contributes its own declarations as a rule `&`.
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
  /**
   * A block's declarations as the cascade keeps them: last wins, but not over
   * `!important`. Property names are case-insensitive, custom ones aside.
   */
  const declsOf = (block: CssNode[]) => {
    const decls = new Map<string, string>();
    const important = (value: string | undefined) =>
      /!\s*important$/i.test(value ?? '');
    for (const d of block) {
      if (d.type !== 'Declaration') continue;
      const written = d.property ?? '';
      const property = written.startsWith('--')
        ? written
        : written.toLowerCase();
      const value = squash(d.value ?? '');
      if (important(decls.get(property)) && !important(value)) continue;
      decls.set(property, value);
    }
    return decls;
  };
  const visit = (children: CssNode[], within: string[], parents: string[]) => {
    for (const node of children) {
      if (node.type === 'Atrule') {
        const at = [...within, `@${node.name} ${squash(String(node.prelude))}`];
        // Nested in a rule, an at-rule's own declarations belong to that rule.
        const decls = declsOf(node.block?.children ?? []);
        if (parents.length > 0 && decls.size > 0)
          rules.push({ selector: '&', decls, within: at, parents });
        visit(node.block?.children ?? [], at, parents);
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const selector = squash(
          source.slice(node.prelude.start, node.prelude.end)
        );
        const decls = declsOf(node.block?.children ?? []);
        rules.push({ selector, decls, within, parents });
        if (nested)
          visit(node.block?.children ?? [], within, [...parents, selector]);
      }
    }
  };
  visit((children ?? []) as CssNode[], [], []);
  return rules;
}
