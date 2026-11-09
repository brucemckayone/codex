// @vitest-environment node
/**
 * The org layout copies its background onto <html> so the scrollbar's
 * gutter matches the page. A dialog's scroll lock keeps that gutter, and
 * Chromium paints it with <html>'s background. A copy taken only when the
 * layout's own state changed went stale under every writer that changes
 * the background through the DOM instead: a theme toggle (Codex-vlphc
 * review G4-U5), the brand editor's preview theme (G5-C-L2), and
 * PreviewFrame stamping the preview's theme onto a framed page's <html>,
 * where no state changes at all (review c6, Codex-q6qjb).
 * `followLayoutBackground` watches those attributes itself; its own tests
 * are in lib/utils/root-background.test.ts.
 *
 * A SOURCE test, the weaker instrument (this layout has no render harness):
 * one $effect hands .org-layout to followLayoutBackground and re-runs on
 * the brand and the editor's pending colour, and nothing else in the layout
 * writes <html>'s background. Read with svelte's own parser, so a
 * commented-out call is not a call.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type Node = { type?: string; [key: string]: unknown };

const LAYOUT = join(import.meta.dirname, '..', '+layout.svelte');

/** Every node under `node`, depth first. */
function* walk(node: unknown): Generator<Node> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  const n = node as Node;
  if (typeof n.type === 'string') yield n;
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'parent') yield* walk(value);
  }
}

/** `a.b.c` for a member chain, else ''. */
function chain(node: Node | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier') return String(node.name);
  if (node.type === 'MemberExpression' && !node.computed) {
    const object = chain(node.object as Node);
    const property = chain(node.property as Node);
    return object && property ? `${object}.${property}` : '';
  }
  return '';
}

describe("the org layout's <html> background", () => {
  const ast = parse(readFileSync(LAYOUT, 'utf8'), { modern: true });
  const nodes = [...walk(ast.instance?.content)];
  const effects = nodes.filter(
    (n) => n.type === 'CallExpression' && chain(n.callee as Node) === '$effect'
  );
  const followers = effects.filter((effect) =>
    [...walk(effect)].some(
      (n) =>
        n.type === 'CallExpression' &&
        chain(n.callee as Node) === 'followLayoutBackground'
    )
  );

  it('is followed by one $effect, through followLayoutBackground', () => {
    expect(followers).toHaveLength(1);
  });

  const reads = (member: string) =>
    [...walk(followers[0])].some(
      (n) =>
        (n.type === 'MemberExpression' || n.type === 'Identifier') &&
        chain(n) === member
    );

  it("re-runs on the brand and on the editor's pending colour", () => {
    expect(reads('brandBackground')).toBe(true);
    expect(reads('brandEditor.pending.backgroundColor')).toBe(true);
  });

  // A write is an assignment to <html>'s style or to one of its properties
  // (`.x` or `['x']`), or a setProperty or removeProperty call on it,
  // through document.documentElement or a local name for it or its style
  // (review fu-focus-2).
  it('has no other writer in the layout', () => {
    const html = new Set(['document.documentElement']);
    const style = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const name of html) style.add(`${name}.style`);
      for (const n of nodes) {
        if (n.type !== 'VariableDeclarator') continue;
        const id = n.id as Node;
        const init = chain(n.init as Node);
        if (id.type !== 'Identifier' || !init) continue;
        const into = html.has(init) ? html : style.has(init) ? style : null;
        if (into && !into.has(String(id.name))) {
          into.add(String(id.name));
          grew = true;
        }
      }
    }
    const onStyle = (node: Node | undefined) =>
      style.has(chain(node)) ||
      (node?.type === 'MemberExpression' &&
        style.has(chain(node.object as Node)));
    const writes = nodes.filter((n) => {
      if (n.type === 'AssignmentExpression') return onStyle(n.left as Node);
      if (n.type !== 'CallExpression') return false;
      const callee = n.callee as Node;
      return (
        callee.type === 'MemberExpression' &&
        ['setProperty', 'removeProperty'].includes(
          chain(callee.property as Node)
        ) &&
        style.has(chain(callee.object as Node))
      );
    });
    expect(writes).toEqual([]);
  });
});
