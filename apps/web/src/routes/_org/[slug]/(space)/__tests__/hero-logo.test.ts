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
 * A source test cannot run the cascade, so it holds the rules that can reach
 * the logo image to an allowlist: any selector that targets it (its class, or
 * an `img` inside its wrap) may set only its base, the dial's height, `width:
 * auto`, `object-fit: contain` and the one cap. Svelte's own parser drops
 * comments, so prose cannot satisfy it.
 */

const PAGE = join(import.meta.dirname, '..', '+page.svelte');
const rules = componentRules(PAGE, { nested: true });

const LOGO_HERO = '[data-hero-layout="logo-hero"]';
const HEIGHT = 'calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1))';

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

/** The full selectors a rule matches with, its parents' selectors resolved. */
function resolved(rule: CssRule): string[] {
  const [first, ...rest] = [...rule.parents, rule.selector];
  let full = members(first);
  for (const list of rest)
    full = full.flatMap((outer) => members(list).map((i) => nest(outer, i)));
  return full;
}

/** The compound a selector's subject is: what follows its last combinator. */
function subject(selector: string): string {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (depth === 0 && /[\s>+~]/.test(char)) last = i + 1;
  }
  return selector.slice(last);
}

/** A selector as it matches: Svelte compiles `:global(x)` to plain `x`. */
const unwrapped = (selector: string) =>
  selector.replace(/:global\(([^()]*)\)/g, '$1');

const targetsLogo = (selector: string) => {
  const full = unwrapped(selector);
  const own = subject(full);
  if (/\.hero__logo(?![\w-])/.test(own)) return true;
  return /^img(?![\w-])/.test(own) && /\.hero__(logo-wrap|content)/.test(full);
};
const targetsTitle = (selector: string) =>
  /\.hero__title(?![\w-])/.test(subject(unwrapped(selector)));

const logoRules = rules.filter((r) => resolved(r).some(targetsLogo));
const where = (r: CssRule) => [...r.within, r.selector].join(' ');

/** Every element in the page's markup, at any depth. */
function elements(node: unknown): AST.RegularElement[] {
  if (typeof node !== 'object' || node === null) return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const own =
    'type' in node && node.type === 'RegularElement'
      ? [node as AST.RegularElement]
      : [];
  return [
    ...own,
    ...Object.entries(node)
      .filter(([key]) => key !== 'metadata')
      .flatMap(([, child]) => elements(child)),
  ];
}

describe('the hero logo', () => {
  test('every rule that reaches the image sizes it by the dial, at its own shape', () => {
    const allowed = new Map<string, string | null>([
      ['--_logo-base', null],
      ['max-height', null],
      ['height', HEIGHT],
      ['width', 'auto'],
      ['object-fit', 'contain'],
    ]);
    const stray = logoRules.flatMap((r) =>
      [...r.decls].flatMap(([property, value]) => {
        if (!allowed.has(property)) return [`${where(r)} ${property}`];
        const only = allowed.get(property);
        return only === null || value === only
          ? []
          : [`${where(r)} ${property}: ${value}`];
      })
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
      [`:global(${LOGO_HERO}) .hero__logo`]: 'var(--space-48)',
      [`@media (--below-md) :global(${LOGO_HERO}) .hero__logo`]:
        'var(--space-32)',
    });
  });

  test('is capped once, in logo-hero, at 45% of the screen height', () => {
    const caps = logoRules
      .filter((r) => r.decls.has('max-height'))
      .map((r) => [where(r), r.decls.get('max-height')]);
    expect(caps).toEqual([[`:global(${LOGO_HERO}) .hero__logo`, '45svh']]);
  });

  test('carries no inline style that could outrank its rules', () => {
    const logos = elements(
      parse(readFileSync(PAGE, 'utf8'), { modern: true }).fragment
    ).filter(
      (el) =>
        el.name === 'img' &&
        el.attributes.some(
          (a) =>
            a.type === 'Attribute' &&
            a.name === 'class' &&
            Array.isArray(a.value) &&
            a.value.some(
              (p) =>
                p.type === 'Text' && p.data.split(/\s+/).includes('hero__logo')
            )
        )
    );
    expect(logos).toHaveLength(1);
    const styling = logos[0].attributes.filter(
      (a) =>
        a.type === 'StyleDirective' ||
        (a.type === 'Attribute' && a.name === 'style')
    );
    expect(styling).toEqual([]);
  });

  test('in logo-hero sits under a centred title, which no unscoped rule realigns', () => {
    const aligns = rules.filter(
      (r) => resolved(r).some(targetsTitle) && r.decls.has('text-align')
    );
    // Each layout aligns its own title; a rule for every layout would beat one.
    const unscoped = aligns.filter(
      (r) => !resolved(r).every((s) => s.includes('[data-hero-layout='))
    );
    expect(unscoped.map(where)).toEqual([]);
    const logoHero = aligns.filter((r) =>
      resolved(r).some((s) => s.includes(LOGO_HERO))
    );
    expect(logoHero.map((r) => r.decls.get('text-align'))).toEqual(['center']);
  });
});
