// @vitest-environment node
/**
 * A benefit's name at a middle size (03 X55), in the rules jsdom cannot run:
 *
 *   1. Heading draws a title `--lp-title-lift` of the way from the title size
 *      to the heading's, and with no lift exactly the title size;
 *   2. the grid lifts its names two fifths of the way, and a fifth wherever
 *      four sit to a row (any Style, any count), so a few words still fit
 *      the narrower column; a rule that sets fewer than four to a row for a
 *      count the grid puts four across lifts two fifths again.
 *
 * A SOURCE test, the weaker instrument: `e2e/page-kit/type-rank.spec.ts`
 * measures the three-across name in a browser.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentRules } from '../testing';

const grid = componentRules(join(import.meta.dirname, 'BenefitsBlock.svelte'));
const heading = componentRules(
  join(import.meta.dirname, '..', '..', 'primitives', 'Heading.svelte')
);

/** How many a rule sets to a row: the grid draws `--_n` across (03 X71). */
const across = (rule: { decls: Map<string, string> }) =>
  Number(rule.decls.get('--_n') ?? 0);
const FOUR_ACROSS = [
  "[data-count='4']",
  "[data-count='7']",
  "[data-count='8']",
];

describe('a benefit’s name at a middle size', () => {
  it('Heading lifts a title toward the heading size, and not at all by default', () => {
    const title = heading.find(
      (r) =>
        r.selector === ".lp-heading[data-size='title']" && r.within.length === 0
    );
    expect(title?.decls.get('--_own')).toBe(
      'calc( var(--lp-size-title) + (var(--_heading) - var(--lp-size-title)) * var(--lp-title-lift, 0) )'
    );
    // Drawn at that size wherever its words fit its card (03 X71).
    expect(title?.decls.get('font-size')).toMatch(/^min\( var\(--_own\),/);
  });

  it('lifts toward the heading as the type dial takes it down, never up (03 X62)', () => {
    // A lifted title sits in a card's column: `louder`'s room is the
    // heading's, measured against the section's column, not the card's.
    const title = heading.find(
      (r) =>
        r.selector === ".lp-heading[data-size='title']" && r.within.length === 0
    );
    expect(title?.decls.get('--_heading')).toBe(
      'calc(var(--lp-size-heading) * var(--lp-drama-held, 1))'
    );
  });

  it('lifts the grid’s names two fifths of the way', () => {
    const base = grid.filter(
      (r) => r.selector === '.benefits-grid' && r.within.length === 0
    );
    expect(base).toHaveLength(1);
    expect(base[0].decls.get('--lp-title-lift')).toBe('0.4');
  });

  it('lifts a fifth wherever four sit to a row, and two fifths again where a Style sets fewer', () => {
    const fourAcross = grid.filter(
      (r) => r.selector.includes('benefits-grid') && across(r) === 4
    );
    expect(fourAcross.length).toBeGreaterThan(0);
    for (const rule of fourAcross)
      expect(rule.decls.get('--lp-title-lift'), rule.selector).toBe('0.2');

    const fewerForFour = grid.filter(
      (r) =>
        r.selector.includes('benefits-grid') &&
        across(r) > 0 &&
        across(r) < 4 &&
        r.within.includes('@container (min-width: 60rem)') &&
        FOUR_ACROSS.some((count) => r.selector.includes(count))
    );
    expect(fewerForFour.length).toBeGreaterThan(0);
    for (const rule of fewerForFour)
      expect(rule.decls.get('--lp-title-lift'), rule.selector).toBe('0.4');
  });
});
