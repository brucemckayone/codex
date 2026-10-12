/**
 * The page-load bar draws in the org's brand colour on org pages (Codex-451j0).
 *
 * THE DEFECT. One bar, mounted by the ROOT layout, painting
 * `--color-interactive`. `org-brand.css` remaps that token to the brand colour,
 * but only on `[data-org-brand]` (`.org-layout`), and a custom property reaches
 * an element by INHERITANCE alone. The root bar is not a descendant of
 * `.org-layout`, so on every org page it drew the platform colour.
 *
 * THE FIX, and what is pinned here: the org layout mounts a second instance
 * INSIDE `.org-layout` (`placement="brand"`), and the root instance stands down
 * while one is mounted. So:
 *   1. a page with no brand scope still gets the root bar;
 *   2. an org page gets exactly ONE bar, and it is the one inside the carrier;
 *   3. an unbranded org still gets a visible bar, on the platform default;
 *   4. when the brand scope unmounts, the root bar takes over again;
 *   5. what the bar paints is a token `org-brand.css` remaps in BOTH themes —
 *      light to `--brand-color`, dark to `--brand-color-dark` FIRST.
 *
 * WHY ANCESTRY AND NOT A COMPUTED COLOUR. jsdom resolves no `var()`, so a
 * computed `background` would be empty here whatever the cascade did. Cases
 * 2-4 assert the thing inheritance actually keys on — the bar's ancestor chain
 * — and case 5 asserts the chain it inherits, rule by rule, from the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import NavigationProgress from './NavigationProgress.svelte';

// The bar shows while `navigating.to` is set. A getter, so each case can point
// it before mounting.
const { nav } = vi.hoisted(() => ({ nav: { to: null as unknown } }));
vi.mock('$app/state', () => ({
  navigating: {
    get to() {
      return nav.to;
    },
  },
}));

type Mounted = ReturnType<typeof mount>;
let mounted: Mounted[] = [];

function mountBar(placement: 'root' | 'brand', target: Element): Mounted {
  const component = mount(NavigationProgress, { target, props: { placement } });
  mounted.push(component);
  flushSync();
  return component;
}

/** A stand-in for `.org-layout`: the element that carries the brand remap. */
function orgLayout({ branded }: { branded: boolean }): HTMLElement {
  const el = document.createElement('div');
  el.className = 'org-layout';
  if (branded) el.setAttribute('data-org-brand', '');
  // `appendChild`, not `append`: workers-types shadows DOM `append` in web tsc.
  document.body.appendChild(el);
  return el;
}

const bars = () => [...document.querySelectorAll('[role="progressbar"]')];

beforeEach(() => {
  nav.to = { url: new URL('http://of-blood-and-bones.lvh.me:3000/explore') };
});

afterEach(() => {
  for (const component of mounted) unmount(component);
  mounted = [];
  flushSync();
  document.body.innerHTML = '';
});

describe('NavigationProgress: one bar, drawn inside the brand scope', () => {
  test('a page with no brand scope draws the root bar', () => {
    mountBar('root', document.body);

    expect(bars()).toHaveLength(1);
    expect(bars()[0].closest('[data-org-brand]')).toBeNull();
  });

  test('an org page draws exactly one bar, the one inside [data-org-brand]', () => {
    // Root first, as in the real tree: the root layout renders its bar BEFORE
    // `{@render children()}`, which is where the org layout mounts.
    mountBar('root', document.body);
    const carrier = orgLayout({ branded: true });
    mountBar('brand', carrier);

    // Two bars would stack the platform colour's glow under the brand's.
    expect(bars()).toHaveLength(1);
    expect(bars()[0].closest('[data-org-brand]')).toBe(carrier);
  });

  test('an unbranded org still draws a visible bar, on the platform default', () => {
    mountBar('root', document.body);
    const carrier = orgLayout({ branded: false });
    mountBar('brand', carrier);

    expect(bars()).toHaveLength(1);
    // Inside the org layout, but with no `[data-org-brand]` above it, so
    // `--color-interactive` is the `:root` default it always was.
    expect(carrier.contains(bars()[0])).toBe(true);
    expect(bars()[0].closest('[data-org-brand]')).toBeNull();
  });

  test('the root bar takes over when the brand scope unmounts mid-navigation', () => {
    mountBar('root', document.body);
    const brand = mountBar('brand', orgLayout({ branded: true }));
    expect(bars()).toHaveLength(1);

    // Leaving the org tree for an (auth) page on the same host unmounts the
    // org layout while the navigation is still in flight.
    unmount(brand);
    mounted = mounted.filter((c) => c !== brand);
    flushSync();

    expect(bars()).toHaveLength(1);
    expect(bars()[0].closest('.org-layout')).toBeNull();
  });

  test('draws nothing while no navigation is in flight', () => {
    nav.to = null;
    mountBar('root', document.body);
    mountBar('brand', orgLayout({ branded: true }));

    expect(bars()).toHaveLength(0);
  });
});

// ── 5. The colour source: what the bar paints, and what that token becomes ──

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

/** The bar's own top-level rules, read with svelte's parser (comments dropped). */
function componentRules(): Map<string, Map<string, string>> {
  const source = readFileSync(
    join(import.meta.dirname, 'NavigationProgress.svelte'),
    'utf8'
  );
  const rules = new Map<string, Map<string, string>>();
  for (const node of (parse(source, { modern: true }).css?.children ??
    []) as unknown as CssNode[]) {
    if (node.type !== 'Rule' || typeof node.prelude !== 'object') continue;
    const decls = new Map<string, string>();
    for (const d of node.block?.children ?? [])
      if (d.type === 'Declaration')
        decls.set(d.property ?? '', squash(d.value ?? ''));
    rules.set(
      squash(source.slice(node.prelude.start, node.prelude.end)),
      decls
    );
  }
  return rules;
}

/**
 * org-brand.css's top-level rules as `{ selectors, body }`, comments stripped
 * FIRST so a commented-out declaration can satisfy nothing. Rules inside an
 * at-rule are skipped: the remap this file depends on is unconditional.
 */
function orgBrandRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(
    join(import.meta.dirname, '../../../../styles/tokens/org-brand.css'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selectors: string[]; body: string }[] = [];
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] !== '{') {
      prelude += css[i];
      continue;
    }
    let depth = 1;
    let j = i + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
    }
    const head = squash(prelude);
    if (!head.startsWith('@'))
      rules.push({
        selectors: head.split(',').map((s) => s.trim()),
        body: css.slice(i + 1, j - 1),
      });
    prelude = '';
    i = j - 1;
  }
  return rules;
}

/**
 * The value `token` is given by the org-brand.css rules that list `selector` —
 * the LAST such declaration, since that is the one the cascade keeps.
 */
function remapOf(token: string, selector: string): string | undefined {
  const declaration = new RegExp(`(?:^|[;\\s])${token}\\s*:([^;]+);`);
  return orgBrandRules()
    .filter((r) => r.selectors.includes(selector))
    .map((r) => r.body.match(declaration)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(squash)
    .at(-1);
}

describe('NavigationProgress: paints tokens the brand remaps in both themes', () => {
  const bar = componentRules().get('.bar');
  /** Every custom property the bar's fill and glow read. */
  const painted = [
    ...`${bar?.get('background')} ${bar?.get('box-shadow')}`.matchAll(
      /var\((--[\w-]+)/g
    ),
  ].map((m) => m[1]);

  test('the bar paints its fill and glow from tokens, not literals', () => {
    // Guards the guard: an empty list would make the remap checks vacuous.
    expect(painted).toEqual(['--color-interactive', '--color-focus']);
  });

  test.each([
    '--color-interactive',
    '--color-focus',
  ])('light: [data-org-brand] remaps %s to --brand-color', (token) => {
    expect(painted).toContain(token);
    expect(remapOf(token, '[data-org-brand]')).toMatch(
      /^var\(--brand-color, var\(--color-primary-\d+\)\)$/
    );
  });

  test.each([
    '--color-interactive',
    '--color-focus',
  ])('dark: [data-theme=dark] [data-org-brand] remaps %s to --brand-color-dark first', (token) => {
    expect(painted).toContain(token);
    // The dark slot first, the light brand next, a dark platform step last:
    // the same chain every other branded control in dark mode reads.
    expect(remapOf(token, "[data-theme='dark'] [data-org-brand]")).toMatch(
      /^var\(--brand-color-dark, var\(--brand-color, var\(--color-primary-\d+\)\)\)$/
    );
  });
});
