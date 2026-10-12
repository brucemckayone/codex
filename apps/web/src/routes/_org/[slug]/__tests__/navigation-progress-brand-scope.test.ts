// @vitest-environment node
/**
 * Every org brand scope mounts the page-load bar INSIDE itself (Codex-451j0).
 *
 * `NavigationProgress` paints `--color-interactive`, which `org-brand.css`
 * remaps to the org's brand colour only on `[data-org-brand]`. A custom
 * property reaches an element by inheritance alone, so the bar draws the brand
 * colour only if it is a DESCENDANT of the element that carries that attribute.
 * Before this fix the only bar was the root layout's, above every route
 * group's chrome, and it drew the platform colour on every org page.
 *
 * The component's half (one bar per document; the root bar stands down while a
 * brand bar is mounted, and only the newest brand bar draws) is pinned beside
 * it, in `NavigationProgress.svelte.test.ts`. This file pins the call sites:
 *   · the org layout renders a `placement="brand"` bar as a DIRECT child of
 *     `.org-layout`, its `[data-org-brand]` carrier — not inside `.org-main`,
 *     whose `view-transition-name: page-content` would snapshot it, and not
 *     behind an `{#if}`, so the studio and every other org page get it;
 *   · the `(auth)` layout — login and sign-up are the org's own pages on its
 *     host — renders one as a direct child of `.auth-layout`, ITS carrier,
 *     behind `{#if branding}` and nothing else: the load sets `branding` only
 *     on an org host, and a platform host keeps the root bar. No `{:else}`: a
 *     second bar there would stack on the root one;
 *   · the root layout renders the `placement="root"` fallback exactly once.
 *
 * A SOURCE test, the weaker instrument: neither layout has a render harness
 * (see `atmosphere-shader-overscan.test.ts`). It is read with svelte's own
 * parser, so a commented-out bar is not a bar.
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
  test?: { start: number; end: number };
  consequent?: { nodes: AstNode[] };
  alternate?: { nodes: AstNode[] } | null;
};

const ROUTES = join(import.meta.dirname, '..', '..', '..');
const sourceOf = (relative: string) =>
  readFileSync(join(ROUTES, relative), 'utf8');
const fragmentOf = (source: string) =>
  parse(source, { modern: true }).fragment as unknown as { nodes: AstNode[] };

const orgFragment = fragmentOf(sourceOf('_org/[slug]/+layout.svelte'));
const authSource = sourceOf('(auth)/+layout.svelte');
const authFragment = fragmentOf(authSource);
const rootFragment = fragmentOf(sourceOf('+layout.svelte'));

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

const isBar = (n: AstNode) =>
  n.type === 'Component' && n.name === 'NavigationProgress';
const bars = (fragment: unknown) => everyNode(fragment).filter(isBar);

/** The first element whose static class list includes `className`. */
const carrierIn = (fragment: unknown, className: string) =>
  everyNode(fragment).find(
    (n) =>
      n.type === 'RegularElement' &&
      staticText(n, 'class')?.split(/\s+/).includes(className)
  );

describe('the page-load bar is mounted inside the org brand scope', () => {
  const carrier = carrierIn(orgFragment, 'org-layout');

  it('finds the brand carrier, and it is the element with [data-org-brand]', () => {
    expect(carrier, '.org-layout').toBeDefined();
    // The attribute org-brand.css gates the remap on. If it moved off this
    // element, a bar placed here would no longer inherit the brand.
    expect(attribute(carrier!, 'data-org-brand')).toBeDefined();
  });

  it('renders a placement="brand" bar as a direct child of .org-layout', () => {
    const direct = carrier!.fragment!.nodes.filter(isBar);
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

describe('login and sign-up on an org host hold the bar inside their brand scope', () => {
  const carrier = carrierIn(authFragment, 'auth-layout');
  /** The direct-child `{#if}` blocks of the carrier that hold a bar. */
  const gates = () =>
    (carrier?.fragment?.nodes ?? []).filter(
      (n) => n.type === 'IfBlock' && bars(n).length > 0
    );

  it('finds the brand carrier, and it is the element with [data-org-brand]', () => {
    expect(carrier, '.auth-layout').toBeDefined();
    expect(attribute(carrier!, 'data-org-brand')).toBeDefined();
  });

  it('renders a placement="brand" bar as a direct child of .auth-layout, behind {#if branding}', () => {
    expect(gates()).toHaveLength(1);
    const [gate] = gates();
    // `branding` is set by the (auth) load only on an org host.
    expect(authSource.slice(gate.test!.start, gate.test!.end)).toBe('branding');
    const direct = gate.consequent!.nodes.filter(isBar);
    expect(direct).toHaveLength(1);
    expect(staticText(direct[0], 'placement')).toBe('brand');
    // An `{:else}` bar on a platform host would stack on the root one.
    expect(gate.alternate ?? null).toBeNull();
  });

  it('renders no other bar anywhere in the (auth) layout', () => {
    expect(bars(authFragment)).toHaveLength(1);
  });
});
