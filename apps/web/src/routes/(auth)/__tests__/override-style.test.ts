/**
 * The sign-in shell's brand style is built by the org layout's own
 * `tokenOverrideStyle`, and by nothing else (Codex-403d3).
 *
 * This shell had its own copy of the org layout's join, `${prop}: ${value}`,
 * with no check, so an org admin's saved override reached every sign-in
 * page's `style` attribute as written. The mappers behind tokenOverrideStyle
 * now drop an entry that would leave its own declaration, so the shell is
 * covered exactly while it builds its style through them.
 *
 * A SOURCE test, the weaker instrument: the layouts have no render harness
 * (see `navigation-progress-brand-scope.test.ts`). It is read with svelte's
 * own parser, so a commented-out line is not code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type Node = {
  type: string;
  start: number;
  end: number;
  name?: string;
  id?: Node;
  init?: Node;
  callee?: Node;
};

const source = readFileSync(
  join(import.meta.dirname, '..', '+layout.svelte'),
  'utf8'
);
const ast = parse(source, { modern: true });

/** Every node of `type` under `root`, depth first. */
function nodesOf(root: unknown, type: string): Node[] {
  const found: Node[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if ((value as Node).type === type) found.push(value as Node);
    for (const child of Object.values(value)) visit(child);
  };
  visit(root);
  return found;
}

const textOf = (node: Node | undefined) =>
  node ? source.slice(node.start, node.end).replace(/\s+/g, '') : undefined;

describe('the (auth) layout brand style (Codex-403d3)', () => {
  it('binds style to overrideStyle, on one element', () => {
    const styles = nodesOf(ast.fragment, 'Attribute').filter(
      (attribute) => attribute.name === 'style'
    );
    expect(styles.map(textOf)).toEqual(['style={overrideStyle}']);
  });

  it('builds overrideStyle with tokenOverrideStyle alone', () => {
    const declarator = nodesOf(ast.instance, 'VariableDeclarator').find(
      (node) => node.id?.name === 'overrideStyle'
    );
    expect(textOf(declarator?.init)).toBe(
      '$derived(tokenOverrideStyle(parseOverrides(branding?.brandFineTune?.tokenOverrides),parseOverrides(branding?.brandFineTune?.darkTokenOverrides)))'
    );
  });

  it('never calls the mappers itself, where a hand-written join would start', () => {
    const called = nodesOf(ast.instance, 'CallExpression').map(
      (call) => call.callee?.name
    );
    expect(called).toContain('tokenOverrideStyle');
    expect(called).not.toContain('tokenOverridesToCssVars');
    expect(called).not.toContain('darkTokenOverridesToCssVars');
  });
});
