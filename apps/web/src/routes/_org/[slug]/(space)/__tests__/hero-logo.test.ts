import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERO_LAYOUTS } from '@codex/validation';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';
import {
  type CssRule,
  componentRules,
  cssRules,
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
 * Which rules reach the logo is decided by real selector matching against
 * the document, not by reading selector text. The org layout's markup is
 * built into it as a static DOM, every branch and every conditional class at
 * once, with the page's markup at its `{@render children()}` and each
 * rendered snippet inlined where it renders. Each rule of the page and the
 * layout, `:global()` unwrapped, is matched under every hero layout, and
 * whatever a static DOM cannot decide counts as met: every pseudo-class but
 * `:is`, `:where` and `:root` (states, position, `:dir`, `:lang`, `:target`,
 * `:checked`, and `:has()`, since a component renders what it looks for), `:not()` unless it tests only the hero layout, `+`
 * adjacency, and every attribute but the hero layout (the layout's
 * `data-hero-hide-*` flags, `data-theme`). The check may over-match; it must
 * never under-match.
 *
 * A rule that can reach the image may set its size and shape only to the
 * dial's height, `width: auto`, `object-fit: contain` and the one cap, in
 * its own declarations and in the frames of any animation it runs (the
 * page's, the layout's or a global sheet's); paint (filters, radius,
 * transitions) is free. Nothing on the image or around it may redefine or
 * register what that height reads, or scale what it sits in, and nothing
 * between the image and the org layout (which carries the brand's inputs)
 * may set an inline style. Not modelled: the root layout's markup, global
 * sheets' rules (the reset's `img` rule among them), a pseudo-element (its
 * box is never the image's) and what a component renders; a rule that needs
 * one of them is not checked.
 */

const PAGE = join(import.meta.dirname, '..', '+page.svelte');
const LAYOUT = join(import.meta.dirname, '..', '..', '+layout.svelte');
// The layout's own rules reach the page through `.org-layout` and `.org-main`.
const rules = [
  ...componentRules(PAGE, { nested: true }),
  ...componentRules(LAYOUT, { nested: true }),
];

const HEIGHT = 'calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1))';
const LOGO_HERO_RULE = ':global([data-hero-layout="logo-hero"]) .hero__logo';
/** The properties that can size, stretch or move the image's box. */
const SHAPE =
  /^(?:-webkit-)?(?:all|(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|object-fit|transform|translate|rotate|scale|zoom|inset(?:-[a-z-]+)?|top|right|bottom|left|margin(?:-[a-z-]+)?|flex(?:-basis|-grow|-shrink)?|(?:align|justify|place)-self)$/;
/** What the image's height reads: the dial, the spacing scale, the density. */
const DIAL_INPUTS =
  /^--(?:brand-hero-logo-scale|space-[\w-]+|brand-density(?:-scale)?)$/;
/** What scales an element and everything drawn inside it. */
const SCALES = /^(?:-webkit-)?(?:scale|zoom|transform|translate)$/;
const KEYFRAMES_AT = /^@(?:-webkit-)?keyframes (?:-global-)?(.+)$/;
/** The animation shorthand's words that are not a keyframes name. */
const ANIMATION_WORDS = new Set([
  'none',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'infinite',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'initial',
  'inherit',
  'unset',
  'revert',
]);
const MATCHABLE_AT =
  /^@(?:media|container|supports|layer|starting-style)(?: |$)/;
/**
 * The pseudo-classes a static DOM decides: every other one counts as met.
 * `:has()` is not among them: a component renders descendants this DOM
 * never holds.
 */
const DECIDED = new Set(['is', 'where', 'root']);
/** Pseudo-elements, the single-colon spellings too: a box of their own. */
const PSEUDO_ELEMENT = /::|:(?:before|after|first-line|first-letter)(?![\w-])/i;
const LAYOUT_ATTRIBUTE = /\[\s*data-hero-layout(?![\w-])[^\]]*\]/g;

/** A selector list's members, split on top-level commas only, quotes skipped. */
function members(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of list) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  return [...out, current.trim()];
}

/** A nested selector inside its parent: `&` is `:is(parent)`, or it descends. */
const nest = (outer: string, inner: string) =>
  inner.includes('&')
    ? inner.replaceAll('&', `:is(${outer})`)
    : `${outer} ${inner}`;

/** The index just past the `)` that closes the `(` at `open`, quotes skipped. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, i + 1);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0) return i + 1;
  }
  throw new Error(`unbalanced parentheses in "${text}"`);
}

/** Each `:name(…)` in a selector, replaced by what `swap` makes of its argument. */
function swapCalls(
  selector: string,
  name: string,
  swap: (argument: string) => string
): string {
  const head = `:${name}(`;
  let out = '';
  let i = 0;
  while (i < selector.length) {
    if (!selector.startsWith(head, i)) {
      out += selector[i];
      i++;
      continue;
    }
    const end = closing(selector, i + head.length - 1);
    out += swap(selector.slice(i + head.length, end - 1));
    i = end;
  }
  return out;
}

/** A value with every parenthesised argument, however nested, as `#`. */
function flatten(value: string): string {
  let flat = value;
  for (let last = ''; last !== flat; ) {
    last = flat;
    flat = flat.replace(/\([^()]*\)/g, '#');
  }
  return flat;
}

/**
 * A value that leaves an element's scale alone: a move in the plane (the
 * hero's entrances). A move in depth draws larger under a `perspective`.
 */
function unscaled(property: string, value: string): boolean {
  const flat = flatten(value).trim();
  if (property === 'translate') return flat.split(/\s+/).length <= 2;
  return /^(?:1|none|(?:translate[xy]?#\s*)+)$/i.test(flat);
}

const MET = ':is(*)';
const testsOnlyTheLayout = (argument: string) =>
  argument.replace(LAYOUT_ATTRIBUTE, '').replace(/[\s,]/g, '') === '';

/**
 * A selector as it can match the static DOM: `:global()` unwrapped (what
 * Svelte compiles it to), and every condition that DOM cannot decide met.
 */
function undecided(selector: string): string {
  let out = swapCalls(selector, 'global', (inner) => inner)
    .replace(/:global(?!\()/g, '')
    .trim();
  out = swapCalls(out, 'not', (inner) =>
    testsOnlyTheLayout(inner) ? `:not(${inner})` : MET
  ).replace(/\[[^\]]*\]/g, (attribute) =>
    /^\[\s*data-hero-layout(?![\w-])/.test(attribute) ? attribute : MET
  );
  // States, position, direction, language, targets, form states: none of
  // them is in the markup.
  const called = new Set(
    [...out.matchAll(/:([a-z-]+)\(/gi)].map((match) => match[1])
  );
  for (const name of called)
    if (name !== 'not' && !DECIDED.has(name.toLowerCase()))
      out = swapCalls(out, name, () => MET);
  return (
    out
      .replace(/:([a-z-]+)(?![\w(-])/gi, (pseudo, name: string) =>
        DECIDED.has(name.toLowerCase()) ? pseudo : MET
      )
      .replace(/\s*\+\s*/g, ' ~ ')
      .trim() || '*'
  );
}

/**
 * The selectors a rule matches with: parents resolved, and each read by
 * `undecided`. A pseudo-element styles a box of its own, never the image's.
 */
function selectorsOf(rule: CssRule): string[] {
  const [first, ...rest] = [...rule.parents, rule.selector];
  let full = members(first);
  for (const list of rest)
    full = full.flatMap((outer) => members(list).map((i) => nest(outer, i)));
  return full.filter((s) => !PSEUDO_ELEMENT.test(s)).map(undecided);
}

type Loose = {
  type?: unknown;
  value?: unknown;
  computed?: unknown;
  key?: { type?: unknown; name?: unknown } | null;
};

/** The classes one expression node can add: a string, a template's text, an object key. */
function classesIn(node: Loose): string[] {
  const words = (text: unknown) =>
    typeof text === 'string' ? text.split(/\s+/) : [];
  if (node.type === 'Literal') return words(node.value);
  if (
    node.type === 'TemplateElement' &&
    typeof node.value === 'object' &&
    node.value !== null &&
    'cooked' in node.value
  )
    return words(node.value.cooked);
  if (
    node.type === 'Property' &&
    !node.computed &&
    node.key?.type === 'Identifier'
  )
    return words(node.key.name);
  return [];
}

/** Every class a class={…} can add. */
function literals(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  if (Array.isArray(node)) return node.flatMap(literals);
  return [...classesIn(node), ...Object.values(node).flatMap(literals)];
}

/** The snippets a file renders with `{@render name()}`, by name. */
function renderedSnippets(
  fragment: AST.Fragment
): Map<string, ReadonlyArray<unknown>> {
  const bodies = new Map<string, ReadonlyArray<unknown>>();
  const rendered = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if ('type' in node && node.type === 'SnippetBlock') {
      const block = node as AST.SnippetBlock;
      bodies.set(block.expression.name, block.body.nodes);
    }
    if ('type' in node && node.type === 'RenderTag') {
      const name = calleeOf(node as AST.RenderTag);
      if (name) rendered.add(name);
    }
    for (const [key, value] of Object.entries(node))
      if (key !== 'metadata') walk(value);
  };
  walk(fragment.nodes);
  return new Map([...bodies].filter(([name]) => rendered.has(name)));
}

/** The snippet a `{@render}` calls, when it names one. */
function calleeOf(tag: AST.RenderTag): string | null {
  const call =
    tag.expression.type === 'ChainExpression'
      ? tag.expression.expression
      : tag.expression;
  return call.callee.type === 'Identifier' ? call.callee.name : null;
}

/**
 * Markup as a static DOM: every branch, every conditional class. A snippet in
 * `snippets` renders where `{@render}` places it, not where it is defined.
 */
function build(
  nodes: ReadonlyArray<unknown>,
  parent: Element,
  snippets: ReadonlyMap<string, ReadonlyArray<unknown>>
): void {
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || !('type' in node))
      continue;
    if (node.type === 'SnippetBlock') {
      const block = node as AST.SnippetBlock;
      if (snippets.has(block.expression.name)) continue;
    }
    if (node.type === 'RenderTag') {
      const name = calleeOf(node as AST.RenderTag);
      const body = name ? snippets.get(name) : undefined;
      if (!name || !body) continue;
      // Without itself, so a snippet that renders itself stops.
      const rest = new Map(snippets);
      rest.delete(name);
      build(body, parent, rest);
      continue;
    }
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
        } else if (a.name === 'style')
          dom.setAttribute(
            'style',
            `${dom.getAttribute('style') ?? ''}${text}`
          );
        else if (/^[\w-]+$/.test(a.name)) dom.setAttribute(a.name, text);
      }
      build(el.fragment.nodes, dom, snippets);
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
        build(child.nodes, parent, snippets);
  }
}

const markup = (path: string) =>
  parse(readFileSync(path, 'utf8'), { modern: true }).fragment;
const page = markup(PAGE);
const layout = markup(LAYOUT);
build(
  layout.nodes,
  document.body,
  new Map([
    ...renderedSnippets(layout),
    ...renderedSnippets(page),
    ['children', page.nodes],
  ])
);
const wrapper = document.querySelector('.org-layout');
const logo = document.querySelector('img.hero__logo');
const title = document.querySelector('.hero__title');

const where = (r: CssRule) => [...r.within, ...r.parents, r.selector].join(' ');

function matches(el: Element, selector: string, rule: CssRule): boolean {
  try {
    return el.matches(selector);
  } catch (error) {
    throw new Error(`${where(rule)}: cannot match "${selector}"`, {
      cause: error,
    });
  }
}

/** Every stylesheet under `$lib`: global, so its keyframes run anywhere. */
const SHEETS = import.meta.glob<string>('$lib/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const keyframes = new Map<string, CssRule[]>();
for (const rule of [...rules, ...Object.values(SHEETS).flatMap(cssRules)])
  for (const at of rule.within) {
    const name = KEYFRAMES_AT.exec(at)?.[1];
    if (name) keyframes.set(name, [...(keyframes.get(name) ?? []), rule]);
  }

const candidates = rules
  .filter((rule) => !rule.within.some((at) => KEYFRAMES_AT.test(at)))
  .map((rule) => ({ rule, selectors: selectorsOf(rule) }));

/** The rules that can reach `el` under any of `layouts`. */
function reaching(
  el: Element | null,
  layouts: ReadonlyArray<string>
): CssRule[] {
  if (!el || !wrapper) return [];
  return candidates
    .filter(({ rule, selectors }) =>
      layouts.some((value) => {
        wrapper.setAttribute('data-hero-layout', value);
        return selectors.some((s) => matches(el, s, rule));
      })
    )
    .map(({ rule }) => rule);
}

/**
 * The frames of the `@keyframes` a rule's animations run, in this page, the
 * layout or a global sheet. A name it cannot find, or one held in `var()`,
 * fails rather than counting as no frames; a shorthand's other `var()`s are
 * its timings.
 */
function framesOf(rule: CssRule): CssRule[] {
  const names = [
    'animation',
    'animation-name',
    '-webkit-animation',
    '-webkit-animation-name',
  ].flatMap((property) =>
    flatten(rule.decls.get(property) ?? '')
      .split(',')
      .flatMap((layer) => {
        const words = layer
          .trim()
          .split(/\s+/)
          .filter(
            (word) =>
              word !== '' &&
              !ANIMATION_WORDS.has(word.toLowerCase()) &&
              !/^[-+]?[\d.]/.test(word) &&
              !/^(?:cubic-bezier|steps|linear)#$/i.test(word)
          );
        const named = words.filter((word) => !/^var#$/i.test(word));
        if (words.length > 0 && named.length === 0)
          throw new Error(`${where(rule)} names its frames in var(): ${layer}`);
        return named;
      })
  );
  return names.flatMap((name) => {
    const frames = keyframes.get(name);
    if (!frames)
      throw new Error(
        `${where(rule)} runs frames this test cannot read: ${name}`
      );
    return frames;
  });
}

const logoRules = reaching(logo, HERO_LAYOUTS);
const around: Element[] = [];
for (let el = logo?.parentElement; el; el = el.parentElement) around.push(el);

describe('the hero logo', () => {
  test('the page renders inside the org layout, with the image and the title', () => {
    expect(logo).not.toBeNull();
    expect(logo?.closest('.org-layout .org-main')).not.toBeNull();
    expect(title).not.toBeNull();
    expect(HERO_LAYOUTS).toContain('logo-hero');
    expect(logoRules.length).toBeGreaterThan(2);
  });

  test('a condition the static page cannot decide counts as met', () => {
    expect(
      undecided(
        ':global([data-theme="dark"]) .a:not(.b):hover + .c:nth-child(2n + 1):focus-visible'
      )
    ).toBe(':is(*) .a:is(*):is(*) ~ .c:is(*):is(*)');
    expect(
      undecided(':global(:not([data-hero-layout="split"])) .hero__title')
    ).toBe(':not([data-hero-layout="split"]) .hero__title');
    expect(
      undecided(':root:lang(ar) .a:dir(rtl):target:scope:enabled:has(:checked)')
    ).toBe(':root:is(*) .a:is(*):is(*):is(*):is(*):is(*)');
    expect(undecided('.a:not([data-x="("]) .b')).toBe('.a:is(*) .b');
    expect(unscaled('transform', 'translateY(calc(-1 * var(--space-1)))')).toBe(
      true
    );
    expect(unscaled('transform', 'translateZ(50px)')).toBe(false);
    expect(unscaled('translate', '0 0 50px')).toBe(false);
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
    const stray = [...logoRules, ...logoRules.flatMap(framesOf)].flatMap((r) =>
      [...r.decls]
        .filter(([property]) => SHAPE.test(property))
        .flatMap(([property, value]) =>
          allowed.get(property) === value
            ? []
            : [`${where(r)} { ${property}: ${value} }`]
        )
    );
    expect(stray).toEqual([]);
    // Blocks with the same selector merge, the later one winning.
    const base = logoRules.filter((r) => where(r) === '.hero__logo');
    const merged = new Map(base.flatMap((r) => [...r.decls]));
    expect(base.length).toBeGreaterThan(0);
    expect(merged.get('height')).toBe(HEIGHT);
    expect(merged.get('object-fit')).toBe('contain');
  });

  test('no rule redefines what its height reads, or scales what it sits in', () => {
    const inputs = [logo, ...around]
      .flatMap((el) => reaching(el, HERO_LAYOUTS))
      .flatMap((r) =>
        [...r.decls.keys()]
          .filter((property) => DIAL_INPUTS.test(property))
          .map((property) => `${where(r)} { ${property} }`)
      );
    expect([...new Set(inputs)]).toEqual([]);
    const scaled = around
      .flatMap((el) => reaching(el, HERO_LAYOUTS))
      .flatMap((r) => [r, ...framesOf(r)])
      .flatMap((r) =>
        [...r.decls]
          .filter(
            ([property, value]) =>
              SCALES.test(property) && !unscaled(property, value)
          )
          .map(([property, value]) => `${where(r)} { ${property}: ${value} }`)
      );
    expect([...new Set(scaled)]).toEqual([]);
  });

  test('nothing registers what its height reads, and nothing around it carries an inline style', () => {
    // A registered initial value replaces every fallback; `inherits: false`
    // cuts the dial off at the element that sets it.
    const registered = [PAGE, LAYOUT].flatMap((path) =>
      (parse(readFileSync(path, 'utf8'), { modern: true }).css?.children ?? [])
        .filter((node) => node.type === 'Atrule' && node.name === 'property')
        .map((node) => (node.type === 'Atrule' ? node.prelude.trim() : ''))
        .filter((name) => DIAL_INPUTS.test(name))
    );
    expect(registered).toEqual([]);
    // The org layout carries the brand's inputs, the dial among them; nothing
    // between it and the image may set a style of its own.
    expect(
      around
        .filter((el) => el !== wrapper && el.getAttribute('style') !== null)
        .map(
          (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`
        )
    ).toEqual([]);
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
