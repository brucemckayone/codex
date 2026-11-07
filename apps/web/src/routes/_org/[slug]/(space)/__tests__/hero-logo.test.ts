import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

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
 * depends on. Svelte's own parser drops comments, so prose cannot satisfy it.
 */

const source = readFileSync(
  join(import.meta.dirname, '..', '+page.svelte'),
  'utf8'
);

/** Each rule's declarations, by selector; a later declaration wins. */
function rulesOf(): Map<string, Map<string, string>> {
  const css = parse(source, { modern: true }).css;
  if (!css) throw new Error('the page has no <style> block');
  const rules = new Map<string, Map<string, string>>();
  const walk = (
    nodes: ReadonlyArray<AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration>,
    within: string
  ) => {
    for (const node of nodes) {
      if (node.type === 'Atrule') {
        if (node.block)
          walk(node.block.children, `@${node.name} ${node.prelude} `);
      } else if (node.type === 'Rule') {
        const selector = `${within}${source.slice(node.prelude.start, node.prelude.end).replace(/\s+/g, ' ').trim()}`;
        const decls = rules.get(selector) ?? new Map<string, string>();
        for (const child of node.block.children)
          if (child.type === 'Declaration')
            decls.set(child.property, child.value.trim());
        rules.set(selector, decls);
      }
    }
  };
  walk(css.children, '');
  return rules;
}

const rules = rulesOf();
const LOGO_HERO = ':global([data-hero-layout="logo-hero"])';

describe('the hero logo', () => {
  test('is sized by height and drawn at its own shape inside its box', () => {
    const logo = rules.get('.hero__logo');
    expect(logo?.get('height')).toBe(
      'calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1))'
    );
    expect(logo?.get('object-fit')).toBe('contain');
  });

  test('in logo-hero is 192px × density at Scale 1, never past 45% of the first screen', () => {
    const logo = rules.get(`${LOGO_HERO} .hero__logo`);
    expect(logo?.get('--_logo-base')).toBe('var(--space-48)');
    expect(logo?.get('max-height')).toBe('45svh');
  });

  test('in logo-hero sits under a centred title, as the centered layout does', () => {
    expect(rules.get(`${LOGO_HERO} .hero__title`)?.get('text-align')).toBe(
      'center'
    );
    expect(
      rules
        .get(':global([data-hero-layout="centered"]) .hero__title')
        ?.get('text-align')
    ).toBe('center');
  });
});
