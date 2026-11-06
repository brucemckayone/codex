// @vitest-environment node
/**
 * The org layout copies its background onto <html> so the scrollbar's
 * gutter matches the page. A dialog's scroll lock keeps that gutter, and
 * Chromium paints it with <html>'s background. The copy re-ran only when
 * the brand or the editor's pending colour changed, never on a theme
 * toggle, which flips `--color-background` under the same brand: the strip
 * beside every dialog showed the previous theme (Codex-vlphc review G4-U5).
 *
 * A SOURCE test, the weaker instrument (this layout has no render harness):
 * the effect that writes <html>'s background reads `themeState.theme`. The
 * paint was measured in Chromium with a classic scrollbar on a verbatim copy
 * of the effect: after a toggle to dark the strip stayed rgb(250, 250, 250)
 * without the read and turned rgb(23, 23, 23) with it. Read with svelte's own
 * parser, so a commented-out read is not a read.
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
  const effects = [...walk(ast.instance?.content)].filter(
    (n) => n.type === 'CallExpression' && chain(n.callee as Node) === '$effect'
  );
  const writer = effects.find((effect) =>
    [...walk(effect)].some(
      (n) =>
        n.type === 'AssignmentExpression' &&
        chain(n.left as Node) ===
          'document.documentElement.style.backgroundColor'
    )
  );

  it('is written by one $effect', () => {
    expect(writer).toBeDefined();
  });

  it('re-runs on a theme toggle: that effect reads themeState.theme', () => {
    const reads = [...walk(writer)].some(
      (n) => n.type === 'MemberExpression' && chain(n) === 'themeState.theme'
    );
    expect(reads).toBe(true);
  });
});
