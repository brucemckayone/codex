// @vitest-environment node
/**
 * The numbers at Bold's scale in every Style, in the rules jsdom cannot run:
 *
 *   1. Every figure is at the display size, in a row and in tiles; the fit
 *      to the longest value stays.
 *   2. Four figures make two pairs in a row, in every Style (only Bold paired
 *      them); three, five or six go three across.
 *   3. Tiles sit under their head at every width, across the whole column:
 *      a share beside it held a figure far under the display size.
 *   4. Labels are in full ink.
 *
 * Each Style keeps its own dress (its ground, its rules, its weight), which
 * this does not pin. A SOURCE test, the weaker instrument: it proves the
 * rules, not the paint.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CssRule, componentRules, sheetRules } from '../testing';

const BLOCK = componentRules(join(import.meta.dirname, 'StatsBlock.svelte'));
const STYLES = join(import.meta.dirname, '..', '..', 'styles');
const SHEETS: (CssRule & { file: string })[] = readdirSync(STYLES)
  .filter((name) => name.endsWith('.css'))
  .flatMap((name) =>
    sheetRules(join(STYLES, name)).map((rule) => ({ ...rule, file: name }))
  );
const EVERY = [
  ...BLOCK.map((rule) => ({ ...rule, file: 'StatsBlock' })),
  ...SHEETS,
];
const WIDE = '@container (min-width: 48rem)';

const block = (selector: string, within: string[] = []) =>
  BLOCK.find(
    (rule) =>
      rule.selector === selector && rule.within.join(' ') === within.join(' ')
  )?.decls;

describe('StatsBlock: Bold’s scale in every Style', () => {
  it('sets every figure at the display size, fitted to the longest value', () => {
    expect(block('.stat')?.get('font-size')).toBe(
      'var(--_figure, var(--lp-size-display))'
    );
    expect(block('.stat__value')?.get('font-size')).toBe(
      'min(1em, 100cqi / (var(--_chars) * 0.62))'
    );
    // No layout or Style takes a figure back down to the price's size.
    expect(
      EVERY.filter(
        (rule) =>
          rule.selector.includes('.stat') &&
          [...rule.decls.values()].some((value) =>
            value.includes('--lp-size-price')
          )
      ).map((rule) => `${rule.file}: ${rule.selector}`)
    ).toEqual([]);
  });

  it('pairs four figures in a row in every Style, and sets three, five or six three across', () => {
    expect(block('.stats__list')?.get('--_cols')).toBe('2');
    const counted = EVERY.filter(
      (rule) =>
        rule.decls.has('--_cols') && rule.selector.includes('data-count')
    );
    // Calibrated: the three-across rule is read.
    expect(
      counted
        .find(
          (rule) =>
            rule.file === 'StatsBlock' &&
            rule.selector.startsWith(".stats[data-layout='row']") &&
            rule.within.join(' ') === WIDE
        )
        ?.decls.get('--_cols')
    ).toBe('3');
    expect(
      counted
        .filter((rule) => rule.selector.includes("[data-count='4']"))
        .map(
          (rule) =>
            `${rule.file}: ${rule.selector} → ${rule.decls.get('--_cols')}`
        )
    ).toEqual([]);
  });

  it('keeps the head above the tiles at every width, the tiles across the column', () => {
    const beside = EVERY.filter(
      (rule) =>
        /\.stats\[data-layout='grid'\](:has\([^)]*\))*$/.test(rule.selector) &&
        rule.decls.has('grid-template-columns')
    ).map((rule) => `${rule.file}: ${rule.selector}`);
    expect(beside).toEqual([]);
    // Nor does a Style size the head as one that shares its row.
    expect(
      SHEETS.filter((rule) => rule.selector.includes('.stats__head')).map(
        (rule) => `${rule.file}: ${rule.selector}`
      )
    ).toEqual([]);
  });

  it('sets the labels in full ink, which no Style softens', () => {
    expect(block('.stat__label')?.get('color')).toBe('var(--lp-ink)');
    expect(
      EVERY.filter(
        (rule) =>
          rule.file !== 'StatsBlock' &&
          /\.stat__label$/.test(rule.selector) &&
          rule.decls.has('color')
      ).map((rule) => `${rule.file}: ${rule.selector}`)
    ).toEqual([]);
  });
});
