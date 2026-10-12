// @vitest-environment node
/**
 * The org layout mounts the page-load bar INSIDE its brand scope (Codex-451j0).
 *
 * `NavigationProgress` paints `--color-interactive`, which `org-brand.css`
 * remaps to the org's brand colour only on `[data-org-brand]`. A custom
 * property reaches an element by inheritance alone, so the bar draws the brand
 * colour only if it is a DESCENDANT of the element that carries that attribute
 * — `.org-layout`. Before this fix the only bar was the root layout's, above
 * `.org-layout`, and it drew the platform colour on every org page.
 *
 * The component's half (one bar per document; the root bar stands down while a
 * brand bar is mounted) is pinned beside it, in
 * `NavigationProgress.svelte.test.ts`. This file pins the two call sites:
 *   · the org layout renders a `placement="brand"` bar as a DIRECT child of the
 *     `[data-org-brand]` carrier — not inside `.org-main`, whose
 *     `view-transition-name: page-content` would snapshot it, and not behind an
 *     `{#if}`, so the studio and every other org page get it;
 *   · the root layout renders the `placement="root"` fallback exactly once.
 *
 * A SOURCE test, the weaker instrument: this layout has no render harness (see
 * `atmosphere-shader-overscan.test.ts`). It is read with svelte's own parser,
 * so a commented-out bar is not a bar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type AstNode = {
  type?: string;
  name?: string;
  attributes?: AstNode[];
  value?: true | AstNode[] | AstNode;
  data?: string;
  fragment?: { nodes: AstNode[] };
};

const ROUTES = join(import.meta.dirname, '..', '..', '..');
const fragmentOf = (relative: string) =>
  parse(readFileSync(join(ROUTES, relative), 'utf8'), { modern: true })
    .fragment as unknown as { nodes: AstNode[] };

const orgFragment = fragmentOf('_org/[slug]/+layout.svelte');
const rootFragment = fragmentOf('+layout.svelte');

/** Every node in the tree, in any block, at any depth. */
function everyNode(root: unknown): AstNode[] {
  const found: AstNode[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode;
    if (typeof node.type === 'string') found.push(node);
    for (const child of Object.values(node)) visit(child);
  };
  visit(root);
  return found;
}

const attribute = (node: AstNode, name: string) =>
  node.attributes?.find((a) => a.type === 'Attribute' && a.name === name);

/** A static attribute's text, e.g. `class="org-layout"` → `org-layout`. */
const staticText = (node: AstNode, name: string): string | undefined => {
  const value = attribute(node, name)?.value;
  return Array.isArray(value) && value.every((v) => v.type === 'Text')
    ? value.map((v) => v.data).join('')
    : undefined;
};

const bars = (fragment: unknown) =>
  everyNode(fragment).filter(
    (n) => n.type === 'Component' && n.name === 'NavigationProgress'
  );

describe('the page-load bar is mounted inside the org brand scope', () => {
  const carrier = everyNode(orgFragment).find(
    (n) =>
      n.type === 'RegularElement' &&
      staticText(n, 'class')?.split(/\s+/).includes('org-layout')
  );

  it('finds the brand carrier, and it is the element with [data-org-brand]', () => {
    expect(carrier, '.org-layout').toBeDefined();
    // The attribute org-brand.css gates the remap on. If it moved off this
    // element, a bar placed here would no longer inherit the brand.
    expect(attribute(carrier!, 'data-org-brand')).toBeDefined();
  });

  it('renders a placement="brand" bar as a direct child of .org-layout', () => {
    const direct = carrier!.fragment!.nodes.filter(
      (n) => n.type === 'Component' && n.name === 'NavigationProgress'
    );
    expect(direct).toHaveLength(1);
    expect(staticText(direct[0], 'placement')).toBe('brand');
  });

  it('renders no other bar anywhere in the org layout', () => {
    // A second one (inside `.org-main`, or behind a branch) would be either a
    // duplicate or a bar the `page-content` view transition snapshots.
    expect(bars(orgFragment)).toHaveLength(1);
  });

  it('keeps the root layout bar as the placement="root" fallback, once', () => {
    const root = bars(rootFragment);
    expect(root).toHaveLength(1);
    expect(staticText(root[0], 'placement')).toBe('root');
  });
});
