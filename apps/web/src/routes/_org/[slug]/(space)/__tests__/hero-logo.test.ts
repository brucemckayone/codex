import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';
import { type CssRule, readRules } from './page-css';

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
 * depends on, across every rule that reaches the logo (nested, in @media,
 * or under a parent rule). Svelte's own parser drops comments, so prose
 * cannot satisfy it.
 */

const source = readFileSync(
  join(import.meta.dirname, '..', '+page.svelte'),
  'utf8'
);
const rules = readRules(source);

const LOGO_HERO = '[data-hero-layout="logo-hero"]';
const LOGO = /\.hero__logo(?![\w-])/;
const TITLE = /\.hero__title(?![\w-])/;

/** The rule's own selector and every rule and at-rule around it. */
const chain = (rule: CssRule) => [...rule.within, rule.selector];
const reaches = (rule: CssRule, target: RegExp) =>
  chain(rule).some((s) => target.test(s));
const inLogoHero = (rule: CssRule) =>
  chain(rule).some((s) => s.includes(LOGO_HERO));
const top = (selector: string) =>
  rules.filter((r) => r.within.length === 0 && r.selector === selector);

const logoRules = rules.filter((r) => reaches(r, LOGO));

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
  test('is sized by height and drawn at its own shape by every rule that reaches it', () => {
    const base = top('.hero__logo');
    expect(base).toHaveLength(1);
    expect(base[0].decls.get('height')).toBe(
      'calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1))'
    );
    expect(base[0].decls.get('object-fit')).toBe('contain');
    const fits = logoRules.flatMap((r) =>
      r.decls.has('object-fit') ? [r.decls.get('object-fit')] : []
    );
    expect(new Set(fits)).toEqual(new Set(['contain']));
  });

  test('carries no inline style that could outrank its rules', () => {
    const logos = elements(parse(source, { modern: true }).fragment).filter(
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

  test('in logo-hero is 192px × density from md up, capped at 45% of the screen height', () => {
    const own = top(`:global(${LOGO_HERO}) .hero__logo`);
    expect(own).toHaveLength(1);
    expect(own[0].decls.get('--_logo-base')).toBe('var(--space-48)');
    expect(own[0].decls.get('max-height')).toBe('45svh');
    // No other rule lifts, moves or adds a cap.
    expect(logoRules.filter((r) => r.decls.has('max-height'))).toEqual(own);
  });

  test('in logo-hero sits under a centred title', () => {
    const aligns = rules
      .filter((r) => inLogoHero(r) && reaches(r, TITLE))
      .flatMap((r) =>
        r.decls.has('text-align') ? [r.decls.get('text-align')] : []
      );
    expect(aligns).toEqual(['center']);
  });
});
