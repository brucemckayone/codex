import { type AST, parse } from 'svelte/compiler';

/**
 * A component's stylesheet as Svelte's own compiler reads it, comments
 * dropped, for the source tests in this folder (hero-ink, hero-logo).
 */

type CssNode = AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration;

export interface CssRule {
  selector: string;
  /** The at-rules and parent rules around it, outermost first. */
  within: string[];
  decls: Map<string, string>;
}

export const declsOf = (children: ReadonlyArray<CssNode>) => {
  const decls = new Map<string, string>();
  for (const child of children)
    if (child.type === 'Declaration')
      decls.set(child.property, child.value.trim());
  return decls;
};

export function readStylesheet(source: string) {
  const css = parse(source, { modern: true }).css;
  if (!css) throw new Error('component has no <style> block');
  return css;
}

/** Every style rule in a component: nested ones, and those in @media / @keyframes. */
export function readRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (nodes: ReadonlyArray<CssNode>, within: string[]) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
        if (node.block)
          walk(node.block.children, [
            ...within,
            `@${node.name} ${node.prelude}`,
          ]);
      } else if (node.type === 'Rule') {
        const selector = source
          .slice(node.prelude.start, node.prelude.end)
          .replace(/\s+/g, ' ')
          .trim();
        rules.push({ selector, within, decls: declsOf(node.block.children) });
        walk(
          node.block.children.filter((c) => c.type !== 'Declaration'),
          [...within, selector]
        );
      }
    }
  };
  walk(readStylesheet(source).children, []);
  return rules;
}
