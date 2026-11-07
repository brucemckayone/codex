import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';
import {
  type CssRule,
  componentRules,
} from '$lib/page-builder/kit/blocks/testing';

/**
 * The org home hero logo keeps its own shape, and the logo-hero layout sizes
 * it as one centred column (Codex-1g5lh.6).
 *
 * The logo is sized by height (`--_logo-base` × the Scale dial) and the
 * reset caps its width at 100%, so a wide logo at a high Scale got a box
 * narrower than its proportions and was stretched into it: in logo-hero on a
 * phone a 3:1 logo drew at 1.4:1 at Scale 2. logo-hero's base read an
 * undefined `--space-48`, so on desktop it was a fixed 26px, and once
 * defined, Scale 4 made it 768px tall, off the first screen. Measured in a
 * browser at 1440×900 and 390×844; this pins the CSS that measurement
 * depends on.
 *
 * Which rules reach the logo and the title is decided by real selector
 * matching, not by reading selector text: the page's markup is built into a
 * static DOM (every branch, every conditional class) inside the org layout's
 * `[data-hero-layout]` wrapper, and each rule's selector, `:global()`
 * unwrapped and hover/focus states dropped, is matched against the image and
 * the title. Any rule that can reach the image may set its size and shape
 * only to the dial's height, `width: auto`, `object-fit: contain` and the one
 * cap; paint (filters, radius, transitions) is free. A rule that needs an
 * ancestor this page never renders (beyond that wrapper) cannot be placed,
 * so it is not checked.
 */

const PAGE = join(import.meta.dirname, '..', '+page.svelte');
const source = readFileSync(PAGE, 'utf8');
const rules = componentRules(PAGE, { nested: true });

const HEIGHT = 'calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1))';
const LOGO_HERO_RULE = ':global([data-hero-layout="logo-hero"]) .hero__logo';
/** The properties that can size, stretch or move the image's box. */
const SHAPE =
  /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|object-fit|transform|scale|zoom|inset|top|right|bottom|left|flex(?:-basis|-grow|-shrink)?|(?:align|justify|place)-self)$/;
const MATCHABLE_AT = /^@(?:media|container|supports|layer) /;

/** A selector list's members, split on top-level commas only. */
function members(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += char;
  }
  return [...out, current.trim()];
}

/** A nested selector inside its parent: `&` is the parent, or it descends. */
const nest = (outer: string, inner: string) =>
  inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`;

/**
 * The selectors a rule matches with, as a browser reads them: parents
 * resolved, `:global(x)` as plain `x` (what Svelte compiles it to), and
 * hover/focus states dropped so a rule for a moment counts too.
 */
function selectorsOf(rule: CssRule): string[] {
  const [first, ...rest] = [...rule.parents, rule.selector];
  let full = members(first);
  for (const list of rest)
    full = full.flatMap((outer) => members(list).map((i) => nest(outer, i)));
  return full.map((selector) => {
    let out = '';
    for (let i = 0; i < selector.length; i++) {
      if (!selector.startsWith(':global(', i)) {
        out += selector[i];
        continue;
      }
      let depth = 1;
      let end = i + ':global('.length;
      while (depth > 0 && end < selector.length) {
        if (selector[end] === '(') depth++;
        if (selector[end] === ')') depth--;
        end++;
      }
      out += selector.slice(i + ':global('.length, end - 1);
      i = end - 1;
    }
    return (
      out
        .replace(/:global(?!\()/g, '')
        .replace(/:(?:hover|focus|focus-visible|focus-within|active)\b/g, '')
        .trim() || '*'
    );
  });
}

/** Every string literal in an expression: the classes a class={…} can add. */
function literals(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  if (Array.isArray(node)) return node.flatMap(literals);
  const own =
    'type' in node &&
    node.type === 'Literal' &&
    'value' in node &&
    typeof node.value === 'string'
      ? node.value.split(/\s+/)
      : [];
  return [...own, ...Object.values(node).flatMap(literals)];
}

/** The page's markup as a static DOM: every branch, every conditional class. */
function build(nodes: ReadonlyArray<unknown>, parent: Element): void {
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || !('type' in node))
      continue;
    if (node.type === 'RegularElement') {
      const el = node as AST.RegularElement;
      const dom = parent.appendChild(document.createElement(el.name));
      for (const a of el.attributes) {
        if (a.type === 'ClassDirective') dom.classList.add(a.name);
        if (a.type === 'StyleDirective')
          dom.setAttribute(
            'style',
            `${dom.getAttribute('style') ?? ''}${a.name}: 0;`
          );
        if (a.type !== 'Attribute') continue;
        const parts = Array.isArray(a.value) ? a.value : [a.value];
        const text = parts
          .map((p) =>
            typeof p === 'object' && p.type === 'Text' ? p.data : ''
          )
          .join('');
        if (a.name === 'class') {
          for (const c of [...text.split(/\s+/), ...literals(parts)])
            if (/^[\w-]+$/.test(c)) dom.classList.add(c);
        } else if (/^[\w-]+$/.test(a.name)) dom.setAttribute(a.name, text);
      }
      build(el.fragment.nodes, dom);
      continue;
    }
    // Blocks and components: their branches render into the same parent.
    for (const [key, child] of Object.entries(node))
      if (
        key !== 'metadata' &&
        typeof child === 'object' &&
        child !== null &&
        'type' in child &&
        child.type === 'Fragment' &&
        'nodes' in child &&
        Array.isArray(child.nodes)
      )
        build(child.nodes, parent);
  }
}

const layout = document.createElement('div');
layout.className = 'org-layout';
build(parse(source, { modern: true }).fragment.nodes, layout);
const logo = layout.querySelector('img.hero__logo');
const title = layout.querySelector('.hero__title');

/** Every layout the page styles, and none. */
const LAYOUTS = [
  null,
  ...new Set(
    [...source.matchAll(/data-hero-layout=["']([\w-]+)["']/g)].map((m) => m[1])
  ),
];

/** The rules that can reach `el` in any of `layouts`. */
function reaching(el: Element | null, layouts: (string | null)[]): CssRule[] {
  if (!el) return [];
  return rules.filter((rule) => {
    if (rule.within.some((at) => at.startsWith('@keyframes'))) return false;
    return layouts.some((value) => {
      if (value === null) layout.removeAttribute('data-hero-layout');
      else layout.setAttribute('data-hero-layout', value);
      return selectorsOf(rule).some((s) => el.matches(s));
    });
  });
}

const where = (r: CssRule) => [...r.within, ...r.parents, r.selector].join(' ');
const logoRules = reaching(logo, LAYOUTS);

describe('the hero logo', () => {
  test('the static page has the image, the title and the logo-hero layout', () => {
    expect(logo).not.toBeNull();
    expect(title).not.toBeNull();
    expect(LAYOUTS).toContain('logo-hero');
    expect(logoRules.length).toBeGreaterThan(2);
  });

  test('every rule that can reach it sits in an at-rule a browser applies', () => {
    expect(
      logoRules.flatMap((r) => r.within.filter((at) => !MATCHABLE_AT.test(at)))
    ).toEqual([]);
  });

  test('every rule that can reach the image sizes it by the dial, at its own shape', () => {
    const allowed = new Map<string, string | null>([
      ['height', HEIGHT],
      ['width', 'auto'],
      ['object-fit', 'contain'],
      ['max-height', '45svh'],
    ]);
    const stray = logoRules.flatMap((r) =>
      [...r.decls]
        .filter(([property]) => SHAPE.test(property))
        .flatMap(([property, value]) =>
          allowed.get(property) === value
            ? []
            : [`${where(r)} { ${property}: ${value} }`]
        )
    );
    expect(stray).toEqual([]);
    const base = logoRules.filter((r) => where(r) === '.hero__logo');
    expect(base).toHaveLength(1);
    expect(base[0].decls.get('height')).toBe(HEIGHT);
    expect(base[0].decls.get('object-fit')).toBe('contain');
  });

  test('takes its base from the spacing scale, 192px × density in logo-hero from md up', () => {
    const bases = Object.fromEntries(
      logoRules
        .filter((r) => r.decls.has('--_logo-base'))
        .map((r) => [where(r), r.decls.get('--_logo-base')])
    );
    expect(bases).toEqual({
      '.hero__logo': 'var(--space-14)',
      '@media (--below-sm) .hero__logo': 'var(--space-11)',
      [LOGO_HERO_RULE]: 'var(--space-48)',
      [`@media (--below-md) ${LOGO_HERO_RULE}`]: 'var(--space-32)',
    });
  });

  test('is capped once, in logo-hero, at 45% of the screen height', () => {
    const caps = logoRules
      .filter((r) => r.decls.has('max-height'))
      .map((r) => [where(r), r.decls.get('max-height')]);
    expect(caps).toEqual([[LOGO_HERO_RULE, '45svh']]);
  });

  test('carries no inline style that could outrank its rules', () => {
    // The builder writes a `style` attribute, and each `style:` directive,
    // onto the element.
    expect(logo?.getAttribute('style')).toBeNull();
  });

  test('in logo-hero sits under a centred title, whatever rule reaches it', () => {
    const aligns = reaching(title, ['logo-hero']).flatMap((r) =>
      ['text-align', 'text-align-last'].flatMap((p) =>
        r.decls.has(p) ? [`${p}: ${r.decls.get(p)}`] : []
      )
    );
    expect(aligns.length).toBeGreaterThan(0);
    expect(new Set(aligns)).toEqual(new Set(['text-align: center']));
  });
});
